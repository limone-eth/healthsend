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
  { key: "name", source: "\\b(?:patient\\s*name|patient|name)\\s*[:\\-]\\s*([^\\n\\r|]+)" },
  { key: "dateOfBirth", source: "\\b(?:date of birth|dob)\\s*[:\\-]\\s*([^\\n\\r|]+)" },
  { key: "address", source: "\\baddress\\s*[:\\-]\\s*([^\\n\\r|]+)" },
  {
    key: "patientId",
    source: "\\b(?:mrn|patient id|patient number|record\\s*#|record number)\\s*[:\\-]\\s*([^\\n\\r|]+)",
  },
]

/**
 * A name is a short run of capitalized words — "Rivera, Jane", "Jane Rivera".
 * A clinical sentence read off the same label ("denies chest pain today.")
 * starts each word lowercase and runs longer than a name ever does, so it
 * fails here and is left as the clinical content it is.
 */
function looksLikeName(value: string): boolean {
  const words = value.trim().split(/\s+/)
  if (words.length === 0 || words.length > 5) return false
  return words.every((word) => /^[A-Z][A-Za-z'.-]*,?$/.test(word))
}

const SET_ASIDE_PLACEHOLDER = "[set aside]"

/**
 * A value recurring later in free text can be wrapped across a line —
 * "Jane\nRivera" — so recurrence matches on words rather than the exact
 * literal, or a PDF's fixed line width would let the name straight through.
 */
function wordPattern(value: string): string {
  const escaped = value
    .trim()
    .split(/\s+/)
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+")
  return `\\b${escaped}\\b`
}

function containsWordSequence(text: string, value: string): boolean {
  return new RegExp(wordPattern(value), "i").test(text)
}

/** Month names, long and short, for a date written out rather than numbered. */
const MONTH_NAMES = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?"

/**
 * The three date shapes a birth date is actually written in: ISO, slashed,
 * and spelled out. Each alternative tags its year with a distinct named
 * group so the caller can read off the year without caring which shape hit.
 */
const DOB_SHAPE_SOURCE =
  `\\b(?:(?<isoYear>\\d{4})-\\d{2}-\\d{2}` +
  `|\\d{1,2}\\/\\d{1,2}\\/(?<slashYear>\\d{4})` +
  `|\\d{1,2}\\s+(?:${MONTH_NAMES})\\.?\\s+(?<longYear>\\d{4}))\\b`

/** How far into a document "near the top" reaches — a letterhead or a `Re:` line, not a buried table. */
const DOB_TOP_WINDOW = 500

const MIN_BIRTH_YEAR = 1900

/** A birth date is written years before today; a report or a lab draw date is written close to it. */
function maxBirthYear(): number {
  return new Date().getFullYear() - 5
}

/**
 * A date-of-birth-shaped value near the top of a document, whether or not a
 * label precedes it — a letterhead, a `Re:` line, a caption under a name.
 * The year is what separates it from an ordinary report or draw date: a
 * birth year reads years in the past, where a report date reads as current.
 */
function findUnlabeledDateOfBirth(raw: string): string | undefined {
  const nearTop = raw.slice(0, DOB_TOP_WINDOW)
  const pattern = new RegExp(DOB_SHAPE_SOURCE, "gi")
  let match: RegExpExecArray | null
  while ((match = pattern.exec(nearTop))) {
    const year = Number(match.groups?.isoYear ?? match.groups?.slashYear ?? match.groups?.longYear)
    const precedingText = nearTop.slice(0, match.index)
    // Already somebody else's labeled value ("Collected: 2019-01-04") — not
    // an unlabeled date, so it is not this heuristic's to claim.
    if (/:\s*$/.test(precedingText)) continue
    if (year >= MIN_BIRTH_YEAR && year <= maxBirthYear()) return match[0].trim()
  }
  return undefined
}

export type DeidentifyOptions = {
  /** The importing sender's own account name, if known — scanned for wherever it appears, not only after a label. */
  accountName?: string
}

/**
 * Find every identifier in a text and strip it — the label if there was one,
 * the value, and any other place the same value string recurs in the
 * document (a name mentioned again in a note body, say). What remains is
 * what a recipient may see; what is returned is what the sender still gets
 * to see.
 *
 * Labeled identifiers are read first, because a label is explicit evidence
 * and the two heuristics below are not: an unlabeled match never overrides
 * one, it only fills a gap the label pass left empty. Every value that ends
 * up scrubbed — labeled or not — still gets its recurrences removed, even a
 * value that loses out to a label match for the single `name` field the
 * sender sees.
 */
export function deidentifyText(raw: string, options: DeidentifyOptions = {}): { cleaned: string; setAside: SetAsideIdentifiers } {
  const setAside: SetAsideIdentifiers = {}
  const scrubValues = new Set<string>()

  // Stripped one match at a time rather than "find first, then blanket-erase
  // every occurrence of the pattern": a `name` match that does not look like
  // a name is not an identifier, and must survive as the clinical line it is
  // rather than being erased alongside the ones that are.
  let cleaned = raw
  for (const { key, source } of LABEL_PATTERNS) {
    cleaned = cleaned.replace(new RegExp(source, "gi"), (full: string, capture: string) => {
      const value = capture?.trim()
      if (!value) return full
      if (key === "name" && !looksLikeName(value)) return full
      if (setAside[key] === undefined) setAside[key] = value
      scrubValues.add(value)
      return ""
    })
  }

  const accountName = options.accountName?.trim()
  if (accountName && containsWordSequence(raw, accountName)) {
    setAside.name = setAside.name ?? accountName
    scrubValues.add(accountName)
  }

  if (!setAside.dateOfBirth) {
    const dob = findUnlabeledDateOfBirth(raw)
    if (dob) {
      setAside.dateOfBirth = dob
      scrubValues.add(dob)
    }
  }

  for (const value of scrubValues) {
    cleaned = cleaned.replace(new RegExp(wordPattern(value), "gi"), SET_ASIDE_PLACEHOLDER)
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
