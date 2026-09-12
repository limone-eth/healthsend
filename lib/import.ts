/**
 * Import: the seam between a raw document and the archive.
 *
 * `lib/archive.ts` cannot carry a name or a date of birth — `BloodPanelRecord`
 * and `WearableSeriesRecord` simply have no field for either. That only
 * matters if nothing upstream of it ever tries to put one there. This module
 * is that upstream: it reads a raw import (a lab CSV, a lab PDF, a note),
 * finds any name, date of birth, address or patient identifier in it, and
 * sets those aside into `provenance.setAside` — never into the record body —
 * before the record is added to an archive or before a document is offered
 * for a send.
 *
 * A document that is not a recognized marker table (a consult note, a
 * training log) has no archive record shape to become. It is still run
 * through the same de-identification pass; what comes back is the cleaned
 * text a send would carry, plus whatever was set aside.
 */
import type { DocumentFormat } from "./deident.ts"
import { deidentifyText, extractDocumentText } from "./deident.ts"
import type {
  BloodMarker,
  BloodPanelRecord,
  RecordProvenance,
  ReferenceRange,
  SetAsideIdentifiers,
} from "./archive.ts"

export type ImportParams = {
  bytes: Uint8Array
  format: DocumentFormat
  recordId: string
  sourceId: string
  importedAt: string
  /** Blood panels don't carry their own draw date in these fixture formats. */
  takenOn: string
  /** The importing sender's own account name, if known — passed through to `deidentifyText`. */
  accountName?: string
}

export type ImportedBloodPanel = { kind: "blood-panel"; record: BloodPanelRecord }
export type ImportedDocument = { kind: "document"; cleanedText: string; setAside: SetAsideIdentifiers }
export type ImportResult = ImportedBloodPanel | ImportedDocument

const BLOOD_PANEL_HEADER = "marker,value,unit,ref_low,ref_high,flag"

/** Import one document: strip identifiers first, then read whatever shape is left. */
export function importDocument(params: ImportParams): ImportResult {
  const rawText = extractDocumentText(params.bytes, params.format)
  const { cleaned, setAside } = deidentifyText(rawText, { accountName: params.accountName })

  const markers = parseBloodPanelMarkers(cleaned)
  if (markers) {
    const provenance: RecordProvenance = {
      sourceId: params.sourceId,
      importedAt: params.importedAt,
      ...(hasSetAside(setAside) ? { setAside } : {}),
    }
    return {
      kind: "blood-panel",
      record: {
        id: params.recordId,
        kind: "blood-panel",
        takenOn: params.takenOn,
        provenance,
        markers,
      },
    }
  }

  return { kind: "document", cleanedText: cleaned, setAside }
}

function hasSetAside(setAside: SetAsideIdentifiers): boolean {
  return Object.values(setAside).some((value) => value !== undefined)
}

/**
 * The marker-table CSV shape this product's fixtures use — the same table
 * whether it arrived as a `.csv` or was read back out of a `.pdf` text run.
 * Anything before the header line (a metadata banner, a redacted identifier
 * line) is ignored rather than parsed as a row.
 */
function parseBloodPanelMarkers(text: string): BloodMarker[] | null {
  const lines = text.split(/\r?\n/)
  const headerIndex = lines.findIndex(
    (line) => line.trim().toLowerCase().replace(/\s+/g, "") === BLOOD_PANEL_HEADER.replace(/\s+/g, ""),
  )
  if (headerIndex === -1) return null

  const markers: BloodMarker[] = []
  for (const line of lines.slice(headerIndex + 1)) {
    if (!line.trim()) continue
    const cells = line.split(",").map((cell) => cell.trim())
    if (cells.length < 5) continue
    const [name, valueText, unit, refLowText, refHighText, flag] = cells
    const value = Number(valueText)
    if (!name || !Number.isFinite(value)) continue

    const referenceRange: ReferenceRange = {}
    if (refLowText) referenceRange.min = Number(refLowText)
    if (refHighText) referenceRange.max = Number(refHighText)
    if (referenceRange.min === undefined && referenceRange.max === undefined) continue

    markers.push({
      id: `marker:${slugify(name)}`,
      name,
      value,
      unit,
      referenceRange,
      flaggedAtImport: Boolean(flag && flag.trim().length > 0),
    })
  }
  return markers.length > 0 ? markers : null
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
}
