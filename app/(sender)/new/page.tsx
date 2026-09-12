"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  CalendarBlank,
  CaretDown,
  CaretRight,
  Check,
  CheckCircle,
  Copy,
  Files,
  FileText,
  Fingerprint,
  FirstAidKit,
  LinkSimple,
  LockKey,
  PaperPlaneTilt,
  UploadSimple,
  UserCircle,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react"
import { createSend, createSendFromArchive, type CreateSendResult } from "@/lib/sends"
import { generateCode } from "@/lib/crypto"
import { classifyBundle } from "@/lib/envelope"
import type { FileKind } from "@/lib/arkiv"
import type { DocumentRecord } from "@/lib/archive"
import { loadMyArchive } from "@/lib/archive-store"
import { Action, Card, Field, ScreenHeader, inputClass } from "@/components/ui"
import { DemoNotice } from "@/components/demo-notice"
import { useSenderIdentity } from "@/components/use-sender-identity"
import { isExpiryValid, resolveCustomSeconds, resolveTtlSeconds } from "./expiry"

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
 * The frame named a specific, gendered recipient ("Elena", "her") in several
 * strings — "How she opens it", the reassurance line, "What her assistant can
 * see". The recipient's gender is never known here, so shipped copy below
 * uses "they/their" instead. H-47 corrected the same nodes in the canvas to
 * "they/their", so this is no longer a departure from the frame — the build
 * and the design now agree.
 *
 * The frame's right column ("Settings Panel", `B6zXII`) is DESIGN.md's own
 * name for what this story calls the summary panel (see DESIGN.md's Layout
 * section: "a sticky summary panel right"). Its "Lock it to their phone" and
 * "Let their assistant read it too" controls still have no backing code path
 * — `lib/sends.ts`'s `createSend` takes files, a recipient label, a TTL and
 * (H-7) an optional code, nothing about device binding or an assistant — and
 * building either would mean inventing behaviour `lib/` does not have, which
 * this story's non-goals forbid touching. "How they open it" is shown as the
 * one true, current mode plus the device-lock mode disabled, matching how
 * `chrome.tsx` already marks the assistant nav item inert; the device-lock
 * and assistant controls are left out rather than faked.
 *
 * "Add a PIN" is different: H-7 gives it a real code path end to end (see
 * `ToggleRow`, `generateCode`, `lib/crypto.ts`, `lib/holder-store.ts`), so it
 * is built here for real rather than shown disabled. No frame node backs this
 * exact toggle — see `## Choices` — so its visual language follows
 * `AccessModeRow` above rather than inventing a new one.
 *
 * H-64 adds a second scope group above the one described in the first
 * paragraph: "Your documents", the PDFs already sitting in the signed-in
 * sender's archive (H-63), fed by `loadMyArchive` rather than a file input.
 * It reuses `ScopeRowHeader`/the three tick states rather than a new
 * component — the same DESIGN.md "Scope row" pattern the freshly-picked
 * "Documents" group already draws from, just over a different data source.
 * The two groups are kept mutually exclusive (picking in one clears the
 * other) rather than merged into a single combined send: nothing in `lib/`
 * packs a freshly-picked `File` and an already-imported `DocumentRecord`
 * into one envelope today, and the story's own evidence only exercises one
 * archived document at a time — see `## Choices`.
 *
 * The shared `(sender)` layout gives every route's content a wide column
 * (`layout.tsx`, off-limits to this story). Per DESIGN.md's Layout table,
 * the two-column split is a `≥1280` (`xl`) behaviour only — 768–1279 is one
 * column at the tablet inset, same continuous scroll, no step gate. At `xl`
 * this screen restores the frame's split: the scope accordion beside the
 * fixed-width, sticky summary panel, matching `HMa4U`'s `iYhlT`/`B6zXII`
 * adjacency and its 640+400-at-a-40px-gutter measure. The desktop/mobile
 * divergence the frame actually calls for — one continuous scroll versus two
 * steps behind a fixed bar — is independent of column count and is built as
 * designed; only the column threshold moved from `md` to `xl`.
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

/** "Blood test, March and Thyroid panel, June" — the operator's own phrasing
 *  (docs/stories/H-62.md) for naming a tick-list of archived documents. */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ""
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
}

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

type ArchiveLoadState =
  | { status: "loading" }
  | { status: "ready"; documents: DocumentRecord[] }
  | { status: "error"; message: string }

function ComposeSend({ canUpload }: { canUpload: boolean }) {
  const router = useRouter()
  const [files, setFiles] = useState<File[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [expanded, setExpanded] = useState(false)

  const [archive, setArchive] = useState<ArchiveLoadState>({ status: "loading" })
  const [selectedArchiveIds, setSelectedArchiveIds] = useState<Set<string>>(new Set())
  const [archiveExpanded, setArchiveExpanded] = useState(false)

  useEffect(() => {
    let cancelled = false
    loadMyArchive()
      .then((loaded) => {
        if (cancelled) return
        const documents = loaded.records.filter((record): record is DocumentRecord => record.kind === "document")
        setArchive({ status: "ready", documents })
      })
      .catch((cause) => {
        if (!cancelled) setArchive({ status: "error", message: (cause as Error).message })
      })
    return () => {
      cancelled = true
    }
  }, [])

  const [recipient, setRecipient] = useState("")
  const [windowSeconds, setWindowSeconds] = useState(WINDOWS[1].seconds)
  const [customEnabled, setCustomEnabled] = useState(false)
  const [customValue, setCustomValue] = useState("")
  const [codeEnabled, setCodeEnabled] = useState(false)

  const [mobileStep, setMobileStep] = useState<1 | 2>(1)
  const [stage, setStage] = useState<string | null>(null)
  const [result, setResult] = useState<CreateSendResult | null>(null)
  // Captured from the compose form at the moment of submit, before it resets —
  // `result` (a `Grant`-derived value from `lib/sends.ts`, off-limits to this
  // story) carries only blinded attributes, never the plaintext label or the
  // file list the sender actually picked.
  const [sentSummary, setSentSummary] = useState<SentSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  const tickState: "none" | "some" | "all" =
    selected.size === 0 ? "none" : selected.size === files.length ? "all" : "some"

  const archiveDocuments = archive.status === "ready" ? archive.documents : []
  const archiveTickState: "none" | "some" | "all" =
    selectedArchiveIds.size === 0
      ? "none"
      : selectedArchiveIds.size === archiveDocuments.length
        ? "all"
        : "some"

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

  const customSeconds = resolveCustomSeconds(customValue, previewNow)
  const ttlSeconds = resolveTtlSeconds({ customEnabled, customSeconds, windowSeconds })
  const expiresAt = Math.floor(previewNow / 1000) + ttlSeconds
  // Custom enabled with nothing usable picked yet must block create, not fall
  // back to whichever preset window was last selected — see R2-016 in
  // docs/stories/H-49.md and expiry.ts's header comment.
  const expiryValid = isExpiryValid({ customEnabled, customSeconds })

  const selectedFiles = files.filter((_, i) => selected.has(i))
  const selectedArchiveDocuments = archiveDocuments.filter((document) => selectedArchiveIds.has(document.id))
  const canCreate =
    (selectedFiles.length > 0 || selectedArchiveDocuments.length > 0) &&
    canUpload &&
    stage === null &&
    expiryValid

  const onPickFiles = (fileList: FileList | null) => {
    setFiles(Array.from(fileList ?? []))
    // Nothing is pre-selected — a fresh pick starts every tick state at "none".
    setSelected(new Set())
    setExpanded(false)
    // A file picked for this send and an archived document are two different
    // send paths (`createSend` vs `createSendFromArchive`) — see the
    // file-level comment. Picking one clears the other so a send always
    // reads from exactly one source.
    setSelectedArchiveIds(new Set())
  }

  const toggleHeader = () => {
    setSelected(tickState === "all" ? new Set() : new Set(files.map((_, i) => i)))
    setSelectedArchiveIds(new Set())
  }

  const toggleFile = (index: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
    setSelectedArchiveIds(new Set())
  }

  const toggleArchiveHeader = () => {
    setSelectedArchiveIds(
      archiveTickState === "all" ? new Set() : new Set(archiveDocuments.map((document) => document.id)),
    )
    setSelected(new Set())
  }

  const toggleArchiveDocument = (id: string) => {
    setSelectedArchiveIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setSelected(new Set())
  }

  const submit = async () => {
    if (!canCreate) return
    setError(null)
    // Generated before createSend runs, not inside it: the code is this
    // screen's concern (H-7 — "the compose flow must actually generate and
    // show it, not imply it"), and a value fixed here is what gets sent to
    // the holder and what gets shown back to the sender to relay separately.
    const code = codeEnabled ? generateCode() : undefined
    const fromArchive = selectedArchiveDocuments.length > 0
    try {
      const send = fromArchive
        ? await createSendFromArchive({
            documents: selectedArchiveDocuments,
            recipientLabel: recipient || "unnamed",
            ttlSeconds,
            code,
            onProgress: setStage,
          })
        : await createSend({
            files: selectedFiles,
            recipientLabel: recipient || "unnamed",
            ttlSeconds,
            code,
            onProgress: setStage,
          })
      setResult(send)
      setSentSummary({
        recipientLabel: recipient.trim(),
        fileCount: fromArchive ? selectedArchiveDocuments.length : selectedFiles.length,
        fileKind: fromArchive ? "pdf" : classifyBundle(selectedFiles),
        ttlSeconds,
        code,
      })
      setFiles([])
      setSelected(new Set())
      setSelectedArchiveIds(new Set())
      setRecipient("")
      setCodeEnabled(false)
      setMobileStep(1)
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setStage(null)
    }
  }

  const summaryLine = (() => {
    if (selectedArchiveDocuments.length > 0) {
      const names = joinNames(selectedArchiveDocuments.map((document) => document.name))
      const noun = archiveDocuments.length === 1 ? "document" : "documents"
      return `${names} — ${selectedArchiveDocuments.length} of your ${archiveDocuments.length} ${noun}`
    }
    if (selectedFiles.length === 0) return "Nothing included yet"
    return `${selectedFiles.length} of ${files.length} file${files.length === 1 ? "" : "s"} included`
  })()

  // The WeTransfer moment (2.5, `LKFS1`/`uQP20`) is its own screen, not a
  // panel appended under the compose form — it replaces the form entirely
  // once a send exists, matching how the frame draws it as a full page.
  if (result && sentSummary) {
    return (
      <LinkReady
        result={result}
        summary={sentSummary}
        onDone={() => router.push("/shares")}
        onMakeAnother={() => {
          setResult(null)
          setSentSummary(null)
        }}
      />
    )
  }

  return (
    <div className="space-y-6">
      <ScreenHeader
        title="New share"
        lede="Choose what to include and when it should end. Nothing is included until you tick it."
      />

      {/* Below `md` (phone only, <768) — two steps behind a fixed summary bar (the
          sanctioned d/m divergence, drawn in `ammIs`). Tablet (768–1279) gets the
          continuous-scroll block below instead, per DESIGN.md's Layout table — it is
          still one column there, just not this step-gated one. */}
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
            archive={archive}
            selectedArchiveIds={selectedArchiveIds}
            archiveTickState={archiveTickState}
            archiveExpanded={archiveExpanded}
            onToggleArchiveHeader={toggleArchiveHeader}
            onToggleArchiveExpand={() => setArchiveExpanded((v) => !v)}
            onToggleArchiveDocument={toggleArchiveDocument}
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
              codeEnabled={codeEnabled}
              onCodeEnabled={setCodeEnabled}
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

      {/* Tablet (768–1279) — one continuous scroll, no step gate, but still one column
          per DESIGN.md's Layout table. Desktop (`xl`, ≥1280) restores the frame's split:
          the scope accordion (`iYhlT`) beside the fixed-width, sticky summary panel
          (`B6zXII`) at the frame's own 640+400-at-40px-gutter measure — not a decorative
          split, and not the same breakpoint tablet gets. */}
      <div className="hidden md:flex md:flex-col md:gap-10 xl:flex-row xl:items-start">
        <div className="min-w-0 xl:flex-1">
          <ScopeSection
            files={files}
            selected={selected}
            expanded={expanded}
            tickState={tickState}
            onPickFiles={onPickFiles}
            onToggleHeader={toggleHeader}
            onToggleExpand={() => setExpanded((v) => !v)}
            onToggleFile={toggleFile}
            archive={archive}
            selectedArchiveIds={selectedArchiveIds}
            archiveTickState={archiveTickState}
            archiveExpanded={archiveExpanded}
            onToggleArchiveHeader={toggleArchiveHeader}
            onToggleArchiveExpand={() => setArchiveExpanded((v) => !v)}
            onToggleArchiveDocument={toggleArchiveDocument}
          />
        </div>
        <div className="flex flex-col gap-6 xl:sticky xl:top-11 xl:w-[400px] xl:shrink-0">
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
            codeEnabled={codeEnabled}
            onCodeEnabled={setCodeEnabled}
          />
          <Action fullWidth icon={PaperPlaneTilt} disabled={!canCreate} onClick={submit}>
            {stage ?? "Create the link"}
          </Action>
        </div>
      </div>

      {error && <p className="text-sm text-error">{error}</p>}
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
  archive,
  selectedArchiveIds,
  archiveTickState,
  archiveExpanded,
  onToggleArchiveHeader,
  onToggleArchiveExpand,
  onToggleArchiveDocument,
}: {
  files: File[]
  selected: Set<number>
  expanded: boolean
  tickState: "none" | "some" | "all"
  onPickFiles: (files: FileList | null) => void
  onToggleHeader: () => void
  onToggleExpand: () => void
  onToggleFile: (index: number) => void
  archive: ArchiveLoadState
  selectedArchiveIds: Set<string>
  archiveTickState: "none" | "some" | "all"
  archiveExpanded: boolean
  onToggleArchiveHeader: () => void
  onToggleArchiveExpand: () => void
  onToggleArchiveDocument: (id: string) => void
}) {
  const countLabel =
    tickState === "none" ? undefined : tickState === "all" ? "All" : `${selected.size} of ${files.length}`

  return (
    <Card className="space-y-4">
      <DemoNotice />

      <ArchiveDocumentsGroup
        archive={archive}
        selectedIds={selectedArchiveIds}
        tickState={archiveTickState}
        expanded={archiveExpanded}
        onToggleHeader={onToggleArchiveHeader}
        onToggleExpand={onToggleArchiveExpand}
        onToggleDocument={onToggleArchiveDocument}
      />

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

// ---------------------------------------------------------------------------
// Your documents — H-64. PDFs already sitting in the archive (H-63), listed
// with the same three-tick-state accordion `ScopeRowHeader` already draws for
// freshly-picked files, just fed by `loadMyArchive` instead of a file input.
// No pen frame names this exact bucket; it follows the row it sits beside —
// see the file-level comment and `## Choices`.
// ---------------------------------------------------------------------------

// The operator's own required sentence (docs/stories/H-64.md, "Say the
// consequence"), copied verbatim rather than paraphrased.
const CONSEQUENCE_LINE = "The document is shared as issued, including any name or date of birth printed on it."

function ArchiveDocumentsGroup({
  archive,
  selectedIds,
  tickState,
  expanded,
  onToggleHeader,
  onToggleExpand,
  onToggleDocument,
}: {
  archive: ArchiveLoadState
  selectedIds: Set<string>
  tickState: "none" | "some" | "all"
  expanded: boolean
  onToggleHeader: () => void
  onToggleExpand: () => void
  onToggleDocument: (id: string) => void
}) {
  if (archive.status === "loading") {
    return (
      <div role="status" className="rounded-inset bg-grouped p-[18px] text-[14px] text-secondary">
        Opening your archive…
      </div>
    )
  }

  if (archive.status === "error") {
    return (
      <div role="alert" className="rounded-inset border border-error/20 bg-grouped p-[18px] text-[14px] text-error">
        Could not load your archive: {archive.message}
      </div>
    )
  }

  const { documents } = archive

  if (documents.length === 0) {
    return (
      <div className="flex flex-col gap-2.5 rounded-inset bg-grouped p-[18px]">
        <p className="text-[14px] leading-[1.45] text-secondary">
          Your archive has no documents yet. Add a PDF to send it from here.
        </p>
        <Link href="/add" className="text-[13.5px] font-semibold text-navy">
          Add to your archive
        </Link>
      </div>
    )
  }

  const countLabel =
    tickState === "none" ? undefined : tickState === "all" ? "All" : `${selectedIds.size} of ${documents.length}`
  const selectedNames = documents.filter((document) => selectedIds.has(document.id)).map((document) => document.name)

  return (
    <div className="flex flex-col gap-2.5">
      {selectedNames.length > 0 && (
        // The operator's own phrasing (docs/stories/H-62.md): "Blood test,
        // March and Thyroid panel, June — 2 of your 12 documents". Shown at
        // every width — the mobile fixed bar's `summaryLine` covers the
        // phone step flow, but this is the only place a desktop sender sees
        // which documents they ticked named in full.
        <p className="text-[13px] font-medium text-ink">
          {joinNames(selectedNames)} — {selectedIds.size} of your {documents.length} document
          {documents.length === 1 ? "" : "s"}
        </p>
      )}
      <div className="overflow-hidden rounded-control border border-hairline">
        <ScopeRowHeader
          state={tickState}
          label="Your documents"
          meta={`${documents.length} document${documents.length === 1 ? "" : "s"} in your archive`}
          countLabel={countLabel}
          expanded={expanded}
          onToggleCheck={onToggleHeader}
          onToggleExpand={onToggleExpand}
        />
        {expanded && (
          <div className="space-y-2.5 border-t border-hairline bg-canvas px-[18px] py-3.5">
            {documents.map((document) => (
              <ArchiveDocumentRow
                key={document.id}
                document={document}
                checked={selectedIds.has(document.id)}
                onToggle={() => onToggleDocument(document.id)}
              />
            ))}
          </div>
        )}
      </div>
      <p className="text-[12.5px] leading-[1.4] text-muted">{CONSEQUENCE_LINE}</p>
    </div>
  )
}

/** Mirrors `FileRow` below, over a `DocumentRecord` rather than a picked `File`. */
function ArchiveDocumentRow({
  document,
  checked,
  onToggle,
}: {
  document: DocumentRecord
  checked: boolean
  onToggle: () => void
}) {
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
      <span className="flex-1 truncate text-[14px] font-semibold text-ink">{document.name}</span>
      <span className="shrink-0 text-[12.5px] text-muted">PDF · {formatBytes(document.size)}</span>
    </button>
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
// section names it "a sticky summary panel"). Recipient label, the window
// control and the code toggle are wired to `lib/sends.ts`; "How they open
// it" is shown as the one real mode, and the device-lock/assistant controls
// are left out — see the file-level comment.
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
  codeEnabled,
  onCodeEnabled,
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
  codeEnabled: boolean
  onCodeEnabled: (value: boolean) => void
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

      {/*
        A four-digit code — H-7. Optional, chosen per send: this toggle is the
        only place a sender decides. No design node backs this exact control
        (see this file's ## Choices in the story); it follows AccessModeRow's
        visual language above rather than inventing a new one.

        The consequence line is not a footnote: a coded share genuinely cannot
        be opened without the code, by anyone, including whoever is reading
        this sentence right now.
      */}
      <ToggleRow
        title="Add a four-digit code"
        description="Send it separately from the link. Someone with only the link gets five tries, then it locks. Not even you can open it without the code."
        checked={codeEnabled}
        onChange={onCodeEnabled}
      />

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

/** A labelled on/off row — H-7's code toggle, the only caller so far. */
function ToggleRow({
  title,
  description,
  checked,
  onChange,
}: {
  title: string
  description: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-start gap-3 rounded-control border border-hairline bg-surface p-3.5 text-left"
    >
      <span className="flex flex-1 flex-col gap-0.5">
        <span className="text-[15px] font-semibold text-ink">{title}</span>
        <span className="text-label text-secondary">{description}</span>
      </span>
      <span
        className={`mt-0.5 flex h-6 w-10 shrink-0 items-center rounded-capsule p-0.5 transition-colors ${
          checked ? "bg-ink" : "bg-grouped"
        }`}
      >
        <span
          className={`h-5 w-5 rounded-full bg-surface shadow-control transition-transform ${
            checked ? "translate-x-4" : "translate-x-0"
          }`}
        />
      </span>
    </button>
  )
}

// ---------------------------------------------------------------------------
// 2.5 Link ready — pen ids `LKFS1` (desktop) / `uQP20` (mobile), read via the
// pencil MCP tool. The WeTransfer moment: the link, and four rows on what is
// in it, who can open it, when it ends, and what the recipient learns about
// the sender. Retires the interim panel this replaced (`ShareResult`, which
// carried the stale claim that "the other half is the Arkiv grant" — the
// grant has held no key material since the split-key rewrite; the holder
// holds the other half under a TTL, and the grant only decides when the
// holder stops serving it).
//
// Two frame values assume a feature this build does not have — a four-digit
// device-lock code (H-7's non-goal here) — and are adapted rather than
// copied verbatim, the same way the compose screen above narrows "How they
// open it" to the one real access mode:
//   - the sub-headline drops the code clause entirely;
//   - "Who can open it" reads "Anyone with the link" (the one real mode from
//     `AccessModeRow`, not "the first phone, with your code").
// "What they see about you" also departs from the frame's "No name, no date
// of birth" — that line describes a parsed archive record with a date-of-
// birth field this app does not have (H-13/H-36 are not built). What is true
// today, and is what the recipient page actually shows, is that no sender
// attribution reaches the page at all (`app/s/[key]/page.tsx`'s "Shared with
// you" names no one) — so the value says that instead. See `## Choices`.
//
// The row *labels* are the one place the two frames disagree with each
// other, not just with this app: desktop's `A4L3dx` read "What she sees
// about you", mobile's `eonlR` read "She sees about you" — a gendered
// recipient the frame assumes elsewhere too. H-47 re-worded both nodes to
// "they/their" in the canvas, matching the de-gendered chip vocabulary, so
// the labels below now copy the frames verbatim again rather than departing
// from them.
// ---------------------------------------------------------------------------

type SentSummary = {
  /** Plaintext, as the sender typed it — never the blinded attribute a grant carries. */
  recipientLabel: string
  fileCount: number
  fileKind: FileKind
  ttlSeconds: number
  /** H-7: shown once, here, so the sender can relay it separately from the link. Never stored. */
  code?: string
}

const LINK_READY_FILE_KIND_LABEL: Record<FileKind, string> = {
  pdf: "PDF",
  csv: "CSV",
  text: "Text",
  mixed: "Mixed",
}

const dateFormatShort = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long" })

function whatsInIt(summary: SentSummary): string {
  const noun = summary.fileCount === 1 ? "document" : "documents"
  return `${summary.fileCount} ${noun} · ${LINK_READY_FILE_KIND_LABEL[summary.fileKind]}`
}

/** The chosen window's length in plain words — "84 days" for 12 weeks, matching how `LKFS1`/`uQP20` state it. */
function durationLabel(seconds: number): string {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`
  if (seconds < 3600) {
    const minutes = Math.round(seconds / 60)
    return `${minutes} minute${minutes === 1 ? "" : "s"}`
  }
  if (seconds < 86400) {
    const hours = Math.round(seconds / 3600)
    return `${hours} hour${hours === 1 ? "" : "s"}`
  }
  const days = Math.round(seconds / 86400)
  return `${days} day${days === 1 ? "" : "s"}`
}

function greeting(recipientLabel: string): string {
  return recipientLabel
    ? `Send it to ${recipientLabel} however you normally talk to them.`
    : "Send it however you normally talk to them."
}

/** Host + path only — never the fragment, which carries half the key. */
function truncateLink(url: string): string {
  let visible: string
  try {
    const parsed = new URL(url)
    visible = `${parsed.host}${parsed.pathname}`
  } catch {
    visible = url.split("#")[0]
  }
  return visible.length > 26 ? `${visible.slice(0, 26)}…` : `${visible}…`
}

function LinkReady({
  result,
  summary,
  onDone,
  onMakeAnother,
}: {
  result: CreateSendResult
  summary: SentSummary
  onDone: () => void
  onMakeAnother: () => void
}) {
  const [copied, setCopied] = useState(false)
  const [codeCopied, setCodeCopied] = useState(false)
  const expiresDate = new Date(result.expiresAt * 1000)

  const copyLink = () => {
    navigator.clipboard.writeText(result.url)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const copyCode = () => {
    if (!summary.code) return
    navigator.clipboard.writeText(summary.code)
    setCodeCopied(true)
    setTimeout(() => setCodeCopied(false), 1500)
  }

  const inItValue = whatsInIt(summary)
  const linkDisplay = truncateLink(result.url)
  const durationValue = durationLabel(summary.ttlSeconds)
  // Real, not the frame's uncoded default (see the file-level comment): a
  // coded share genuinely needs both, and this row is the wrong place to
  // understate that.
  const whoCanOpen = summary.code ? "Anyone with the link and the code" : "Anyone with the link"
  const whoCanOpenDesktop = summary.code
    ? "Anyone with the link and the code, until it ends"
    : "Anyone with the link, until it ends"

  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-3.5 md:gap-[22px]">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-inset bg-sage md:h-13 md:w-13">
        <CheckCircle size={25} weight="regular" className="text-surface md:hidden" />
        <CheckCircle size={26} weight="regular" className="hidden text-surface md:block" />
      </div>

      <h1 className="text-[32px] font-bold leading-[1.12] tracking-[-0.7px] text-ink md:text-[38px] md:leading-[1.1] md:tracking-[-0.85px]">
        Your link is ready
      </h1>

      <p className="text-[15px] leading-[1.5] text-secondary md:hidden">
        {greeting(summary.recipientLabel)} On {dateFormatShort.format(expiresDate)} it stops
        working, whether or not you remember.
      </p>
      <p className="hidden text-[17px] leading-[1.5] text-secondary md:block">
        {greeting(summary.recipientLabel)} They need no account and no app, and on{" "}
        {dateFormat.format(expiresDate)} it stops working, whether or not you remember.
      </p>

      <LinkRow display={linkDisplay} copied={copied} onCopy={copyLink} />

      {summary.code && <CodeRow code={summary.code} copied={codeCopied} onCopy={copyCode} />}

      <div className="w-full overflow-hidden rounded-inset border border-black/[0.05] bg-surface shadow-card md:rounded-card">
        <SummaryRow icon={FirstAidKit} label="What's in it" value={inItValue} />
        <SummaryRow
          icon={Fingerprint}
          label="Who can open it"
          value={whoCanOpen}
          desktopValue={whoCanOpenDesktop}
        />
        <SummaryRow
          icon={CalendarBlank}
          label="When it ends"
          value={`${dateFormatShort.format(expiresDate)} · ${durationValue}`}
          desktopValue={`${dateFormat.format(expiresDate)} · ${durationValue}`}
        />
        <SummaryRow
          icon={UserCircle}
          label="They see about you"
          desktopLabel="What they see about you"
          value="Nothing — not your name"
          desktopValue="Nothing — not your name, not your address"
          last
        />
      </div>

      <div className="flex gap-2.5">
        <div className="flex-1">
          <Action fullWidth onClick={onDone}>
            Done
          </Action>
        </div>
        <div className="flex-1">
          <Action fullWidth variant="secondary" onClick={onMakeAnother}>
            Make another
          </Action>
        </div>
      </div>

      <p className="text-center text-[12.5px] leading-[1.45] text-muted md:text-[13px]">
        Changed your mind? End it early from Your shares and they lose access straight away.
      </p>
    </div>
  )
}

function LinkRow({
  display,
  copied,
  onCopy,
}: {
  display: string
  copied: boolean
  onCopy: () => void
}) {
  const CopyIcon = copied ? Check : Copy
  return (
    <div className="flex h-14 w-full items-center gap-2.5 rounded-control bg-grouped py-0 pl-3.5 pr-2 md:h-15 md:gap-3 md:pl-[18px]">
      <LinkSimple size={16} weight="light" className="shrink-0 text-muted md:hidden" />
      <LinkSimple size={18} weight="light" className="hidden shrink-0 text-muted md:block" />
      <span className="flex-1 truncate text-[14px] font-medium text-ink md:text-[16px]">{display}</span>
      <button
        type="button"
        onClick={onCopy}
        className="flex h-10 shrink-0 items-center gap-1.5 rounded-[11px] bg-ink px-3.5 text-[13px] font-semibold text-surface md:h-11 md:gap-2 md:rounded-[12px] md:px-4 md:text-[14px]"
      >
        <CopyIcon size={14} weight={copied ? "bold" : "regular"} className="md:hidden" />
        <CopyIcon size={16} weight={copied ? "bold" : "regular"} className="hidden md:block" />
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  )
}

/**
 * The code, shown once — H-7. Drawn as its own row rather than folded into
 * `LinkRow`, so the two things read as two things: the design is explicit
 * that the code travels away from the link, not beside it.
 */
function CodeRow({
  code,
  copied,
  onCopy,
}: {
  code: string
  copied: boolean
  onCopy: () => void
}) {
  const CopyIcon = copied ? Check : Copy
  const display = `${code.slice(0, 2)} ${code.slice(2)}`
  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-14 w-full items-center gap-2.5 rounded-control bg-grouped py-0 pl-3.5 pr-2 md:h-15 md:gap-3 md:pl-[18px]">
        <LockKey size={16} weight="light" className="shrink-0 text-muted md:hidden" />
        <LockKey size={18} weight="light" className="hidden shrink-0 text-muted md:block" />
        <span className="flex-1 truncate text-[14px] font-medium tracking-[2px] text-ink md:text-[16px]">
          {display}
        </span>
        <button
          type="button"
          onClick={onCopy}
          className="flex h-10 shrink-0 items-center gap-1.5 rounded-[11px] bg-ink px-3.5 text-[13px] font-semibold text-surface md:h-11 md:gap-2 md:rounded-[12px] md:px-4 md:text-[14px]"
        >
          <CopyIcon size={14} weight={copied ? "bold" : "regular"} className="md:hidden" />
          <CopyIcon size={16} weight={copied ? "bold" : "regular"} className="hidden md:block" />
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="text-[12.5px] leading-[1.45] text-muted md:text-[13px]">
        Send this on its own, away from the link — a message, a call, anything but the same
        channel. Nobody can open this without it, not even you.
      </p>
    </div>
  )
}

function SummaryRow({
  icon: Icon,
  label,
  desktopLabel,
  value,
  desktopValue,
  last = false,
}: {
  icon: PhosphorIcon
  label: string
  desktopLabel?: string
  value: string
  desktopValue?: string
  last?: boolean
}) {
  return (
    <div>
      <div className="flex h-[50px] items-center gap-2.5 px-3.5 md:h-[58px] md:gap-3 md:px-5">
        <Icon size={16} weight="light" className="shrink-0 text-secondary md:hidden" />
        <Icon size={18} weight="light" className="hidden shrink-0 text-secondary md:block" />
        <span className="shrink-0 whitespace-nowrap text-[13px] text-secondary md:text-[14px]">
          <span className="md:hidden">{label}</span>
          <span className="hidden md:inline">{desktopLabel ?? label}</span>
        </span>
        <span className="min-w-0 flex-1 truncate text-right text-[13px] font-semibold text-ink md:text-[14px]">
          <span className="md:hidden">{value}</span>
          <span className="hidden md:inline">{desktopValue ?? value}</span>
        </span>
      </div>
      {!last && <div className="h-px w-full bg-hairline" />}
    </div>
  )
}
