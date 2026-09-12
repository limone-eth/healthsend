"use client"

import { useEffect, useState } from "react"
import {
  CalendarBlank,
  CaretDown,
  CaretRight,
  Check,
  Files,
  FileText,
  PaperPlaneTilt,
  UploadSimple,
} from "@phosphor-icons/react"
import { createSend, type CreateSendResult } from "@/lib/sends"
import { ARKIV_EXPLORER } from "@/lib/arkiv"
import { Action, Card, Field, ScreenHeader, inputClass, Mono, timeLeft } from "@/components/ui"
import { DemoNotice } from "@/components/demo-notice"
import { useSenderIdentity } from "@/components/use-sender-identity"

/**
 * Frame `HMa4U` (desktop) / `ammIs` (mobile), read via the pencil MCP tool
 * against `healthsend.pen` — not a screenshot. The frame draws the scoping
 * screen over five fixed record buckets (Blood panels, Wearables,
 * Medications, Notes, Identity), fed from an archive that does not exist yet
 * (H-13). This story's contract narrows the accordion to what this app can
 * actually scope today: the files picked in this compose flow. One "Documents"
 * group stands in for the frame's five, expanding to the picked files
 * themselves — real names and sizes, nothing read from `fixtures/` and
 * presented as if it were a record.
 *
 * The frame's "How she opens it" and "Ends on" pronoun copy assumes a named,
 * gendered recipient ("Elena", "her"). The recipient's gender is never known
 * here, so shipped copy below uses "they/their" instead — the one deliberate
 * departure from copying frame strings verbatim.
 *
 * The frame's right column ("Settings Panel", `B6zXII`) is DESIGN.md's own
 * name for what this story calls the summary panel (see DESIGN.md's Layout
 * section: "a sticky summary panel right"). Its "Lock it to her phone",
 * "Add a PIN" and "Let her assistant read it too" controls have no backing
 * code path — `lib/sends.ts`'s `createSend` takes only files, a recipient
 * label and a TTL — and building them would mean inventing behaviour `lib/`
 * does not have, which this story's non-goals forbid touching. "How they open
 * it" is shown as the one true, current mode plus the device-lock mode
 * disabled, matching how `chrome.tsx` already marks the assistant nav item
 * inert; the PIN and assistant controls are left out rather than faked.
 *
 * The shared `(sender)` layout gives every route's content a wide column
 * (`layout.tsx`, off-limits to this story). At `md` and up this screen
 * restores the frame's split: the scope accordion beside the fixed-width
 * summary panel, matching `HMa4U`'s `iYhlT`/`B6zXII` adjacency. The
 * desktop/mobile divergence the frame actually calls for — one continuous
 * scroll versus two steps behind a fixed bar — is independent of column
 * count and is built as designed.
 */

type FileKindGuess = "pdf" | "csv" | "text"

function guessKind(file: File): FileKindGuess {
  const name = file.name.toLowerCase()
  if (file.type === "application/pdf" || name.endsWith(".pdf")) return "pdf"
  if (file.type === "text/csv" || name.endsWith(".csv")) return "csv"
  return "text"
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" })

/** Short demo windows, kept short on purpose: DESIGN.md's every-window-control
 *  rule (presets *and* an explicit custom choice) applies here too, and the
 *  Arkiv mission is judged on one query answering differently either side of
 *  a boundary that a demo can actually wait out. */
const WINDOWS: { label: string; short: string; seconds: number }[] = [
  { label: "2 minutes", short: "2 min", seconds: 120 },
  { label: "10 minutes", short: "10 min", seconds: 600 },
  { label: "1 hour", short: "1 hr", seconds: 3600 },
  { label: "7 days", short: "7 days", seconds: 7 * 86400 },
  { label: "12 weeks", short: "12 wks", seconds: 84 * 86400 },
]

function toLocalDateTimeInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`
}

export default function NewSendPage() {
  const { info, identity } = useSenderIdentity()
  if (!(info.identity && identity.address)) return null
  return <ComposeSend canUpload={info.canUpload} />
}

function ComposeSend({ canUpload }: { canUpload: boolean }) {
  const [files, setFiles] = useState<File[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [expanded, setExpanded] = useState(false)

  const [recipient, setRecipient] = useState("")
  const [windowSeconds, setWindowSeconds] = useState(WINDOWS[1].seconds)
  const [customEnabled, setCustomEnabled] = useState(false)
  const [customValue, setCustomValue] = useState("")

  const [mobileStep, setMobileStep] = useState<1 | 2>(1)
  const [stage, setStage] = useState<string | null>(null)
  const [result, setResult] = useState<CreateSendResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const tickState: "none" | "some" | "all" =
    selected.size === 0 ? "none" : selected.size === files.length ? "all" : "some"

  // A preview clock, not a countdown timer: refreshed on an interval rather
  // than read straight from `Date.now()` during render, which React's purity
  // rule forbids (a render can be called more than once without committing).
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    const tick = () => setNow(Date.now())
    // Deferred rather than called inline, like `shares/page.tsx`'s refresh
    // tick, so the first read lands outside the render pass.
    const initial = setTimeout(tick, 0)
    const timer = setInterval(tick, 30_000)
    return () => {
      clearTimeout(initial)
      clearInterval(timer)
    }
  }, [])
  const previewNow = now ?? 0

  const customSeconds = customValue
    ? Math.max(1, Math.round((new Date(customValue).getTime() - previewNow) / 1000))
    : null
  const ttlSeconds = customEnabled && customSeconds ? customSeconds : windowSeconds
  const expiresAt = Math.floor(previewNow / 1000) + ttlSeconds

  const selectedFiles = files.filter((_, i) => selected.has(i))
  const canCreate = selectedFiles.length > 0 && canUpload && stage === null

  const onPickFiles = (fileList: FileList | null) => {
    setFiles(Array.from(fileList ?? []))
    // Nothing is pre-selected — a fresh pick starts every tick state at "none".
    setSelected(new Set())
    setExpanded(false)
  }

  const toggleHeader = () => {
    setSelected(tickState === "all" ? new Set() : new Set(files.map((_, i) => i)))
  }

  const toggleFile = (index: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  const submit = async () => {
    if (!canCreate) return
    setError(null)
    try {
      const send = await createSend({
        files: selectedFiles,
        recipientLabel: recipient || "unnamed",
        ttlSeconds,
        onProgress: setStage,
      })
      setResult(send)
      setFiles([])
      setSelected(new Set())
      setRecipient("")
      setMobileStep(1)
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setStage(null)
    }
  }

  const summaryLine =
    selectedFiles.length === 0
      ? "Nothing included yet"
      : `${selectedFiles.length} of ${files.length} file${files.length === 1 ? "" : "s"} included`

  return (
    <div className="space-y-6">
      <ScreenHeader
        title="New share"
        lede="Choose what to include and when it should end. Nothing is included until you tick it."
      />

      {/* Mobile — two steps behind a fixed summary bar (the sanctioned d/m divergence, drawn in `ammIs`). */}
      <div className="md:hidden">
        {mobileStep === 1 ? (
          <ScopeSection
            files={files}
            selected={selected}
            expanded={expanded}
            tickState={tickState}
            onPickFiles={onPickFiles}
            onToggleHeader={toggleHeader}
            onToggleExpand={() => setExpanded((v) => !v)}
            onToggleFile={toggleFile}
          />
        ) : (
          <div className="space-y-4">
            <button
              type="button"
              onClick={() => setMobileStep(1)}
              className="flex items-center gap-1 text-sm text-secondary"
            >
              <CaretRight size={14} weight="light" className="rotate-180" />
              Back to what to include
            </button>
            <SettingsSection
              recipient={recipient}
              onRecipient={setRecipient}
              windowSeconds={windowSeconds}
              onWindow={(seconds) => {
                setWindowSeconds(seconds)
                setCustomEnabled(false)
              }}
              customEnabled={customEnabled}
              onCustomEnabled={setCustomEnabled}
              customValue={customValue}
              onCustomValue={setCustomValue}
              expiresAt={expiresAt}
              now={previewNow}
            />
          </div>
        )}

        <div className="h-40" />

        <div className="fixed inset-x-0 bottom-[88px] z-30 flex justify-center px-5">
          <div className="w-full max-w-2xl rounded-control border border-hairline bg-glass-raised px-5 pb-6 pt-3.5 shadow-glass backdrop-blur-xl">
            <p className="text-center text-label text-secondary">{summaryLine}</p>
            <div className="mt-2.5">
              {mobileStep === 1 ? (
                <Action
                  fullWidth
                  disabled={selectedFiles.length === 0}
                  onClick={() => setMobileStep(2)}
                >
                  Continue
                </Action>
              ) : (
                <Action fullWidth disabled={!canCreate} onClick={submit}>
                  {stage ?? "Create the link"}
                </Action>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Desktop/tablet — one continuous scroll, no step gate. The scope
          accordion (`iYhlT`) sits beside the fixed-width summary panel
          (`B6zXII`), the frame's own adjacency — not a decorative split. */}
      <div className="hidden md:flex md:items-start md:gap-10">
        <div className="min-w-0 md:flex-1">
          <ScopeSection
            files={files}
            selected={selected}
            expanded={expanded}
            tickState={tickState}
            onPickFiles={onPickFiles}
            onToggleHeader={toggleHeader}
            onToggleExpand={() => setExpanded((v) => !v)}
            onToggleFile={toggleFile}
          />
        </div>
        <div className="flex flex-col gap-6 md:w-[400px] md:shrink-0">
          <SettingsSection
            recipient={recipient}
            onRecipient={setRecipient}
            windowSeconds={windowSeconds}
            onWindow={(seconds) => {
              setWindowSeconds(seconds)
              setCustomEnabled(false)
            }}
            customEnabled={customEnabled}
            onCustomEnabled={setCustomEnabled}
            customValue={customValue}
            onCustomValue={setCustomValue}
            expiresAt={expiresAt}
            now={previewNow}
          />
          <Action fullWidth icon={PaperPlaneTilt} disabled={!canCreate} onClick={submit}>
            {stage ?? "Create the link"}
          </Action>
        </div>
      </div>

      {error && <p className="text-sm text-error">{error}</p>}

      {result && <ShareResult result={result} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// What to include — pen ids `iYhlT`/`DErS3` (desktop/mobile groups column).
// Narrowed to one "Documents" scope row over the files picked in this
// compose flow — see the file-level comment for why the frame's other four
// buckets are not built here.
// ---------------------------------------------------------------------------

function ScopeSection({
  files,
  selected,
  expanded,
  tickState,
  onPickFiles,
  onToggleHeader,
  onToggleExpand,
  onToggleFile,
}: {
  files: File[]
  selected: Set<number>
  expanded: boolean
  tickState: "none" | "some" | "all"
  onPickFiles: (files: FileList | null) => void
  onToggleHeader: () => void
  onToggleExpand: () => void
  onToggleFile: (index: number) => void
}) {
  const countLabel =
    tickState === "none" ? undefined : tickState === "all" ? "All" : `${selected.size} of ${files.length}`

  return (
    <Card className="space-y-4">
      <DemoNotice />

      <label className="flex h-13 w-full cursor-pointer items-center justify-center gap-2 rounded-control border border-hairline bg-surface text-title text-ink shadow-control">
        <UploadSimple size={18} weight="light" />
        {files.length === 0 ? "Add files" : "Replace files"}
        <input
          type="file"
          multiple
          accept=".pdf,.csv,.txt,.json,text/plain,text/csv,application/pdf"
          onChange={(event) => onPickFiles(event.target.files)}
          className="hidden"
        />
      </label>

      {files.length > 0 && (
        <div className="flex items-center justify-between">
          <span className="text-eyebrow uppercase text-muted">What to include</span>
          <span className="text-eyebrow text-navy">
            {tickState === "none"
              ? "Nothing yet"
              : tickState === "all"
                ? `All ${files.length} included`
                : `${selected.size} of ${files.length} included`}
          </span>
        </div>
      )}

      {files.length > 0 && (
        <div className="overflow-hidden rounded-control border border-hairline">
          <ScopeRowHeader
            state={tickState}
            label="Documents"
            meta={`${files.length} file${files.length === 1 ? "" : "s"} picked this send`}
            countLabel={countLabel}
            expanded={expanded}
            onToggleCheck={onToggleHeader}
            onToggleExpand={onToggleExpand}
          />
          {expanded && (
            <div className="space-y-2.5 border-t border-hairline bg-canvas px-[18px] py-3.5">
              {[...files]
                .map((file, index) => ({ file, index }))
                .sort((a, b) => b.file.lastModified - a.file.lastModified)
                .map(({ file, index }) => (
                  <FileRow
                    key={`${index}:${file.name}:${file.size}`}
                    file={file}
                    checked={selected.has(index)}
                    onToggle={() => onToggleFile(index)}
                  />
                ))}
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

/** Scope row header — pen id `vhTbi`/`xBSa8`. Three tick states, per
 *  DESIGN.md § Scope row: empty silver border (nothing), `ink` dash (some),
 *  `ink` check (all). The header follows its children rather than being a
 *  third thing to set — ticking it is the one-tap fast path. */
function ScopeRowHeader({
  state,
  label,
  meta,
  countLabel,
  expanded,
  onToggleCheck,
  onToggleExpand,
}: {
  state: "none" | "some" | "all"
  label: string
  meta: string
  countLabel?: string
  expanded: boolean
  onToggleCheck: () => void
  onToggleExpand: () => void
}) {
  return (
    <div className="flex h-16 w-full items-center gap-3.5 bg-surface px-[18px]">
      <ScopeCheckbox state={state} onClick={onToggleCheck} />
      <button type="button" onClick={onToggleExpand} className="flex flex-1 items-center gap-3.5 text-left">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-glyph bg-haze">
          <Files size={17} weight="light" className="text-navy" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className={`text-[15px] tracking-[-0.1px] text-ink ${state === "none" ? "font-medium" : "font-semibold"}`}>
            {label}
          </span>
          <span className="truncate text-label text-muted">{meta}</span>
        </span>
        {countLabel && (
          <span className="shrink-0 rounded-capsule bg-haze px-2.5 py-1 text-[12px] font-medium text-navy">
            {countLabel}
          </span>
        )}
        <CaretDown
          size={16}
          weight="light"
          className={`shrink-0 text-muted transition-transform ${expanded ? "rotate-180" : ""}`}
        />
      </button>
    </div>
  )
}

function ScopeCheckbox({ state, onClick }: { state: "none" | "some" | "all"; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={state === "all" ? "Deselect all files" : "Select all files"}
      className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-select border-[1.5px] ${
        state === "none" ? "border-silver bg-surface" : "border-ink bg-ink"
      }`}
    >
      {state === "all" && <Check size={14} weight="bold" className="text-surface" />}
      {state === "some" && <span className="h-[2px] w-[11px] rounded-[1px] bg-surface" />}
    </button>
  )
}

/** Per-file row — pen id `i66eiA` (the Wearables "Sleep" child row): a
 *  compact, atomic checkbox, no group glyph of its own. */
function FileRow({ file, checked, onToggle }: { file: File; checked: boolean; onToggle: () => void }) {
  const kind = guessKind(file)
  return (
    <button type="button" onClick={onToggle} className="flex h-[34px] w-full items-center gap-2.5 text-left">
      <span
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-select border-[1.5px] ${
          checked ? "border-ink bg-ink" : "border-silver bg-surface"
        }`}
      >
        {checked && <Check size={12} weight="bold" className="text-surface" />}
      </span>
      <FileText size={15} weight="light" className="shrink-0 text-navy" />
      <span className="flex-1 truncate text-[14px] font-semibold text-ink">{file.name}</span>
      <span className="shrink-0 text-[12.5px] text-muted">
        {kind} · {formatBytes(file.size)}
      </span>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Summary panel — pen id `B6zXII` ("Settings Panel"; DESIGN.md's Layout
// section names it "a sticky summary panel"). Recipient label and the window
// control are wired to `lib/sends.ts`; "How they open it" is shown as the
// one real mode, and the PIN/assistant controls are left out — see the
// file-level comment.
// ---------------------------------------------------------------------------

function SettingsSection({
  recipient,
  onRecipient,
  windowSeconds,
  onWindow,
  customEnabled,
  onCustomEnabled,
  customValue,
  onCustomValue,
  expiresAt,
  now,
}: {
  recipient: string
  onRecipient: (value: string) => void
  windowSeconds: number
  onWindow: (seconds: number) => void
  customEnabled: boolean
  onCustomEnabled: (value: boolean) => void
  customValue: string
  onCustomValue: (value: string) => void
  expiresAt: number
  now: number
}) {
  const expiresDate = new Date(expiresAt * 1000)
  const activeWindow = WINDOWS.find((w) => w.seconds === windowSeconds) ?? WINDOWS[1]

  return (
    <Card className="space-y-5">
      <Field label="Who it's for" assistive="A label just for you. It never appears on their page.">
        <input
          value={recipient}
          onChange={(event) => onRecipient(event.target.value)}
          placeholder="Who is this for?"
          className={inputClass}
        />
      </Field>

      <div className="flex flex-col gap-2">
        <span className="text-[15px] font-semibold leading-[1.33] text-ink">How they open it</span>
        <AccessModeRow
          title="Anyone with the link"
          description="Simplest. Whoever has the link can open it until it ends."
          selected
        />
        <AccessModeRow
          title="Lock it to their phone"
          description="Not available in this build."
          disabled
        />
      </div>

      <Field label="Ends on" assistive={windowAssistive(activeWindow.label, customEnabled)}>
        <div className="flex h-[54px] w-full items-center gap-2.5 rounded-control bg-surface px-4 text-[17px] text-ink shadow-control">
          <span className="flex-1">
            {customEnabled && !customValue ? "Pick a date and time" : dateFormat.format(expiresDate)}
          </span>
          <CalendarBlank size={20} weight="light" className="shrink-0 text-muted" />
        </div>

        <div className="flex flex-wrap gap-1.5 rounded-capsule bg-grouped p-[3px]">
          {WINDOWS.map((option) => {
            const active = !customEnabled && option.seconds === windowSeconds
            return (
              <button
                key={option.seconds}
                type="button"
                onClick={() => onWindow(option.seconds)}
                className={`h-8 flex-1 rounded-capsule px-2 text-[12.5px] font-medium ${
                  active ? "bg-surface text-ink shadow-control" : "text-secondary"
                }`}
              >
                {option.short}
              </button>
            )
          })}
          <button
            type="button"
            onClick={() => onCustomEnabled(true)}
            className={`h-8 flex-1 rounded-capsule px-2 text-[12.5px] font-semibold ${
              customEnabled ? "bg-surface text-ink shadow-control" : "text-secondary"
            }`}
          >
            Custom
          </button>
        </div>

        {customEnabled && (
          <input
            type="datetime-local"
            value={customValue}
            min={toLocalDateTimeInputValue(new Date(now + 60_000))}
            onChange={(event) => onCustomValue(event.target.value)}
            className="h-[42px] w-full rounded-[12px] border border-hairline bg-surface px-3 text-[14px] text-ink"
          />
        )}
      </Field>

      <p className="text-label text-secondary">
        {customEnabled && !customValue
          ? "Once you pick a date and time, their access ends on its own."
          : `On ${dateFormat.format(expiresDate)} their access ends on its own.`}{" "}
        There is nothing for you to remember and nothing for them to give back.
      </p>
    </Card>
  )
}

function windowAssistive(label: string, customEnabled: boolean): string {
  return customEnabled ? "Custom — ends when you pick a date and time." : `${label} from now.`
}

function AccessModeRow({
  title,
  description,
  selected = false,
  disabled = false,
}: {
  title: string
  description: string
  selected?: boolean
  disabled?: boolean
}) {
  return (
    <div
      className={`flex items-start gap-3 rounded-control border p-3.5 ${
        disabled ? "border-hairline bg-grouped opacity-60" : "border-ink bg-surface"
      }`}
      title={disabled ? "Not built yet" : undefined}
    >
      <span
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-[1.5px] ${
          selected ? "border-ink" : "border-silver"
        }`}
      >
        {selected && <span className="h-2.5 w-2.5 rounded-full bg-ink" />}
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="text-[15px] font-semibold text-ink">{title}</span>
        <span className="text-label text-secondary">{description}</span>
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Post-create feedback. Deliberately minimal — the WeTransfer-moment "link
// ready" screen is H-9, a non-goal here; this is just enough to hand the link
// over and confirm the send worked end to end.
// ---------------------------------------------------------------------------

function ShareResult({ result }: { result: CreateSendResult }) {
  const [copied, setCopied] = useState(false)

  return (
    <Card>
      <p className="text-label uppercase tracking-wide text-muted">Share this link</p>
      <p className="mt-2 break-all font-mono text-xs">{result.url}</p>
      <div className="mt-3 flex items-center gap-2">
        <Action
          variant="secondary"
          onClick={() => {
            navigator.clipboard.writeText(result.url)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          }}
        >
          {copied ? "Copied" : "Copy"}
        </Action>
        <a
          href={`${ARKIV_EXPLORER}/tx/${result.txHash}`}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-muted underline underline-offset-2"
        >
          Grant transaction
        </a>
      </div>
      <p className="mt-3 text-label text-secondary">
        The part after <Mono>#</Mono> is half the key and never reaches a server. The other half is the
        Arkiv grant — {timeLeft(result.expiresAt)}.
      </p>
    </Card>
  )
}
