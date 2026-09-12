const ARCHIVE_MAGIC = new Uint8Array([0x48, 0x53, 0x41, 0x52]) // HSAR
const ARCHIVE_VERSION = 1
const ARCHIVE_IV_BYTES = 12
const ARCHIVE_KEY_BYTES = 32

export type RecordProvenance = {
  /** Opaque address of the retained source. It must not contain a filename. */
  sourceId: string
  importedAt: string
}

export type ReferenceRange = {
  min?: number
  max?: number
}

export type BloodMarker = {
  /** Stable only inside the sender's archive. */
  id: string
  name: string
  value: number
  unit: string
  referenceRange: ReferenceRange
  flaggedAtImport: boolean
}

export type BloodPanelRecord = {
  id: string
  kind: "blood-panel"
  takenOn: string
  provenance: RecordProvenance
  markers: BloodMarker[]
}

export type WearableValue = {
  date: string
  value: number
}

export type WearableSeriesRecord = {
  id: string
  kind: "wearable-series"
  metric: string
  unit: string
  range: { from: string; through: string }
  target?: number
  provenance: RecordProvenance
  values: WearableValue[]
}

export type ArchiveRecord = BloodPanelRecord | WearableSeriesRecord

export type Archive = {
  v: 1
  kind: "healthsend-archive"
  records: ArchiveRecord[]
}

export type BloodPanelSelection = {
  kind: "blood-panel"
  recordId: string
  markerIds: string[]
}

export type WearableSeriesSelection = {
  kind: "wearable-series"
  recordId: string
  from: string
  through: string
}

export type ArchiveSelection = BloodPanelSelection | WearableSeriesSelection

/** Archive-only provenance is deliberately absent from recipient records. */
export type SharedBloodPanelRecord = Omit<BloodPanelRecord, "provenance">
export type SharedWearableSeriesRecord = Omit<WearableSeriesRecord, "provenance">
export type SharedRecord = SharedBloodPanelRecord | SharedWearableSeriesRecord

export type ScopedShare = {
  v: 1
  kind: "healthsend-scoped-share"
  records: SharedRecord[]
}

/** Create an encrypted archive. The caller supplies the sender's stable 32-byte key. */
export async function createArchive(
  senderKey: Uint8Array,
  records: ArchiveRecord[] = [],
): Promise<Uint8Array> {
  validateArchiveRecords(records)
  return encryptArchive({ v: 1, kind: "healthsend-archive", records }, senderKey)
}

/** Open, extend and reseal an archive without changing the existing record addresses. */
export async function addArchiveRecords(
  encryptedArchive: Uint8Array,
  senderKey: Uint8Array,
  records: ArchiveRecord[],
): Promise<Uint8Array> {
  const archive = await openArchive(encryptedArchive, senderKey)
  const combined = [...archive.records, ...records]
  validateArchiveRecords(combined)
  return encryptArchive({ ...archive, records: combined }, senderKey)
}

export async function openArchive(
  encryptedArchive: Uint8Array,
  senderKey: Uint8Array,
): Promise<Archive> {
  assertArchiveKey(senderKey)
  const prefixLength = ARCHIVE_MAGIC.length + 1
  const minimumLength = prefixLength + ARCHIVE_IV_BYTES + 16
  if (encryptedArchive.length < minimumLength) throw new Error("Archive truncated")

  const prefix = encryptedArchive.subarray(0, prefixLength)
  for (let i = 0; i < ARCHIVE_MAGIC.length; i++) {
    if (prefix[i] !== ARCHIVE_MAGIC[i]) throw new Error("Not a HealthSend archive")
  }
  if (prefix[ARCHIVE_MAGIC.length] !== ARCHIVE_VERSION) {
    throw new Error("Unsupported archive version")
  }

  const ivEnd = prefixLength + ARCHIVE_IV_BYTES
  const key = await importArchiveKey(senderKey, ["decrypt"])
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: encryptedArchive.subarray(prefixLength, ivEnd) as BufferSource,
      additionalData: prefix as BufferSource,
    },
    key,
    encryptedArchive.subarray(ivEnd) as BufferSource,
  )

  const parsed: unknown = JSON.parse(new TextDecoder().decode(plaintext))
  if (!isObject(parsed) || parsed.v !== 1 || parsed.kind !== "healthsend-archive") {
    throw new Error("Invalid archive document")
  }
  if (!Array.isArray(parsed.records)) throw new Error("Invalid archive records")
  validateArchiveRecords(parsed.records as ArchiveRecord[])
  return parsed as Archive
}

/**
 * Open the sender's archive locally and emit only the selected recipient records.
 * These plaintext bytes are the input to the existing encrypted send transport.
 */
export async function scopeArchive(
  encryptedArchive: Uint8Array,
  senderKey: Uint8Array,
  selections: ArchiveSelection[],
): Promise<Uint8Array> {
  if (selections.length === 0) throw new Error("A share needs at least one selection")
  const archive = await openArchive(encryptedArchive, senderKey)
  const records = selectRecords(archive, selections)

  // H-16's de-identification transform belongs here, after selection and before
  // recipient bytes are encoded. Archive-only provenance is already removed.
  return new TextEncoder().encode(
    JSON.stringify({ v: 1, kind: "healthsend-scoped-share", records } satisfies ScopedShare),
  )
}

export function openScopedShare(bytes: Uint8Array): ScopedShare {
  const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes))
  if (!isObject(parsed) || parsed.v !== 1 || parsed.kind !== "healthsend-scoped-share") {
    throw new Error("Invalid scoped share")
  }
  if (!Array.isArray(parsed.records) || parsed.records.length === 0) {
    throw new Error("A scoped share needs at least one record")
  }
  validateSharedRecords(parsed.records as SharedRecord[])
  return parsed as ScopedShare
}

function selectRecords(archive: Archive, selections: ArchiveSelection[]): SharedRecord[] {
  const selectedRecordIds = new Set<string>()

  return selections.map((selection) => {
    if (selectedRecordIds.has(selection.recordId)) {
      throw new Error(`Record selected more than once: ${selection.recordId}`)
    }
    selectedRecordIds.add(selection.recordId)

    const record = archive.records.find((candidate) => candidate.id === selection.recordId)
    if (!record) throw new Error(`Unknown record: ${selection.recordId}`)
    if (record.kind !== selection.kind) {
      throw new Error(`Selection kind does not match record: ${selection.recordId}`)
    }

    if (record.kind === "blood-panel" && selection.kind === "blood-panel") {
      if (selection.markerIds.length === 0) throw new Error("Select at least one marker")
      const markerIds = new Set(selection.markerIds)
      if (markerIds.size !== selection.markerIds.length) throw new Error("Marker selected twice")
      for (const markerId of markerIds) {
        if (!record.markers.some((marker) => marker.id === markerId)) {
          throw new Error(`Unknown marker in ${record.id}: ${markerId}`)
        }
      }
      return {
        id: record.id,
        kind: record.kind,
        takenOn: record.takenOn,
        markers: record.markers
          .filter((marker) => markerIds.has(marker.id))
          .map((marker) => ({
            id: marker.id,
            name: marker.name,
            value: marker.value,
            unit: marker.unit,
            referenceRange: {
              ...(marker.referenceRange.min === undefined
                ? {}
                : { min: marker.referenceRange.min }),
              ...(marker.referenceRange.max === undefined
                ? {}
                : { max: marker.referenceRange.max }),
            },
            flaggedAtImport: marker.flaggedAtImport,
          })),
      }
    }

    if (record.kind === "wearable-series" && selection.kind === "wearable-series") {
      assertIsoDate(selection.from, "selection start")
      assertIsoDate(selection.through, "selection end")
      if (selection.from > selection.through) throw new Error("Selection range is reversed")
      const values = record.values.filter(
        (point) => point.date >= selection.from && point.date <= selection.through,
      )
      if (values.length === 0) throw new Error(`Selection has no values: ${record.id}`)
      return {
        id: record.id,
        kind: record.kind,
        metric: record.metric,
        unit: record.unit,
        range: { from: selection.from, through: selection.through },
        ...(record.target === undefined ? {} : { target: record.target }),
        values: values.map((point) => ({ date: point.date, value: point.value })),
      }
    }

    throw new Error(`Unsupported selection: ${selection.recordId}`)
  })
}

async function encryptArchive(archive: Archive, senderKey: Uint8Array): Promise<Uint8Array> {
  assertArchiveKey(senderKey)
  const prefix = new Uint8Array([...ARCHIVE_MAGIC, ARCHIVE_VERSION])
  const iv = crypto.getRandomValues(new Uint8Array(ARCHIVE_IV_BYTES))
  const key = await importArchiveKey(senderKey, ["encrypt"])
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource, additionalData: prefix as BufferSource },
    key,
    new TextEncoder().encode(JSON.stringify(archive)) as BufferSource,
  )
  const out = new Uint8Array(prefix.length + iv.length + ciphertext.byteLength)
  out.set(prefix, 0)
  out.set(iv, prefix.length)
  out.set(new Uint8Array(ciphertext), prefix.length + iv.length)
  return out
}

function importArchiveKey(raw: Uint8Array, usages: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, usages)
}

function assertArchiveKey(key: Uint8Array): void {
  if (key.length !== ARCHIVE_KEY_BYTES) throw new Error("Archive key must be 32 bytes")
}

function validateArchiveRecords(records: ArchiveRecord[]): void {
  const ids = new Set<string>()
  for (const record of records) {
    validateRecord(record, true)
    if (ids.has(record.id)) throw new Error(`Duplicate record id: ${record.id}`)
    ids.add(record.id)
  }
}

function validateSharedRecords(records: SharedRecord[]): void {
  const ids = new Set<string>()
  for (const record of records) {
    validateRecord(record, false)
    if (ids.has(record.id)) throw new Error(`Duplicate shared record id: ${record.id}`)
    ids.add(record.id)
  }
}

function validateRecord(record: ArchiveRecord | SharedRecord, needsProvenance: boolean): void {
  if (!isObject(record)) throw new Error("Invalid record")
  assertText(record.id, "record id")
  if (needsProvenance) validateProvenance((record as ArchiveRecord).provenance)

  if (record.kind === "blood-panel") {
    assertOnlyKeys(
      record,
      needsProvenance
        ? ["id", "kind", "takenOn", "provenance", "markers"]
        : ["id", "kind", "takenOn", "markers"],
      "blood panel",
    )
    if (!needsProvenance && "provenance" in record) {
      throw new Error("Scoped share contains archive provenance")
    }
    assertIsoDate(record.takenOn, "panel date")
    if (!Array.isArray(record.markers) || record.markers.length === 0) {
      throw new Error(`Blood panel has no markers: ${record.id}`)
    }
    const markerIds = new Set<string>()
    for (const marker of record.markers) {
      if (!isObject(marker)) throw new Error(`Invalid marker in ${record.id}`)
      assertOnlyKeys(
        marker,
        ["id", "name", "value", "unit", "referenceRange", "flaggedAtImport"],
        "blood marker",
      )
      assertText(marker.id, "marker id")
      assertText(marker.name, "marker name")
      assertFiniteNumber(marker.value, "marker value")
      assertText(marker.unit, "marker unit")
      if (typeof marker.flaggedAtImport !== "boolean") throw new Error("Invalid marker flag")
      validateReferenceRange(marker.referenceRange)
      if (markerIds.has(marker.id)) throw new Error(`Duplicate marker id: ${marker.id}`)
      markerIds.add(marker.id)
    }
    return
  }

  if (record.kind === "wearable-series") {
    assertOnlyKeys(
      record,
      needsProvenance
        ? ["id", "kind", "metric", "unit", "range", "target", "provenance", "values"]
        : ["id", "kind", "metric", "unit", "range", "target", "values"],
      "wearable series",
    )
    if (!needsProvenance && "provenance" in record) {
      throw new Error("Scoped share contains archive provenance")
    }
    assertText(record.metric, "wearable metric")
    assertText(record.unit, "wearable unit")
    if (!isObject(record.range)) throw new Error("Invalid wearable range")
    assertOnlyKeys(record.range, ["from", "through"], "wearable range")
    assertIsoDate(record.range.from, "series start")
    assertIsoDate(record.range?.through, "series end")
    if (record.range.from > record.range.through) throw new Error("Series range is reversed")
    if (record.target !== undefined) assertFiniteNumber(record.target, "series target")
    if (!Array.isArray(record.values) || record.values.length === 0) {
      throw new Error(`Wearable series has no values: ${record.id}`)
    }
    let previous = ""
    for (const point of record.values) {
      if (!isObject(point)) throw new Error(`Invalid wearable value in ${record.id}`)
      assertOnlyKeys(point, ["date", "value"], "wearable value")
      assertIsoDate(point.date, "wearable date")
      assertFiniteNumber(point.value, "wearable value")
      if (point.date <= previous) throw new Error(`Wearable dates are not unique and ordered: ${record.id}`)
      if (point.date < record.range.from || point.date > record.range.through) {
        throw new Error(`Wearable date is outside its range: ${point.date}`)
      }
      previous = point.date
    }
    return
  }

  throw new Error("Unknown record kind")
}

function validateProvenance(provenance: RecordProvenance): void {
  if (!isObject(provenance)) throw new Error("Invalid record provenance")
  assertOnlyKeys(provenance, ["sourceId", "importedAt"], "record provenance")
  assertText(provenance.sourceId, "source id")
  assertText(provenance.importedAt, "import time")
  if (Number.isNaN(Date.parse(provenance.importedAt))) throw new Error("Invalid import time")
}

function validateReferenceRange(range: ReferenceRange): void {
  if (!isObject(range)) throw new Error("Invalid reference range")
  assertOnlyKeys(range, ["min", "max"], "reference range")
  if (range.min === undefined && range.max === undefined) {
    throw new Error("Reference range needs a minimum or maximum")
  }
  if (range.min !== undefined) assertFiniteNumber(range.min, "reference minimum")
  if (range.max !== undefined) assertFiniteNumber(range.max, "reference maximum")
  if (range.min !== undefined && range.max !== undefined && range.min > range.max) {
    throw new Error("Reference range is reversed")
  }
}

function assertIsoDate(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid ${label}`)
  }
  const date = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`Invalid ${label}`)
  }
}

function assertText(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Invalid ${label}`)
}

function assertFiniteNumber(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Invalid ${label}`)
}

function assertOnlyKeys(value: object, allowed: string[], label: string): void {
  const allowedKeys = new Set(allowed)
  const extra = Object.keys(value).find((key) => !allowedKeys.has(key))
  if (extra) throw new Error(`Unknown ${label} field: ${extra}`)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
