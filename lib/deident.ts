import { inflateSync } from "node:zlib"

/**
 * What import sets aside before anything reaches the archive or a send.
 * Visible to the sender who imported the document; never a field on a
 * shared record (see `RecordProvenance.setAside` in `archive.ts`).
 */
export type SetAsideIdentifiers = {
  name?: string
  dateOfBirth?: string
  address?: string
  patientId?: string
}

type LabelPattern = { key: keyof SetAsideIdentifiers; source: string }

/**
 * One labeled line pulls one field. The label can sit anywhere in the
 * document — a leading metadata line, a PDF text run, a stray CSV column —
 * because a real lab export puts the header block wherever its own template
 * happened to put it, not where a parser would prefer.
 */
const LABEL_PATTERNS: LabelPattern[] = [
  { key: "name", source: "\\b(?:patient\\s*name|patient|name)\\s*[:\\-]\\s*([^\\n\\r,|]+)" },
  { key: "dateOfBirth", source: "\\b(?:date of birth|dob)\\s*[:\\-]\\s*([^\\n\\r,|]+)" },
  { key: "address", source: "\\baddress\\s*[:\\-]\\s*([^\\n\\r|]+)" },
  {
    key: "patientId",
    source: "\\b(?:mrn|patient id|patient number|record\\s*#|record number)\\s*[:\\-]\\s*([^\\n\\r,|]+)",
  },
]

const SET_ASIDE_PLACEHOLDER = "[set aside]"

/**
 * Find every labeled identifier in a text and strip it — the label, the
 * value, and any other place the same value string recurs in the document
 * (a name mentioned again in a note body, say). What remains is what a
 * recipient may see; what is returned is what the sender still gets to see.
 */
export function deidentifyText(raw: string): { cleaned: string; setAside: SetAsideIdentifiers } {
  const setAside: SetAsideIdentifiers = {}
  for (const { key, source } of LABEL_PATTERNS) {
    const match = new RegExp(source, "i").exec(raw)
    const value = match?.[1]?.trim()
    if (value) setAside[key] = value
  }

  let cleaned = raw
  for (const { source } of LABEL_PATTERNS) {
    cleaned = cleaned.replace(new RegExp(source, "gi"), "")
  }
  for (const value of Object.values(setAside)) {
    if (!value) continue
    // A value recurring later in free text can be wrapped across a line —
    // "Jane\nRivera" — so the scrub matches on words rather than the exact
    // literal, or a PDF's fixed line width would let the name straight through.
    const wordPattern = value
      .trim()
      .split(/\s+/)
      .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("\\s+")
    cleaned = cleaned.replace(new RegExp(wordPattern, "gi"), SET_ASIDE_PLACEHOLDER)
  }
  return { cleaned, setAside }
}

/** Undo the small set of escapes PDF text-showing operators use inside `( … )`. */
function unescapePdfString(literal: string): string {
  return literal.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, code: string) => {
    switch (code) {
      case "n":
        return "\n"
      case "r":
        return "\r"
      case "t":
        return "\t"
      case "b":
        return "\b"
      case "f":
        return "\f"
      case "(":
        return "("
      case ")":
        return ")"
      case "\\":
        return "\\"
      default:
        return String.fromCharCode(parseInt(code, 8))
    }
  })
}

/**
 * Pull the shown text out of one decoded PDF content stream: every `(…) Tj`
 * and every `(…)` inside a `[ … ] TJ` array, in the order the stream draws
 * them. Good enough to find identifiers and marker rows in the fixtures this
 * product ships — not a general PDF renderer.
 */
function extractShownText(content: string): string {
  const runs: string[] = []
  const stringPattern = /\(((?:[^()\\]|\\.)*)\)/g
  let match: RegExpExecArray | null
  while ((match = stringPattern.exec(content))) {
    runs.push(unescapePdfString(match[1]))
  }
  return runs.join("\n")
}

/**
 * Decode every content stream in a PDF and concatenate the text it shows.
 * Streams marked `/FlateDecode` are inflated first; other streams (this
 * product only ever writes plain ones) are read as-is.
 */
export function extractPdfText(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes).toString("latin1")
  const objectPattern = /<<([^]*?)>>\s*stream\r?\n([^]*?)\r?\nendstream/g
  const pages: string[] = []
  let match: RegExpExecArray | null
  while ((match = objectPattern.exec(raw))) {
    const [, dict, streamBody] = match
    let content: string
    try {
      content = /FlateDecode/.test(dict)
        ? inflateSync(Buffer.from(streamBody, "latin1")).toString("latin1")
        : streamBody
    } catch {
      // Not every stream in a PDF is text (an ICC profile, a font program).
      // One that fails to inflate as expected is one of those, not ours.
      continue
    }
    if (/\bTj\b|\bTJ\b/.test(content)) pages.push(extractShownText(content))
  }
  return pages.join("\n")
}

export type DocumentFormat = "pdf" | "csv" | "text"

/** Decode a raw import into the text a de-identification pass can scan. */
export function extractDocumentText(bytes: Uint8Array, format: DocumentFormat): string {
  if (format === "pdf") return extractPdfText(bytes)
  return Buffer.from(bytes).toString("utf-8")
}
