/**
 * The plaintext envelope.
 *
 * A send can carry several documents — a lab panel, the sleep export and the
 * consult note belong together, and splitting them across three links would mean
 * three windows to keep track of. So a send is a *bundle*: N files packed into
 * one buffer, sealed under one content key, stored as one blob on Swarm and
 * opened by one grant. One link, one expiry, one thing to reason about.
 *
 * Filenames and MIME types are themselves disclosing ("thyroid-panel-2026.pdf"),
 * so they live inside the sealed region rather than beside it:
 *
 *     [2 bytes: header length, big-endian][UTF-8 JSON header][body 0][body 1]…
 *
 * Bodies are concatenated in header order; each entry's `size` gives its extent.
 * What is left on Swarm is a single opaque blob whose hash reveals nothing but
 * its total length — not how many files it holds, nor what they are called.
 */

export type FileMeta = {
  name: string
  mime: string
  size: number
}

export type PackedFile = {
  header: FileMeta
  body: Uint8Array
}

/** Header of a multi-file bundle. v1 (a bare `FileMeta`) is still readable. */
type BundleHeader = {
  v: 2
  files: FileMeta[]
}

export function packEnvelope(files: PackedFile[]): Uint8Array {
  if (files.length === 0) throw new Error("A send needs at least one file")

  const header: BundleHeader = { v: 2, files: files.map((f) => f.header) }
  const headerBytes = new TextEncoder().encode(JSON.stringify(header))
  if (headerBytes.length > 0xffff) throw new Error("Envelope header too large")

  const bodyLength = files.reduce((total, f) => total + f.body.length, 0)
  const out = new Uint8Array(2 + headerBytes.length + bodyLength)
  out[0] = (headerBytes.length >> 8) & 0xff
  out[1] = headerBytes.length & 0xff
  out.set(headerBytes, 2)

  let offset = 2 + headerBytes.length
  for (const file of files) {
    out.set(file.body, offset)
    offset += file.body.length
  }
  return out
}

export function unpackEnvelope(packed: Uint8Array): PackedFile[] {
  if (packed.length < 2) throw new Error("Envelope truncated")
  const headerLength = (packed[0] << 8) | packed[1]
  const headerEnd = 2 + headerLength
  if (packed.length < headerEnd) throw new Error("Envelope truncated")

  const header = JSON.parse(new TextDecoder().decode(packed.subarray(2, headerEnd)))

  // A v1 envelope is a single `FileMeta` with the body straight after it. Sends
  // are short-lived, but reading the older shape costs three lines.
  const metas: FileMeta[] = Array.isArray(header?.files) ? header.files : [header as FileMeta]

  const files: PackedFile[] = []
  let offset = headerEnd
  for (const meta of metas) {
    const size = Number(meta.size) || 0
    files.push({ header: meta, body: packed.subarray(offset, offset + size) })
    offset += size
  }
  return files
}

export type FileKind = "pdf" | "csv" | "text"

/** Coarse category used as a queryable Arkiv attribute. Deliberately not the MIME type. */
export function classify(file: { name: string; type: string }): FileKind {
  const name = file.name.toLowerCase()
  if (file.type === "application/pdf" || name.endsWith(".pdf")) return "pdf"
  if (file.type === "text/csv" || name.endsWith(".csv")) return "csv"
  return "text"
}

/**
 * One kind for a whole bundle.
 *
 * `mixed` is a real answer rather than a fallback — "this send is a lab PDF plus
 * two CSVs" is exactly the thing a sender filters their dashboard for.
 */
export function classifyBundle(files: { name: string; type: string }[]): FileKind | "mixed" {
  const kinds = new Set(files.map(classify))
  return kinds.size === 1 ? [...kinds][0] : "mixed"
}
