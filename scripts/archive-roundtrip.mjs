import assert from "node:assert/strict"

const { addArchiveRecords, createArchive, openArchive, openScopedShare, scopeArchive } =
  await import("../lib/archive.ts")
const { DEMO_BLOOD_PANEL, DEMO_DOCUMENT, DEMO_DOCUMENT_BYTES, DEMO_SHARED_MARKER_IDS, DEMO_SLEEP_SERIES } =
  await import("../lib/archive-demo.ts")
const { fromBase64Url, toBase64Url } = await import("../lib/crypto.ts")

const senderKey = crypto.getRandomValues(new Uint8Array(32))

// The panel arrives first. The wearable export is added later under the same
// sender key, which proves the archive is a growing store rather than a send.
let encryptedArchive = await createArchive(senderKey, [DEMO_BLOOD_PANEL])
assert.equal((await openArchive(encryptedArchive, senderKey)).records.length, 1)
encryptedArchive = await addArchiveRecords(encryptedArchive, senderKey, [DEMO_SLEEP_SERIES])
const archive = await openArchive(encryptedArchive, senderKey)
assert.equal(archive.records.length, 2, "both imports must remain in the archive")
assert.ok(
  !Buffer.from(encryptedArchive).includes(Buffer.from("Ferritin")),
  "archive plaintext leaked at rest",
)
await assert.rejects(
  openArchive(encryptedArchive, crypto.getRandomValues(new Uint8Array(32))),
  "a different sender key must not open the archive",
)
console.log("PASS  archive grows over time and stays encrypted under the sender key")

// The fixture is the one set of figures used across the design.
assert.equal(DEMO_BLOOD_PANEL.takenOn, "2026-08-12")
assert.equal(DEMO_BLOOD_PANEL.markers.length, 32)
assert.equal(DEMO_SHARED_MARKER_IDS.length, 5)
assert.equal(DEMO_BLOOD_PANEL.markers.filter((marker) => marker.flaggedAtImport).length, 0)

assert.deepEqual(DEMO_SLEEP_SERIES.range, { from: "2026-08-07", through: "2026-09-03" })
assert.equal(DEMO_SLEEP_SERIES.values.length, 28)
assert.equal(DEMO_SLEEP_SERIES.target, 450)
const sleepTotal = DEMO_SLEEP_SERIES.values.reduce((total, night) => total + night.value, 0)
assert.equal(sleepTotal / DEMO_SLEEP_SERIES.values.length, 372, "mean must be 6h 12m")
assert.equal(
  DEMO_SLEEP_SERIES.values.filter((night) => night.value >= DEMO_SLEEP_SERIES.target).length,
  4,
  "four nights must reach the 7h 30m target",
)
console.log("PASS  demo fixture has 32 markers, no import flags, and the specified 28-night series")

// Only the five addressed markers become recipient bytes. The existing send
// path can encrypt these bytes as its payload; it never needs the archive key.
const sharedBytes = await scopeArchive(encryptedArchive, senderKey, [
  {
    kind: "blood-panel",
    recordId: DEMO_BLOOD_PANEL.id,
    markerIds: DEMO_SHARED_MARKER_IDS,
  },
])
const share = openScopedShare(sharedBytes)
assert.equal(share.records.length, 1)
const sharedPanel = share.records[0]
assert.equal(sharedPanel.kind, "blood-panel")
assert.equal(sharedPanel.markers.length, 5)
assert.deepEqual(
  sharedPanel.markers.map((marker) => marker.id),
  DEMO_SHARED_MARKER_IDS,
  "the recipient must get exactly the selected markers",
)
assert.ok(!("provenance" in sharedPanel), "archive provenance must not enter recipient bytes")

// R3-019: the lab's own abnormal-result call must survive `scopeArchive` —
// a clinician reading the recipient's scoped record needs it exactly as
// much as one reading the sender's own archive does (H-38).
const sharedVitaminD = sharedPanel.markers.find((marker) => marker.id === "marker:vitamin-d")
assert.ok(sharedVitaminD, "vitamin D must be among the shared markers")
assert.equal(
  sharedVitaminD.labFlag,
  "LOW",
  "a lab flag on a shared marker must survive scoping into the recipient's record",
)
const sharedFerritin = sharedPanel.markers.find((marker) => marker.id === "marker:ferritin")
assert.equal(
  sharedFerritin.labFlag,
  undefined,
  "a marker the lab did not flag must carry no lab flag through scoping",
)
console.log("PASS  a lab flag on a shared marker survives scopeArchive into the recipient record")

const unselected = DEMO_BLOOD_PANEL.markers.filter(
  (marker) => !DEMO_SHARED_MARKER_IDS.includes(marker.id),
)
assert.equal(unselected.length, 27)
for (const marker of unselected) {
  assert.ok(
    !Buffer.from(sharedBytes).includes(Buffer.from(marker.id)),
    `unselected marker id is recoverable: ${marker.id}`,
  )
  assert.ok(
    !Buffer.from(sharedBytes).includes(Buffer.from(marker.name)),
    `unselected marker name is recoverable: ${marker.name}`,
  )
}
console.log("PASS  recipient opens 5 markers and cannot recover the other 27 from shared bytes")

// Extra archive fields cannot ride through selection, and the recipient decoder
// rejects archive-only provenance even if a caller constructs its own payload.
const contaminatedPanel = structuredClone(DEMO_BLOOD_PANEL)
contaminatedPanel.markers[0].privateNote = "must stay private"
await assert.rejects(
  createArchive(senderKey, [contaminatedPanel]),
  /Unknown blood marker field: privateNote/,
)
const injectedShare = structuredClone(share)
injectedShare.records[0].provenance = DEMO_BLOOD_PANEL.provenance
assert.throws(
  () => openScopedShare(new TextEncoder().encode(JSON.stringify(injectedShare))),
  /Unknown blood panel field: provenance/,
)
console.log("PASS  undeclared fields and archive provenance cannot enter a scoped share")

// A wearable range can contain a missing night. The range remains the selected
// period, while only recorded nights appear as values.
const sparseSeries = {
  ...DEMO_SLEEP_SERIES,
  id: "record:wearable:sparse-proof",
  range: { from: "2026-08-07", through: "2026-08-09" },
  values: [{ date: "2026-08-08", value: 324 }],
}
const sparseArchive = await createArchive(senderKey, [sparseSeries])
const sparseBytes = await scopeArchive(sparseArchive, senderKey, [
  {
    kind: "wearable-series",
    recordId: sparseSeries.id,
    from: sparseSeries.range.from,
    through: sparseSeries.range.through,
  },
])
const sparseShare = openScopedShare(sparseBytes)
assert.deepEqual(sparseShare.records[0].range, sparseSeries.range)
assert.deepEqual(sparseShare.records[0].values, sparseSeries.values)
console.log("PASS  wearable ranges preserve missing nights without invalid recipient bytes")

// H-63: a document record (a PDF, stored whole) round-trips through
// createArchive / addArchiveRecords / openArchive alongside the other kinds,
// and picking two PDFs in one step still lands as one archive update.
const SECOND_DOCUMENT_BYTES = new TextEncoder().encode("%PDF-1.4\n% second fixture\n%%EOF\n")
const SECOND_DOCUMENT = {
  id: "record:document:2026-09-01",
  kind: "document",
  name: "Blood test, March.pdf",
  size: SECOND_DOCUMENT_BYTES.length,
  provenance: { sourceId: "source:document:2026-09-01", importedAt: "2026-09-01T09:00:00.000Z" },
  bytes: toBase64Url(SECOND_DOCUMENT_BYTES),
}

let documentArchive = await createArchive(senderKey, [DEMO_BLOOD_PANEL])
documentArchive = await addArchiveRecords(documentArchive, senderKey, [DEMO_DOCUMENT, SECOND_DOCUMENT])
const opened = await openArchive(documentArchive, senderKey)
const documents = opened.records.filter((record) => record.kind === "document")
assert.equal(documents.length, 2, "both PDFs picked in one step must both land in the archive")
assert.deepEqual(
  documents.map((record) => record.name).sort(),
  ["Blood test, March.pdf", "Thyroid panel, June.pdf"],
)
const reopenedDocument = documents.find((record) => record.id === DEMO_DOCUMENT.id)
console.log("PASS  two PDFs picked at once both round-trip through addArchiveRecords in one call")

// The stored bytes decode back to exactly the original PDF — not just a
// same-length stand-in.
assert.deepEqual(fromBase64Url(reopenedDocument.bytes), DEMO_DOCUMENT_BYTES)
console.log("PASS  a stored document's bytes decode back to the exact original PDF")

// Malformed documents are rejected by validation, each for the specific
// reason named in docs/stories/H-63.md.
await assert.rejects(
  createArchive(senderKey, [{ ...DEMO_DOCUMENT, size: DEMO_DOCUMENT.size + 1 }]),
  /Document size does not match its bytes/,
  "a document whose declared size disagrees with its bytes must be rejected",
)
const notPdfBytes = new TextEncoder().encode("not a pdf at all")
await assert.rejects(
  createArchive(senderKey, [{ ...DEMO_DOCUMENT, bytes: toBase64Url(notPdfBytes), size: notPdfBytes.length }]),
  /Document is not a PDF/,
  "bytes that do not start with %PDF- must be rejected even with a matching size",
)
await assert.rejects(
  createArchive(senderKey, [{ ...DEMO_DOCUMENT, name: undefined }]),
  /Invalid document name/,
  "a document with no display name must be rejected",
)
console.log("PASS  a malformed document (bad size, non-PDF bytes, missing name) is rejected by validation")

// A document never carries its provenance — or itself — into a share. H-64
// gives documents a real share path; until then the archive refuses both a
// scoped-share document (even provenance-free) and a document selection.
const provenanceFreeDocument = Object.fromEntries(
  Object.entries(DEMO_DOCUMENT).filter(([key]) => key !== "provenance"),
)
assert.throws(
  () =>
    openScopedShare(
      new TextEncoder().encode(
        JSON.stringify({
          v: 1,
          kind: "healthsend-scoped-share",
          records: [provenanceFreeDocument],
        }),
      ),
    ),
  /Documents cannot enter a scoped share yet/,
  "a document must not enter a scoped share even without its provenance",
)
await assert.rejects(
  scopeArchive(documentArchive, senderKey, [{ kind: "document", recordId: DEMO_DOCUMENT.id }]),
  /Unsupported selection/,
  "scopeArchive must not have an address form that can select a document",
)
console.log("PASS  a document cannot enter a scoped share, with or without its provenance")

console.log("\nArchive round trip passed.")
