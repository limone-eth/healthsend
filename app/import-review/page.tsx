import { readFileSync } from "node:fs"
import path from "node:path"
import { SenderChrome } from "@/components/chrome"
import { deidentifyText, extractDocumentText } from "@/lib/deident"
import { importDocument } from "@/lib/import"
import type { DocumentFormat } from "@/lib/deident"
import {
  ReviewScreen,
  type BloodPanelReviewData,
  type DocumentReviewData,
  type MarkerRow,
  type ReviewData,
} from "./review-screen"

/**
 * 1.4 · Check what we read — pen ids `CEPKc` (desktop), `TbHzg` (mobile).
 *
 * A server component so `importDocument` runs against the real fixture bytes
 * on the server, exactly as the brief requires ("do not hand-write a parsed
 * result"). `ReviewScreen` only ever receives what import actually returned.
 *
 * "Jordan Vance" is the account name `scripts/deident-proof.mjs` already
 * uses to prove `letterhead-report.txt`'s unlabeled name match — reused here
 * so the same fixture demonstrates the same thing on this screen.
 */
const SENDER_ACCOUNT_NAME = "Jordan Vance"
const IMPORTED_AT = "2026-08-12T09:00:00.000Z"
const TAKEN_ON = "2026-08-12"

const FIXTURES: { file: string; format: DocumentFormat; label: string }[] = [
  { file: "thyroid-panel.csv", format: "csv", label: "Thyroid panel" },
  { file: "patient-panel.csv", format: "csv", label: "Patient panel" },
  { file: "letterhead-report.txt", format: "text", label: "Consult note" },
]

function loadFixture(file: string): Uint8Array {
  return new Uint8Array(readFileSync(path.join(process.cwd(), "fixtures", file)))
}

/** The exact line a marker came from, read the same way a person scanning the file would. */
function findSourceLine(text: string, markerName: string): string | undefined {
  const needle = markerName.trim().toLowerCase()
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.toLowerCase().startsWith(`${needle},`))
}

function buildReview(fixture: (typeof FIXTURES)[number]): ReviewData {
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
    const markers: MarkerRow[] = imported.record.markers.map((marker) => {
      const sourceLine = findSourceLine(cleaned, marker.name)
      return {
        id: marker.id,
        name: marker.name,
        value: marker.value,
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

export default function ImportReviewPage() {
  const reviews = FIXTURES.map(buildReview)

  return (
    <SenderChrome active="archive">
      <ReviewScreen reviews={reviews} />
    </SenderChrome>
  )
}
