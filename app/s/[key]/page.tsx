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
 */

import { use, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { BookOpen, PaperPlaneTilt } from "@phosphor-icons/react"
import { openSend, type OpenedSend } from "@/lib/sends"
import { classify, type PackedFile } from "@/lib/envelope"
import { Card, Countdown, ListRow } from "@/components/ui"
import { RecipientTopBar } from "@/components/chrome"

type State =
  | { status: "loading" }
  | { status: "ok"; send: OpenedSend }
  | { status: "expired" }
  | { status: "revoked" }
  | { status: "no-key" }
  | { status: "unavailable"; message: string }
  | { status: "error"; message: string }

export default function SharePage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = use(params)
  const [state, setState] = useState<State>({ status: "loading" })

  useEffect(() => {
    // The fragment is readable only here — it was never sent with the request.
    const linkSecret = window.location.hash.replace(/^#/, "")
    let cancelled = false
    openSend(key, linkSecret).then((result) => {
      if (cancelled) return
      setState(result.status === "ok" ? { status: "ok", send: result.send } : result)
    })
    return () => {
      cancelled = true
    }
  }, [key])

  // The "ok" branch draws its own chrome (RecipientTopBar, no rail, no tabs)
  // per H-5. Every other status is H-6's to restyle, so it keeps the plain
  // centred wrapper this page always had rather than inheriting the new one.
  if (state.status === "ok") {
    return <Viewer send={state.send} onExpired={() => setState({ status: "expired" })} />
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-16">
      {state.status === "loading" && <p className="text-sm text-muted">Opening…</p>}
      {state.status === "expired" && <Expired />}
      {state.status === "revoked" && <Revoked />}
      {state.status === "unavailable" && <Unavailable message={state.message} />}
      {state.status === "no-key" && <NoKey />}
      {state.status === "error" && <Failed message={state.message} />}
    </main>
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
        {/* The 56px Countdown row can run to "Expires Saturday · 1 hour
            left" — too wide to share the fixed 64px top bar with the
            wordmark below md, where it would wrap and overflow. It moves
            into the column below on mobile instead, full-width, and stays
            in the top bar's slot at md and up, per RecipientTopBar's own
            design (chrome.tsx: "scope chips, the countdown — is a slot"). */}
        <div className="hidden md:block md:w-full md:max-w-[300px]">
          <Countdown expiresAt={send.expiresAt} now={now} />
        </div>
      </RecipientTopBar>

      <main className="mx-auto w-full max-w-[1080px] flex-1 px-5 py-6 md:px-8 md:py-8 xl:px-12">
        <div className="flex w-full flex-col gap-3.5">
          <div className="md:hidden">
            <Countdown expiresAt={send.expiresAt} now={now} />
          </div>

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
                  Same sign-in you used to open this.
                </p>
                <p className="hidden text-[13px] text-secondary md:block">
                  Make your own archive with the same account you used to open this. Nothing you
                  have read here comes with you.
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
 * The frame is then sandboxed with nothing granted at all — no scripts, no
 * same-origin, no forms, no top-level navigation. The built-in PDF viewer is
 * browser chrome rather than page script, so it still renders.
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

function Expired() {
  return (
    <Card>
      <h1 className="text-lg font-semibold">This link has expired</h1>
      <p className="mt-2 text-sm text-muted">
        The grant reached the end of its life and no longer appears in Arkiv&rsquo;s index. The
        holder checks for it before serving its half of the key, so there is no longer a second
        half to put this one together with.
      </p>
      <p className="mt-3 text-sm text-muted">
        Nobody ended this early. No job ran. The access simply ran out.
      </p>
      {/* An earlier version of this page said there was "no key anywhere that
          opens it, including ours". That was false, and it is not the kind of
          thing to be vague about on the page a reader actually sees. */}
      <p className="mt-4 text-xs text-muted">
        To be precise about what that does and does not mean: the encrypted document is still on
        Swarm, and the grant&rsquo;s contents remain in the transaction that created it. Expiry ends
        access through this app. It is not erasure.
      </p>
    </Card>
  )
}

/**
 * The sender ended access before the window closed on its own.
 *
 * A revoke and a lapsed grant both leave the holder with no share, so they
 * surface through the same 410 (see `lib/unlock.ts`). But they are not the
 * same fact for the reader: nobody chose the one above, and someone did
 * choose this one. Neither reads as a failure — the sender ending a share
 * they made is the feature working, not an error — and neither may claim
 * more than expiry claims: the document still exists on Swarm and in chain
 * history, unreachable through this app rather than gone.
 */
function Revoked() {
  return (
    <Card>
      <h1 className="text-lg font-semibold">Access to this send has ended</h1>
      <p className="mt-2 text-sm text-muted">
        The sender ended it early, before the window they set had closed. Nothing went wrong on
        either side.
      </p>
      <p className="mt-4 text-xs text-muted">
        To be precise about what that does and does not mean: the encrypted document is still on
        Swarm, and the grant&rsquo;s contents remain in the transaction that created it. Ending
        access stops it being reopened through this app. It is not erasure.
      </p>
    </Card>
  )
}

/**
 * The holder could not be reached.
 *
 * This must never be dressed up as expiry. Expiry is a fact about the sender's
 * intention; this is a fact about our infrastructure, and the difference is the
 * price we pay for being able to expire anything at all. Telling someone their
 * access ended when it did not is the same class of lie as telling them it is
 * gone when it is not.
 */
function Unavailable({ message }: { message: string }) {
  return (
    <Card>
      <h1 className="text-lg font-semibold">Temporarily unavailable</h1>
      <p className="mt-2 text-sm text-muted">
        This link has <strong>not</strong> expired. The service that holds half of the decryption
        key could not be reached just now, so the key cannot be put back together. Try again in a
        moment.
      </p>
      <p className="mt-3 text-xs text-muted">
        If it keeps failing, ask the sender — they still hold the document and can re-share it.
      </p>
      <p className="mt-3 font-mono text-xs text-muted">{message}</p>
    </Card>
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
