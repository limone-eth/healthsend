"use client"

/**
 * The recipient's view.
 *
 * No account, no wallet, no Swarm ID. The link carries half the key in its
 * fragment; the holder keeps the other half under a TTL and hands it over only
 * while the Arkiv grant is still live. The grant itself carries no key material
 * — that was the whole point of the split-key rewrite, since anything written
 * to Arkiv survives in the creating transaction's calldata permanently.
 *
 * This page is the only place both halves ever meet, and they meet in the
 * recipient's browser rather than on a server that could be asked to keep
 * serving.
 *
 * H-53 adds a third grant shape behind the same `openSend` call: a v3 grant
 * has no holder at all, and asks TACo for its half instead, gated on Arkiv's
 * own live state. Nothing here changes for it. `openSend` resolves a v3 open
 * into exactly the same `OpenedSend | OpenFailure` shape v1/v2 already
 * produce — "unavailable" when TACo cannot answer, "expired" from the same
 * head-boundary check every grant gets, "ok" once both halves join — so this
 * page's six resolutions and their copy stay exactly as they are. See
 * `docs/stories/H-53.md`.
 */

import { use, useEffect, useRef, useState, type KeyboardEvent } from "react"
import Link from "next/link"
import type { Icon as PhosphorIcon } from "@phosphor-icons/react"
import { BookOpen, CloudSlash, LockSimple, PaperPlaneTilt } from "@phosphor-icons/react"
import { openSend, type OpenedSend, type OpenFailure } from "@/lib/sends"
import { classify, type PackedFile } from "@/lib/envelope"
import { Action, Card, Countdown, CountdownChip, ListRow } from "@/components/ui"
import { RecipientTopBar } from "@/components/chrome"

type State =
  | { status: "loading" }
  | { status: "ok"; send: OpenedSend }
  | { status: "expired" }
  | { status: "revoked" }
  | { status: "no-key" }
  /** H-7: this share carries a code. `error`/`locked` ride along rather than resetting to "loading" between tries. */
  | { status: "needs-code"; expiresAt: number; error?: string; locked?: boolean }
  | { status: "unavailable"; message: string }
  | { status: "error"; message: string }

/** Fold an `openSend` result into this page's `State` — the one place that mapping happens. */
function toState(result: { status: "ok"; send: OpenedSend } | OpenFailure): State {
  if (result.status === "ok") return { status: "ok", send: result.send }
  if (result.status === "wrong-code") {
    return {
      status: "needs-code",
      expiresAt: result.expiresAt,
      error: result.locked ? "Too many attempts. Ask the sender for a new link." : "That code isn't right.",
      locked: result.locked,
    }
  }
  return result
}

export default function SharePage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = use(params)
  const [state, setState] = useState<State>({ status: "loading" })

  useEffect(() => {
    // The fragment is readable only here — it was never sent with the request.
    const linkSecret = window.location.hash.replace(/^#/, "")
    let cancelled = false
    openSend(key, linkSecret).then((result) => {
      if (cancelled) return
      setState(toState(result))
    })
    return () => {
      cancelled = true
    }
  }, [key])

  // The code never leaves this closure except as a derived proof — see
  // `lib/crypto.ts`, `deriveCodeProof` — and it is asked for again on every
  // submit rather than held in state, so a wrong guess leaves nothing behind
  // to inspect.
  const submitCode = async (code: string) => {
    const linkSecret = window.location.hash.replace(/^#/, "")
    const result = await openSend(key, linkSecret, code)
    setState(toState(result))
  }

  // "ok" draws its own chrome (RecipientTopBar, no rail, no tabs) per H-5.
  // "unavailable", "expired" and "revoked" are H-6's: full-bleed splash
  // screens (RqJ31/f9lYQS, WtHlp/zHvvF), not the plain centred wrapper below —
  // that wrapper is what is left for the states this story does not touch.
  if (state.status === "ok") {
    return <Viewer send={state.send} onExpired={() => setState({ status: "expired" })} />
  }
  if (state.status === "needs-code") {
    return (
      <FirstOpenCode
        expiresAt={state.expiresAt}
        error={state.error}
        locked={state.locked}
        onSubmit={submitCode}
      />
    )
  }
  if (state.status === "unavailable") {
    return <Unavailable message={state.message} />
  }
  if (state.status === "expired" || state.status === "revoked") {
    return <Ended revoked={state.status === "revoked"} />
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-16">
      {state.status === "loading" && <p className="text-sm text-muted">Opening…</p>}
      {state.status === "no-key" && <NoKey />}
      {state.status === "error" && <Failed message={state.message} />}
    </main>
  )
}

/**
 * 3.1 "First open" — pen ids `wIxCY` (desktop) / `e1Zud2` (mobile), read via
 * the pencil MCP tool. Both frames also draw a "This will be tied to this
 * device" claim panel below the code — device binding, H-7's own non-goal
 * ("Different story, and its chip vocabulary already shipped"), so that panel
 * is left out here rather than faked, the same call `new/page.tsx` makes for
 * "Lock it to their phone".
 *
 * Both frames' helper line reads "She sent this on its own, away from the
 * link — check your messages." — a gendered sender, same as the nodes H-47
 * corrected elsewhere in this canvas to "they/their" (this node predates that
 * pass; it was never touched because nothing rendered it before this story).
 * Copied here as "They", matching the app's one standing convention rather
 * than reintroducing a pronoun this codebase has already removed everywhere
 * else it appears — see `## Choices`.
 *
 * The top bar and its countdown reuse `RecipientTopBar`/`Countdown`/
 * `CountdownChip` exactly as `Viewer` below does: the frame draws the same
 * countdown pill before any data renders, and these are the components that
 * already build it — see `## Choices` on the compact mobile pill.
 */
function FirstOpenCode({
  expiresAt,
  error,
  locked,
  onSubmit,
}: {
  expiresAt: number
  error?: string
  locked?: boolean
  onSubmit: (code: string) => void
}) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000)
    return () => clearInterval(timer)
  }, [])

  const [digits, setDigits] = useState<string[]>(["", "", "", ""])
  const inputs = useRef<(HTMLInputElement | null)[]>([])

  const setDigit = (index: number, raw: string) => {
    const value = raw.replace(/\D/g, "").slice(-1)
    setDigits((prev) => {
      const next = [...prev]
      next[index] = value
      return next
    })
    if (value && index < digits.length - 1) inputs.current[index + 1]?.focus()
  }

  const onKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Backspace" && !digits[index] && index > 0) {
      inputs.current[index - 1]?.focus()
    }
  }

  const code = digits.join("")
  const complete = code.length === digits.length
  const submit = () => {
    if (complete && !locked) onSubmit(code)
  }

  return (
    <div className="flex min-h-screen w-full flex-col bg-canvas">
      <RecipientTopBar>
        <CountdownChip expiresAt={expiresAt} now={now} className="md:hidden" />
        <div className="hidden md:block md:w-auto">
          <Countdown expiresAt={expiresAt} now={now} />
        </div>
      </RecipientTopBar>

      <main className="mx-auto flex w-full max-w-[1080px] flex-1 items-center justify-center px-5 py-10 md:px-8">
        <div className="flex w-full max-w-[520px] flex-col gap-5">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-inset bg-haze md:h-13 md:w-13">
            <PaperPlaneTilt size={24} weight="light" className="text-navy md:hidden" />
            <PaperPlaneTilt size={26} weight="light" className="hidden text-navy md:block" />
          </div>

          <h1 className="text-[26px] font-bold leading-[1.2] tracking-[-0.6px] text-ink md:text-[36px] md:leading-[1.12] md:tracking-[-0.85px]">
            Health data, shared with you
          </h1>
          <p className="text-[15px] leading-[1.5] text-secondary md:text-[17px]">
            Enter the code you were sent to open it.
          </p>

          <div className="flex flex-col gap-2.5">
            <span className="text-[15px] font-semibold leading-[1.33] text-ink">
              The four-digit code you were sent separately
            </span>
            <div className="flex w-full gap-2.5">
              {digits.map((digit, index) => (
                <input
                  key={index}
                  ref={(el) => {
                    inputs.current[index] = el
                  }}
                  value={digit}
                  onChange={(event) => setDigit(index, event.target.value)}
                  onKeyDown={(event) => onKeyDown(index, event)}
                  disabled={locked}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={1}
                  aria-label={`Code digit ${index + 1} of ${digits.length}`}
                  className={`h-16 w-full rounded-control border-[1.5px] bg-surface text-center text-[22px] font-semibold text-ink shadow-control outline-none disabled:opacity-50 md:h-[64px] ${
                    digit ? "border-ink" : "border-hairline"
                  }`}
                />
              ))}
            </div>
            <p className="text-[13px] leading-[1.38] text-secondary">
              They sent this on its own, away from the link — check your messages.
            </p>
            {error && <p className="text-[13px] leading-[1.38] text-error">{error}</p>}
          </div>

          <Action fullWidth disabled={!complete || locked} onClick={submit}>
            Open it
          </Action>
        </div>
      </main>
    </div>
  )
}

/**
 * 3.2 "What she opens" — pen ids `XhRxB` (desktop) / `X4AJCV` (mobile), read
 * via the pencil MCP tool. Both frames draw the fully structured-record
 * future (sleep charts, a biomarker table with lab ranges, an assistant
 * offer) that H-13/H-36 have not wired up yet — this send ships files, not
 * archive records. Rendering those cards from hardcoded fixtures would make
 * the demo contradict the data model, so this view keeps only what the
 * current model actually has: the attribution, the countdown (now in the
 * top bar, per H-2's primitive), a file switcher for a bundle, the file
 * itself, and the growth hook. See `docs/stories/H-5.md` `## Choices`.
 */
function Viewer({ send, onExpired }: { send: OpenedSend; onExpired: () => void }) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  const [active, setActive] = useState(0)

  // The window can close while the page is open. When it does the documents go
  // away under the reader rather than sitting there with an "expired" label
  // beside them — the countdown is the access, not a decoration on it.
  useEffect(() => {
    const timer = setInterval(() => {
      const seconds = Math.floor(Date.now() / 1000)
      if (send.expiresAt > 0 && send.expiresAt <= seconds) {
        onExpired()
        return
      }
      setNow(seconds)
    }, 1000)
    return () => clearInterval(timer)
  }, [send.expiresAt, onExpired])

  const file = send.files[active] ?? send.files[0]
  const many = send.files.length > 1

  return (
    <div className="flex min-h-screen w-full flex-col bg-canvas">
      <RecipientTopBar>
        {/* Frame `X4AJCV`'s top bar carries a compact one-line pill beside
            the wordmark at every width — `CountdownChip`, not the taller
            `Countdown` card, which stays reserved for the ≥md slot per
            `XhRxB`. */}
        <CountdownChip expiresAt={send.expiresAt} now={now} className="md:hidden" />
        <div className="hidden md:block md:w-auto">
          <Countdown expiresAt={send.expiresAt} now={now} />
        </div>
      </RecipientTopBar>

      <main className="mx-auto w-full max-w-[1080px] flex-1 px-5 py-6 md:px-8 md:py-8 xl:px-12">
        <div className="flex w-full flex-col gap-3.5">
          <header className="flex w-full flex-col gap-1">
            <h1 className="text-[22px] font-bold leading-[1.2] tracking-[-0.45px] text-ink md:text-[19px] md:font-semibold md:leading-normal md:tracking-normal">
              Shared with you
            </h1>
            <p className="text-[13px] text-muted md:text-[14px]">
              {send.files.length} document{send.files.length === 1 ? "" : "s"} · nothing to download
            </p>
          </header>

          {many && (
            <div className="w-full divide-y divide-hairline overflow-hidden rounded-card bg-surface shadow-card">
              {send.files.map((f, index) => (
                <ListRow
                  key={`${f.header.name}-${index}`}
                  icon={BookOpen}
                  label={f.header.name}
                  value={index === active ? "Viewing" : undefined}
                  showCaret={false}
                  onClick={() => setActive(index)}
                />
              ))}
            </div>
          )}

          <div className="w-full overflow-hidden rounded-card bg-surface shadow-card">
            <div className="flex w-full items-center gap-2.5 border-b border-hairline px-5 py-4">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-glyph bg-haze">
                <BookOpen size={15} weight="light" className="text-navy" />
              </div>
              <span className="flex-1 truncate text-[17px] font-semibold text-ink">
                {file.header.name}
              </span>
              <span className="shrink-0 text-[13px] text-muted">{formatFileMeta(file)}</span>
            </div>
            <div className="p-5">
              <Preview file={file} />
            </div>
          </div>

          <div className="flex w-full flex-col items-center gap-3 rounded-card bg-grouped p-4 md:flex-row md:gap-4 md:p-5">
            <div className="flex w-full items-center gap-3 md:w-auto md:flex-1">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-glyph bg-haze md:h-[34px] md:w-[34px]">
                <PaperPlaneTilt size={17} weight="light" className="text-navy" />
              </div>
              <div className="flex flex-1 flex-col gap-0.5">
                <p className="text-[14.5px] font-semibold text-ink md:text-[15px]">
                  Do you send health data too?
                </p>
                <p className="text-[12.5px] text-secondary md:hidden">
                  Nothing you have read here comes with you.
                </p>
                <p className="hidden text-[13px] text-secondary md:block">
                  Make your own archive. Nothing you have read here comes with you.
                </p>
              </div>
            </div>
            <Link
              href="/landing"
              className="inline-flex h-10 shrink-0 items-center justify-center rounded-control border border-hairline bg-surface px-3.5 text-[13.5px] font-semibold text-ink md:h-11"
            >
              <span className="md:hidden">Create yours</span>
              <span className="hidden md:inline">Create your archive</span>
            </Link>
          </div>
        </div>
      </main>
    </div>
  )
}

/** "PDF · 240 KB" — the coarse kind and size, both read straight off the file. */
function formatFileMeta(file: PackedFile): string {
  const kind = classify({ name: file.header.name, type: "" })
  const label = kind === "pdf" ? "PDF" : kind === "csv" ? "CSV" : "Text"
  return `${label} · ${formatBytes(file.header.size)}`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Render in place, no download button.
 *
 * The blob URL is deliberately created and revoked with the component rather
 * than handed to the user: the product claim is access for a window, and a
 * download button quietly contradicts it.
 */
function Preview({ file }: { file: PackedFile }) {
  // Classified from the filename only. The sender's declared MIME type is never
  // trusted and never reaches a Blob.
  const kind = classify({ name: file.header.name, type: "" })

  if (kind === "pdf") return <PdfPreview file={file} />

  const text = new TextDecoder().decode(file.body)
  if (kind === "csv") return <CsvTable text={text} />

  return (
    <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap font-mono text-xs">{text}</pre>
  )
}

/**
 * A PDF, rendered in place and trusted with nothing.
 *
 * Two separate holes are closed here, and both matter because the sender
 * controls this file completely — they encrypted it themselves.
 *
 * The Blob type is pinned to `application/pdf` rather than taken from the
 * envelope. A file named `report.pdf` declaring `text/html` would otherwise
 * render as a document; blob URLs inherit this page's origin, and this page
 * holds the link secret in its fragment. A file that is not really a PDF now
 * simply fails to display, which is the right outcome.
 *
 * The frame carries no `sandbox` attribute — Chrome refuses to run its
 * built-in PDF viewer inside a sandboxed frame at all. The byte check is
 * what stands in for it, and the long comment on the `<iframe>` below
 * records what that costs and why it is survivable.
 *
 * The URL is set imperatively so that creating and revoking it belong to one
 * effect: a discarded render cannot leak an allocation, and a replayed effect
 * cannot revoke a URL still in use.
 */
function PdfPreview({ file }: { file: PackedFile }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const isPdf = looksLikePdf(file.body)

  useEffect(() => {
    if (!isPdf) return
    const url = URL.createObjectURL(new Blob([file.body as BlobPart], { type: "application/pdf" }))
    if (frame.current) frame.current.src = `${url}#toolbar=0&navpanes=0&scrollbar=0`
    return () => URL.revokeObjectURL(url)
  }, [file, isPdf])

  if (!isPdf) {
    return (
      <p className="text-sm text-muted">
        This file is named like a PDF but its contents are not one, so it will not be displayed.
      </p>
    )
  }

  return (
    <iframe
      ref={frame}
      // No `sandbox` here, deliberately, and it is worth writing down why.
      //
      // Chrome refuses to run its built-in PDF viewer inside a sandboxed frame
      // at all — we tested `sandbox=""` and `sandbox="allow-same-origin
      // allow-scripts"` (which is barely a sandbox) and both render a broken
      // document instead of the file. Sandboxing and the built-in viewer are
      // mutually exclusive.
      //
      // So the defence is the two checks above rather than the frame: the Blob
      // type is pinned to application/pdf and the bytes must start with
      // `%PDF-`. Blob URLs are served with the type they were created with and
      // are not content-sniffed, so the frame can only ever receive something
      // the browser hands to its PDF viewer. The original hole — a sender
      // declaring `text/html` and reaching a document context — is closed at
      // the source.
      //
      // Real defence in depth here means not using the browser's viewer:
      // render with pdf.js into a canvas, where no document context exists to
      // capture. That is the right fix and it is not a weekend's work.
      referrerPolicy="no-referrer"
      title={file.header.name}
      className="h-[70vh] w-full rounded-lg border border-hairline"
    />
  )
}

/**
 * Does this actually start with a PDF header?
 *
 * The sender controls the whole file — they encrypted it — so neither the
 * filename nor the declared MIME type is evidence of anything. Without this
 * check, a file named `report.pdf` carrying HTML would reach a Blob, and a blob
 * URL inherits this page's origin, where the link secret lives in the fragment.
 * Two independent things now have to hold before anything renders: the type we
 * pin, and the bytes themselves.
 */
function looksLikePdf(body: Uint8Array): boolean {
  const magic = "%PDF-"
  if (body.length < magic.length) return false
  for (let i = 0; i < magic.length; i++) {
    if (body[i] !== magic.charCodeAt(i)) return false
  }
  return true
}

function CsvTable({ text }: { text: string }) {
  // Enough for the fixtures this demo ships; a real importer is explicitly out
  // of scope and nobody is judging the parser.
  const rows = text
    .trim()
    .split(/\r?\n/)
    .slice(0, 200)
    .map((line) => line.split(","))
  const [head, ...body] = rows

  return (
    <div className="max-h-[70vh] overflow-auto">
      <table className="w-full text-left text-xs">
        <thead className="sticky top-0 bg-surface">
          <tr className="border-b border-hairline">
            {head?.map((cell, index) => (
              <th key={index} className="whitespace-nowrap px-2 py-1.5 font-medium">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-b border-hairline/60">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="whitespace-nowrap px-2 py-1.5 font-mono">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * The shared shell for 3.3 and 3.4 — pen ids `RqJ31`/`f9lYQS` (light, read via
 * the pencil MCP tool) and `WtHlp`/`zHvvF` (dark). Both frames place a bare
 * wordmark over a full-bleed canvas, one panel centred on it, and a footnote
 * near the bottom edge — no bordered top bar (`RecipientTopBar`'s look does
 * not appear in either frame). One component parameterised by `tone` rather
 * than two copies, so 3.3 and 3.4 cannot drift into different spacing by
 * accident — the drift this whole story exists to prevent.
 *
 * `tone="dark"` is the one surface in this light-only product that inverts:
 * `$panel-on-dark` / `$hairline-on-dark` per CLAUDE.md, and fixed `text-white`
 * / `text-[#E4E5E7]` rather than themed `text-surface` — the same fixed-dark
 * exception `FocusCard` already carries in `components/ui.tsx`, for the same
 * reason: this gradient never themes, so its foreground must not either.
 */
function TerminalScreen({
  tone,
  icon: IconComponent,
  headline,
  body,
  note,
  extraNote,
  debug,
  foot,
}: {
  tone: "light" | "dark"
  icon: PhosphorIcon
  headline: string
  body: string
  note: string
  extraNote?: string
  debug?: string
  foot?: string
}) {
  const dark = tone === "dark"
  return (
    <div
      className="flex min-h-screen w-full flex-col px-7 pb-10 pt-14 md:px-12 md:pb-16 md:pt-9"
      style={
        dark
          ? {
              background:
                "linear-gradient(155deg, var(--color-grad-focus-from) 0%, var(--color-grad-focus-to) 100%)",
            }
          : { background: "var(--color-canvas)" }
      }
    >
      <span
        className={`text-[15px] font-semibold tracking-[-0.3px] md:text-[17px] md:tracking-[-0.35px] ${
          dark ? "text-white" : "text-ink"
        }`}
      >
        healthsend
      </span>

      <div className="flex flex-1 items-center justify-center py-10">
        <div
          className={`flex w-full flex-col gap-4 rounded-card border p-[26px] backdrop-blur-xl md:max-w-[560px] md:p-[30px] ${
            dark ? "border-hairline-on-dark bg-panel-on-dark" : "border-hairline bg-surface"
          }`}
        >
          <div
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-control border md:h-[46px] md:w-[46px] ${
              dark ? "border-hairline-on-dark bg-surface/12" : "border-hairline bg-grouped"
            }`}
          >
            <IconComponent size={22} weight="light" className={dark ? "text-white" : "text-secondary"} />
          </div>

          <h1
            className={`text-[26px] font-bold leading-[1.2] tracking-[-0.6px] md:text-[32px] md:leading-[1.15] md:tracking-[-0.8px] ${
              dark ? "text-white" : "text-ink"
            }`}
          >
            {headline}
          </h1>

          <p className={`text-[15px] leading-[1.5] md:text-[16px] ${dark ? "text-[#E4E5E7]" : "text-secondary"}`}>
            {body}
          </p>

          <div className={`h-px w-full ${dark ? "bg-hairline-on-dark" : "bg-hairline"}`} />

          <p className={`text-[13px] leading-[1.45] md:text-[14px] ${dark ? "text-silver" : "text-secondary"}`}>
            {note}
          </p>

          {extraNote && (
            <p className={`text-[13px] leading-[1.45] md:text-[14px] ${dark ? "text-silver" : "text-secondary"}`}>
              {extraNote}
            </p>
          )}

          {debug && <p className="font-mono text-[11px] text-muted">{debug}</p>}
        </div>
      </div>

      {foot && <p className={`text-[12px] md:text-[13px] ${dark ? "text-silver" : "text-muted"}`}>{foot}</p>}
    </div>
  )
}

/**
 * 3.4 — the grant is gone from Arkiv's index, whether it lapsed on its own or
 * the sender ended it early. Both draw `WtHlp`/`zHvvF`'s dark focus treatment
 * — ending is the payoff, the one page in the product that flips — but the
 * headline and body keep the wording `openSend` already earns them rather
 * than the frame's generic "This has ended": e2e (`e2e/recipient.spec.ts`)
 * pins the exact strings below because collapsing them is precisely the
 * confusion this story exists to prevent, and an earlier version of this page
 * did once collapse the natural-expiry case into a false, broader claim (see
 * the git history on the copy below) — the distinction is load-bearing, not
 * decorative.
 */
function Ended({ revoked }: { revoked: boolean }) {
  return (
    <TerminalScreen
      tone="dark"
      icon={LockSimple}
      headline={revoked ? "The sender ended this link" : "This link has expired"}
      body={
        revoked
          ? "They closed it before the time they’d first set. Nothing went wrong on your side."
          : "It stopped working at the time the sender chose. Nobody closed it early, and nothing went wrong."
      }
      // Plain words, same honesty (operator, 2026-09-13): ending access is not erasure. No date —
      // once a grant has gone there is nothing on this page that knows when it ended. No promised
      // window either — links can be minutes long.
      note="The document hasn’t been deleted. It’s still stored, encrypted, where it was kept. This link just can’t open it any more."
      extraNote="Still need it? Ask the sender for a new link."
    />
  )
}

/**
 * 3.3 — the holder could not be reached. This must never be dressed up as
 * expiry: expiry is a fact about the sender's intention, this is a fact about
 * our infrastructure, and the difference is the price paid for being able to
 * expire anything at all. `RqJ31`/`f9lYQS` stay in the ordinary light chrome
 * on purpose — see `TerminalScreen` — so a reader skimming this page cannot
 * come away believing their access ended, because it has not.
 */
function Unavailable({ message }: { message: string }) {
  return (
    <TerminalScreen
      tone="light"
      icon={CloudSlash}
      headline="Temporarily unavailable"
      body="This has not ended. The service that holds half the key could not be reached just now, so this page cannot put it back together yet."
      note="Try again in a moment. If it keeps failing, ask the sender — they still have the documents and can send a fresh link."
      debug={message}
      foot="Nothing is wrong with your link."
    />
  )
}

function NoKey() {
  return (
    <Card>
      <h1 className="text-lg font-semibold">Incomplete link</h1>
      <p className="mt-2 text-sm text-muted">
        This link is missing the part after the <code className="font-mono">#</code>, which carries
        half the decryption key. It was probably truncated when it was copied — ask the sender for
        the full link.
      </p>
    </Card>
  )
}

function Failed({ message }: { message: string }) {
  return (
    <Card>
      <h1 className="text-lg font-semibold">Could not open this send</h1>
      <p className="mt-2 text-sm text-muted">
        The grant was found but the document would not decrypt. That usually means the link secret
        does not match this grant.
      </p>
      <p className="mt-3 font-mono text-xs text-muted">{message}</p>
    </Card>
  )
}
