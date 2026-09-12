import {
  looksLikePdf,
  type ArchiveRecord,
  type BloodMarker,
  type BloodPanelRecord,
  type DocumentRecord,
  type RecordProvenance,
  type ReferenceRange,
  type WearableSeriesRecord,
  type WearableValue,
} from "./archive"
import { toBase64Url } from "./crypto.ts"

export type UploadArchiveKind = ArchiveRecord["kind"]

export async function recordsFromUpload(params: {
  file: File
  kind: UploadArchiveKind
  takenOn?: string
}): Promise<ArchiveRecord[]> {
  if (params.kind === "document") {
    throw new Error("Use recordsFromPdfFiles for documents")
  }

  const text = await params.file.text()
  const provenance: RecordProvenance = {
    sourceId: `source:${crypto.randomUUID()}`,
    importedAt: new Date().toISOString(),
  }

  if (params.kind === "blood-panel") {
    if (!params.takenOn) throw new Error("Enter the date of the test")
    return [parseBloodPanel(text, params.takenOn, provenance)]
  }
  return parseWearableExport(text, provenance)
}

/**
 * One or more PDFs picked in a single step. All-or-nothing: if any file is
 * not a PDF, the whole pick is rejected and named, rather than silently
 * archiving the rest — see docs/stories/H-63.md.
 */
export async function recordsFromPdfFiles(files: File[]): Promise<DocumentRecord[]> {
  if (files.length === 0) throw new Error("Pick at least one PDF")

  const read = await Promise.all(
    files.map(async (file) => ({ file, bytes: new Uint8Array(await file.arrayBuffer()) })),
  )
  const notPdf = read.filter(({ bytes }) => !looksLikePdf(bytes)).map(({ file }) => file.name)
  if (notPdf.length > 0) {
    throw new Error(`Not a PDF: ${notPdf.join(", ")}`)
  }

  const importedAt = new Date().toISOString()
  return read.map(({ file, bytes }) => ({
    id: `record:${crypto.randomUUID()}`,
    kind: "document",
    name: file.name,
    size: bytes.length,
    provenance: { sourceId: `source:${crypto.randomUUID()}`, importedAt },
    bytes: toBase64Url(bytes),
  }))
}

const BLOOD_HEADER = "marker,value,unit,ref_low,ref_high,flag"

function parseBloodPanel(
  text: string,
  takenOn: string,
  provenance: RecordProvenance,
): BloodPanelRecord {
  const lines = text.split(/\r?\n/)
  const headerIndex = lines.findIndex(
    (line) => line.trim().toLowerCase().replace(/\s+/g, "") === BLOOD_HEADER,
  )
  if (headerIndex === -1) {
    throw new Error(`This CSV needs the header: ${BLOOD_HEADER}`)
  }

  const markers: BloodMarker[] = []
  for (const line of lines.slice(headerIndex + 1)) {
    if (!line.trim()) continue
    const cells = line.split(",").map((cell) => cell.trim())
    if (cells.length < 5) throw new Error("A marker row has fewer than five columns")
    const [name, valueText, unit, minimumText, maximumText, labFlag] = cells
    const value = Number(valueText)
    if (!name || !Number.isFinite(value)) throw new Error("A marker needs a name and a number")

    const referenceRange: ReferenceRange = {}
    if (minimumText) referenceRange.min = parseNumber(minimumText, `${name} minimum`)
    if (maximumText) referenceRange.max = parseNumber(maximumText, `${name} maximum`)
    const reasons: string[] = []
    if (!unit) reasons.push("No unit in the file")
    if (referenceRange.min === undefined && referenceRange.max === undefined) {
      reasons.push("No reference range in the file")
    }

    markers.push({
      id: `marker:${crypto.randomUUID()}`,
      name,
      value,
      unit,
      referenceRange,
      ...(labFlag ? { labFlag } : {}),
      flaggedAtImport: reasons.length > 0,
      ...(reasons.length > 0 ? { flagReason: reasons.join(" · ") } : {}),
    })
  }

  if (markers.length === 0) throw new Error("This CSV has no readable marker rows")
  return {
    id: `record:${crypto.randomUUID()}`,
    kind: "blood-panel",
    takenOn,
    provenance,
    markers,
  }
}

type WearableJson = {
  metric?: unknown
  unit?: unknown
  target?: unknown
  values?: unknown
  series?: unknown
}

function parseWearableExport(text: string, provenance: RecordProvenance): WearableSeriesRecord[] {
  let parsed: WearableJson
  try {
    parsed = JSON.parse(text) as WearableJson
  } catch {
    throw new Error("This wearable export is not valid JSON")
  }

  const candidates = Array.isArray(parsed.series) ? parsed.series : [parsed]
  if (candidates.length === 0) throw new Error("This wearable export has no series")
  return candidates.map((candidate, index) => parseWearableSeries(candidate, provenance, index))
}

function parseWearableSeries(
  candidate: unknown,
  provenance: RecordProvenance,
  index: number,
): WearableSeriesRecord {
  if (!isObject(candidate)) throw new Error(`Wearable series ${index + 1} is not an object`)
  if (typeof candidate.metric !== "string" || !candidate.metric.trim()) {
    throw new Error(`Wearable series ${index + 1} needs a metric`)
  }
  if (typeof candidate.unit !== "string" || !candidate.unit.trim()) {
    throw new Error(`Wearable series ${index + 1} needs a unit`)
  }
  if (!Array.isArray(candidate.values) || candidate.values.length === 0) {
    throw new Error(`Wearable series ${index + 1} has no values`)
  }

  const values: WearableValue[] = candidate.values.map((point, pointIndex) => {
    if (!isObject(point) || typeof point.date !== "string") {
      throw new Error(`Wearable value ${pointIndex + 1} needs a date`)
    }
    return {
      date: point.date,
      value: parseNumber(point.value, `wearable value ${pointIndex + 1}`),
    }
  })
  values.sort((a, b) => a.date.localeCompare(b.date))

  const target =
    candidate.target === undefined ? undefined : parseNumber(candidate.target, `target for ${candidate.metric}`)
  return {
    id: `record:${crypto.randomUUID()}`,
    kind: "wearable-series",
    metric: candidate.metric,
    unit: candidate.unit,
    range: { from: values[0].date, through: values.at(-1)!.date },
    ...(target === undefined ? {} : { target }),
    provenance: { ...provenance },
    values,
  }
}

function parseNumber(value: unknown, label: string): number {
  const number = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(number)) throw new Error(`Invalid ${label}`)
  return number
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
