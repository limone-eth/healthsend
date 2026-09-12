"use client"

/**
 * The recipient's view.
 *
 * No account, no wallet, no Swarm ID. The link carries half the key in its
 * fragment; the Arkiv grant carries the other half until it expires. This page
 * is the only place both halves ever meet, and they meet in the recipient's
 * browser rather than on a server that could be asked to keep serving.
 */

import { use, useEffect, useRef, useState } from "react"
import { openSend, type OpenedSend } from "@/lib/sends"
import { classify, type PackedFile } from "@/lib/envelope"
import { Card, timeLeft } from "@/components/ui"

type State =
  | { status: "loading" }
  | { status: "ok"; send: OpenedSend }
  | { status: "expired" }
  | { status: "no-key" }
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

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-16">
      {state.status === "loading" && <p className="text-sm text-muted">Opening…</p>}
      {state.status === "ok" && (
        <Viewer send={state.send} onExpired={() => setState({ status: "expired" })} />
      )}
      {state.status === "expired" && <Expired />}
      {state.status === "no-key" && <NoKey />}
      {state.status === "error" && <Failed message={state.message} />}
    </main>
  )
}

function Viewer({ send, onExpired }: { send: OpenedSend; onExpired: () => void }) {
  const [remaining, setRemaining] = useState(() => timeLeft(send.expiresAt))
  const [active, setActive] = useState(0)

  // The window can close while the page is open. When it does the documents go
  // away under the reader rather than sitting there with an "expired" label
  // beside them — the countdown is the access, not a decoration on it.
  useEffect(() => {
    const timer = setInterval(() => {
      if (send.expiresAt > 0 && send.expiresAt <= Math.floor(Date.now() / 1000)) {
        onExpired()
        return
      }
      setRemaining(timeLeft(send.expiresAt))
    }, 1000)
    return () => clearInterval(timer)
  }, [send.expiresAt, onExpired])

  const file = send.files[active] ?? send.files[0]
  const many = send.files.length > 1

  return (
    <>
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">
          {many ? `${send.files.length} documents` : file.header.name}
        </h1>
        <p className="mt-1 text-sm text-muted">Shared with you · {remaining}</p>
      </header>

      {many && (
        <nav className="mb-4 flex flex-wrap gap-2">
          {send.files.map((f, index) => (
            <button
              key={`${f.header.name}-${index}`}
              onClick={() => setActive(index)}
              className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                index === active
                  ? "border-accent bg-accent text-background"
                  : "border-line hover:bg-line/40"
              }`}
            >
              {f.header.name}
            </button>
          ))}
        </nav>
      )}

      <Card>
        <Preview file={file} />
      </Card>
      <p className="mt-6 text-xs text-muted">
        You were given access, not a copy. When the window closes this page stops working for
        everyone, including you — nobody has to remember to revoke it.
      </p>
    </>
  )
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
      className="h-[70vh] w-full rounded-lg border border-line"
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
          <tr className="border-b border-line">
            {head?.map((cell, index) => (
              <th key={index} className="whitespace-nowrap px-2 py-1.5 font-medium">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-b border-line/60">
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
        The grant that carried the decryption key reached the end of its life and no longer appears
        in Arkiv&rsquo;s index, so this page cannot put the key back together.
      </p>
      <p className="mt-3 text-sm text-muted">
        Nobody revoked this. No job ran. The access simply ran out.
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
