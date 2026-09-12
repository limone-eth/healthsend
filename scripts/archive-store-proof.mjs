/**
 * H-63's required evidence: "a proof that a two-PDF add performs exactly one
 * archive upload." `addRecordsToMyArchive` (lib/archive-store.ts) already
 * takes an array of records and does one read-modify-write over the whole
 * archive, but that only holds if the Add screen calls it once with every
 * record from the pick rather than once per file — this proof exercises the
 * real function with two document records and counts the network calls it
 * makes, the same way `scripts/confirm-end-proof.mjs` counts outcomes rather
 * than trusting the shape of the code that produces them.
 *
 * No browser, no Swarm ID, no network: `getIdentity`, the feed reader/writer
 * and the blob uploader are all injected through `addRecordsToMyArchive`'s
 * own `dependencyOverrides` parameter, the same seam the module documents
 * itself as designed around.
 */
import assert from "node:assert/strict"
import { registerHooks } from "node:module"

// Next resolves extensionless imports under bundler resolution; Node's
// strip-types runner does not. Same hook as scripts/confirm-end-proof.mjs.
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (error) {
      const extensionless = specifier.startsWith(".")
      if (!extensionless || /\.[cm]?[jt]sx?$/.test(specifier)) throw error
      return nextResolve(`${specifier}.ts`, context)
    }
  },
})

const { addRecordsToMyArchive } = await import("../lib/archive-store.ts")
const { openArchive } = await import("../lib/archive.ts")

const senderKey = crypto.getRandomValues(new Uint8Array(32))
const identity = { archiveKey: senderKey, archiveTopic: new Uint8Array(32).fill(7) }

function pdfBytes(label) {
  return new TextEncoder().encode(`%PDF-1.4\n% ${label}\n%%EOF\n`)
}

function documentRecord(id, name) {
  const bytes = pdfBytes(name)
  return {
    id,
    kind: "document",
    name,
    size: bytes.length,
    provenance: { sourceId: `source:${id}`, importedAt: "2026-09-12T09:00:00.000Z" },
    bytes: Buffer.from(bytes).toString("base64url"),
  }
}

// --- picking two PDFs in one step uploads exactly one archive blob ---------
{
  let uploadCount = 0
  let feedWriteCount = 0
  let storedBlob = null
  let storedReference = null

  const deps = {
    getIdentity: async () => identity,
    readArchiveReference: async () => null,
    writeArchiveReference: async (_topic, reference) => {
      feedWriteCount += 1
      storedReference = reference
    },
    fetchBlobFromGateway: async (reference) => {
      assert.equal(reference, storedReference, "must fetch the reference it just wrote")
      return storedBlob
    },
    uploadEncryptedBlob: async (bytes) => {
      uploadCount += 1
      storedBlob = bytes
      return { reference: `blob-${uploadCount}` }
    },
  }

  const twoDocuments = [
    documentRecord("record:document:a", "Blood test, March.pdf"),
    documentRecord("record:document:b", "Thyroid panel, June.pdf"),
  ]
  const result = await addRecordsToMyArchive(twoDocuments, deps)

  assert.equal(uploadCount, 1, "a two-PDF add must perform exactly one archive upload")
  assert.equal(feedWriteCount, 1, "a two-PDF add must move the feed reference exactly once")
  assert.equal(result.records.length, 2, "both documents must be in the resulting archive")

  const reopened = await openArchive(storedBlob, senderKey)
  assert.deepEqual(
    reopened.records.map((record) => record.name).sort(),
    ["Blood test, March.pdf", "Thyroid panel, June.pdf"],
  )
  console.log("PASS  adding two PDFs in one pick performs exactly one archive upload and one feed write")
}

// --- adding to an existing archive still uploads once per call, not once
//     per record, and the earlier record survives alongside the new ones ---
{
  let uploadCount = 0
  let currentBlob = await (async () => {
    const { createArchive } = await import("../lib/archive.ts")
    return createArchive(senderKey, [documentRecord("record:document:existing", "Existing.pdf")])
  })()

  const deps = {
    getIdentity: async () => identity,
    readArchiveReference: async () => "existing-ref",
    writeArchiveReference: async () => {},
    fetchBlobFromGateway: async () => currentBlob,
    uploadEncryptedBlob: async (bytes) => {
      uploadCount += 1
      currentBlob = bytes
      return { reference: `blob-${uploadCount}` }
    },
  }

  const added = [
    documentRecord("record:document:c", "New one.pdf"),
    documentRecord("record:document:d", "New two.pdf"),
  ]
  const result = await addRecordsToMyArchive(added, deps)

  assert.equal(uploadCount, 1, "extending an archive with two more PDFs must still be one upload")
  assert.equal(result.records.length, 3, "the pre-existing document must survive the extension")
  console.log("PASS  extending an archive with two more PDFs stays one upload and keeps what was there")
}

console.log("\nArchive store upload proof passed.")
