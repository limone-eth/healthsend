import { readFileSync } from "node:fs"
import path from "node:path"
// Relative, not the `@/` alias: this module also loads directly under plain
// Node (`scripts/import-review-proof.mjs`), which has no bundler to resolve
// `@/` against `tsconfig.json`'s `paths`.
import { deidentifyText, extractDocumentText } from "../../../lib/deident.ts"
import { importDocument } from "../../../lib/import.ts"
import type { DocumentFormat } from "../../../lib/deident.ts"
import type { BloodPanelReviewData, DocumentReviewData, MarkerRow, ReviewData } from "./review-screen"

/**
 * Split out of `page.tsx` (no JSX here) so `scripts/import-review-proof.mjs`
 * can exercise `buildReview`/`markerSourceLines` directly, without Next.js.
 */

const SENDER_ACCOUNT_NAME = "Jordan Vance"
const IMPORTED_AT = "2026-08-12T09:00:00.000Z"
const TAKEN_ON = "2026-08-12"

export const FIXTURES: { file: string; format: DocumentFormat; label: string }[] = [
  { file: "thyroid-panel.csv", format: "csv", label: "Thyroid panel" },
  { file: "patient-panel.csv", format: "csv", label: "Patient panel" },
  { file: "letterhead-report.txt", format: "text", label: "Consult note" },
]

function loadFixture(file: string): Uint8Array {
  return new Uint8Array(readFileSync(path.join(process.cwd(), "fixtures", file)))
}

/** Mirrors `parseBloodPanelMarkers`'s own header (`lib/import.ts`) — kept here rather than exported from
 *  there, since that module is off-limits to this story. */
const BLOOD_PANEL_HEADER = "marker,value,unit,ref_low,ref_high,flag"

/**
 * The raw candidate marker lines, in file order, filtered by exactly the
 * same rule `parseBloodPanelMarkers` applies (skip anything before the
 * header, skip blank lines, skip anything with fewer than five cells, skip
 * an empty name) — so this list lines up 1:1, by position, with
 * `imported.record.markers`. A blank, qualified or otherwise unreadable
 * value is *not* skipped here any more than it is in the parser: H-57 made
 * every one of those rows a marker in its own right, so dropping its source
 * line here would desync every row after it.
 *
 * R2-018: the previous approach (`findSourceLine`) matched each marker back
 * to a raw line by *name* — the first line whose text started with
 * `"<marker name>,"`. Two markers sharing a name (a repeat test, a marker
 * re-measured on a later panel) would both resolve to the first line found,
 * so the "in your file" column could show one marker's own reading next to
 * a name it does not belong to. Binding by position instead of by name
 * removes the ambiguity a repeated name creates, because import itself
 * never reorders or drops a row without applying this same rule.
 */
export function markerSourceLines(text: string): string[] {
  const lines = text.split(/\r?\n/)
  const headerIndex = lines.findIndex(
    (line) => line.trim().toLowerCase().replace(/\s+/g, "") === BLOOD_PANEL_HEADER.replace(/\s+/g, ""),
  )
  if (headerIndex === -1) return []

  const result: string[] = []
  for (const line of lines.slice(headerIndex + 1)) {
    if (!line.trim()) continue
    const cells = line.split(",").map((cell) => cell.trim())
    if (cells.length < 5) continue
    const [name] = cells
    if (!name) continue
    result.push(line.trim())
  }
  return result
}

export function buildReview(fixture: (typeof FIXTURES)[number]): ReviewData {
  const bytes = loadFixture(fixture.file)
  const rawText = extractDocumentText(bytes, fixture.format)
  const { cleaned } = deidentifyText(rawText, { accountName: SENDER_ACCOUNT_NAME })

  const imported = importDocument({
    bytes,
    format: fixture.format,
    recordId: `record:${fixture.file}`,
    sourceId: `source:${fixture.file}`,
    importedAt: IMPORTED_AT,
    takenOn: TAKEN_ON,
    accountName: SENDER_ACCOUNT_NAME,
  })

  if (imported.kind === "blood-panel") {
    const sourceLines = markerSourceLines(cleaned)
    const markers: MarkerRow[] = imported.record.markers.map((marker, index) => {
      const sourceLine = sourceLines[index]
      return {
        id: marker.id,
        name: marker.name,
        value: marker.value,
        qualifier: marker.qualifier,
        unit: marker.unit,
        snippet: sourceLine ?? `${marker.name}, ${marker.value} ${marker.unit}`,
        labFlag: marker.labFlag,
        flagged: marker.flaggedAtImport,
        flagReason: marker.flaggedAtImport ? marker.flagReason : undefined,
      }
    })
    const review: BloodPanelReviewData = {
      kind: "blood-panel",
      id: fixture.file,
      label: fixture.label,
      fileName: fixture.file,
      markers,
      record: imported.record,
      setAside: imported.record.provenance.setAside ?? {},
    }
    return review
  }

  const review: DocumentReviewData = {
    kind: "document",
    id: fixture.file,
    label: fixture.label,
    fileName: fixture.file,
    rawText,
    cleanedText: imported.cleanedText,
    setAside: imported.setAside,
  }
  return review
}
