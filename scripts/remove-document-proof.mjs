/**
 * H-18's required evidence, at the logic layer (no browser): removing an
 * archived PDF reseals the archive without it, a share created from the
 * archive is recorded and survives a reload, ending shares on removal ends
 * exactly the live shares that hold the document and no other, the "opened"
 * note only ever names a reliable open, and the sheet's own "is there
 * anything to show" decision stays false only when there is truly nothing
 * live to show.
 *
 * No network, no Swarm ID: `lib/archive-store.ts`'s dependency seam
 * (`getIdentity`/`readArchiveReference`/`writeArchiveReference`/
 * `fetchBlobFromGateway`/`uploadEncryptedBlob`) is injected exactly the way
 * `scripts/archive-store-proof.mjs` already does for `addRecordsToMyArchive`,
 * and `performRemoveDocument`'s own `endSend`/`markEndedByYou` seam is
 * injected the way `scripts/confirm-end-proof.mjs` injects `endSend`.
 */
import assert from "node:assert/strict"
import { registerHooks } from "node:module"

// Next resolves extensionless TypeScript imports and the project's "@/*" ->
// "./*" path alias (tsconfig.json). Node's strip-types runner does neither,
// so this proof gives it the two resolution rules the application uses —
// same hook as scripts/confirm-end-proof.mjs.
registerHooks({
  resolve(specifier, context, nextResolve) {
    const resolved = specifier.startsWith("@/")
      ? new URL(`../${specifier.slice(2)}`, import.meta.url).href
      : specifier
    try {
      return nextResolve(resolved, context)
    } catch (error) {
      const extensionless = resolved.startsWith(".") || resolved.startsWith("file:")
      if (!extensionless || /\.[cm]?[jt]sx?$/.test(resolved)) throw error
      return nextResolve(`${resolved}.ts`, context)
    }
  },
})

const { createArchive, openArchive, sharesIncludingDocument } = await import("../lib/archive.ts")
const { addShareIndexEntryToMyArchive, removeDocumentFromMyArchive } = await import(
  "../lib/archive-store.ts"
)
const {
  openedNoteText,
  shouldShowSharesCard,
  performRemoveDocument,
} = await import("../components/remove-document-sheet-logic.ts")

const senderKey = crypto.getRandomValues(new Uint8Array(32))
const identity = { archiveKey: senderKey, archiveTopic: new Uint8Array(32).fill(9) }

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

const DOC_A = documentRecord("record:document:a", "Blood test, March.pdf")
const DOC_B = documentRecord("record:document:b", "Thyroid panel, June.pdf")

function makeStore(initialBlob) {
  let currentBlob = initialBlob
  let feedWriteCount = 0
  const deps = {
    getIdentity: async () => identity,
    readArchiveReference: async () => (currentBlob ? "ref" : null),
    writeArchiveReference: async (_topic, reference) => {
      feedWriteCount += 1
      assert.equal(reference, "blob-1", "must write the reference it just uploaded")
    },
    fetchBlobFromGateway: async () => currentBlob,
    uploadEncryptedBlob: async (bytes) => {
      currentBlob = bytes
      return { reference: "blob-1" }
    },
  }
  return { deps, get currentBlob() { return currentBlob }, get feedWriteCount() { return feedWriteCount } }
}

// --- the share index is written on a share from the archive and survives a
//     reload -----------------------------------------------------------------
{
  const initialBlob = await createArchive(senderKey, [DOC_A, DOC_B])
  const store = makeStore(initialBlob)

  const entry = { entityKey: "0xshare-a", documentIds: [DOC_A.id], createdAt: 1_000, expiresAt: 2_000 }
  await addShareIndexEntryToMyArchive(entry, store.deps)

  // "Survives a reload": open a *fresh* read of the stored ciphertext rather
  // than trusting the in-memory return value of the write itself.
  const reloaded = await openArchive(store.currentBlob, senderKey)
  assert.deepEqual(reloaded.shareIndex, [entry], "the share index entry must survive a reload")
  console.log("PASS  a share index entry written on a share from the archive survives a reload")
}

// --- an archive sealed before this story (no shareIndex field at all) still
//     opens, and gains an index on its first share ---------------------------
{
  const beforeThisStory = await createArchive(senderKey, [DOC_A])
  const opened = await openArchive(beforeThisStory, senderKey)
  assert.equal(opened.shareIndex, undefined, "an archive without an index must still open")
  console.log("PASS  an archive sealed before this story opens with no share index, not an error")
}

// --- removal reseals the archive without the document -----------------------
{
  const initialBlob = await createArchive(senderKey, [DOC_A, DOC_B])
  const store = makeStore(initialBlob)

  const result = await removeDocumentFromMyArchive(DOC_A.id, store.deps)
  assert.deepEqual(result.records.map((r) => r.id).sort(), [DOC_B.id], "the removed document must be gone")

  const reloaded = await openArchive(store.currentBlob, senderKey)
  assert.equal(reloaded.records.length, 1, "the resealed archive must not contain the removed document")
  assert.equal(reloaded.records[0].id, DOC_B.id)
  console.log("PASS  removing a document reseals the archive without it")
}

// --- removal leaves the share index untouched — it is history, not current
//     holdings ----------------------------------------------------------------
{
  const blob = await createArchive(senderKey, [DOC_A, DOC_B])
  const entry = { entityKey: "0xshare-b", documentIds: [DOC_A.id], createdAt: 1_000, expiresAt: 2_000 }
  const store = makeStore(blob)
  await addShareIndexEntryToMyArchive(entry, store.deps)
  await removeDocumentFromMyArchive(DOC_A.id, store.deps)

  const reloaded = await openArchive(store.currentBlob, senderKey)
  assert.deepEqual(reloaded.shareIndex, [entry], "removing a document must not erase its share history")
  console.log("PASS  removing a document leaves the share index that named it untouched")
}

// --- sharesIncludingDocument (lib/archive.ts): live and holding the target
//     document, nothing else ------------------------------------------------
{
  const shareIndex = [
    { entityKey: "0xlive-holds-doc", documentIds: [DOC_A.id, DOC_B.id], createdAt: 1, expiresAt: 2 },
    { entityKey: "0xlive-other-doc", documentIds: [DOC_B.id], createdAt: 1, expiresAt: 2 },
    { entityKey: "0xended-holds-doc", documentIds: [DOC_A.id], createdAt: 1, expiresAt: 2 },
  ]
  const liveEntityKeys = new Set(["0xlive-holds-doc", "0xlive-other-doc"])
  const matches = sharesIncludingDocument(shareIndex, liveEntityKeys, DOC_A.id)
  assert.deepEqual(
    matches.map((m) => m.entityKey),
    ["0xlive-holds-doc"],
    "only a live share that actually holds the document must match",
  )
  console.log("PASS  sharesIncludingDocument excludes a live share of a different document and a non-live share of this one")
}

// --- ticked removal ends every live share that includes the document and no
//     other share --------------------------------------------------------------
{
  const initialBlob = await createArchive(senderKey, [DOC_A, DOC_B])
  const store = makeStore(initialBlob)
  const ended = []
  const marked = []
  const dependencies = {
    removeDocumentFromMyArchive: (documentId) => removeDocumentFromMyArchive(documentId, store.deps),
    endSend: async (entityKey) => {
      ended.push(entityKey)
      return { status: "ended" }
    },
    markEndedByYou: (address, entityKey) => {
      marked.push([address, entityKey])
      return []
    },
  }

  const sharesToEnd = [
    { entityKey: "0xshare-holding-doc-a", documentIds: [DOC_A.id], createdAt: 1, expiresAt: 2, openedAt: null },
    { entityKey: "0xshare-holding-doc-a-2", documentIds: [DOC_A.id, DOC_B.id], createdAt: 1, expiresAt: 2, openedAt: null },
  ]
  const outcome = await performRemoveDocument(DOC_A.id, sharesToEnd, "0xsender", dependencies)

  assert.equal(outcome.outcome, "removed")
  assert.deepEqual(
    ended.sort(),
    ["0xshare-holding-doc-a", "0xshare-holding-doc-a-2"].sort(),
    "every live share passed in must be ended",
  )
  assert.equal(marked.length, 2, "every ended share must be recorded as ended by the sender")
  assert.ok(
    !ended.includes("0xshare-not-passed-in"),
    "a share the caller did not decide to end must never be touched",
  )
  console.log("PASS  ticked removal ends every live share that includes the document and no other share")
}

// --- one failed endSend does not stop the others, and is reported ----------
{
  const initialBlob = await createArchive(senderKey, [DOC_A])
  const store = makeStore(initialBlob)
  const ended = []
  const dependencies = {
    removeDocumentFromMyArchive: (documentId) => removeDocumentFromMyArchive(documentId, store.deps),
    endSend: async (entityKey) => {
      if (entityKey === "0xfails") return { status: "error", message: "HTTP 503" }
      ended.push(entityKey)
      return { status: "ended" }
    },
    markEndedByYou: () => [],
  }
  const sharesToEnd = [
    { entityKey: "0xfails", documentIds: [DOC_A.id], createdAt: 1, expiresAt: 2, openedAt: null },
    { entityKey: "0xsucceeds", documentIds: [DOC_A.id], createdAt: 1, expiresAt: 2, openedAt: null },
  ]
  const outcome = await performRemoveDocument(DOC_A.id, sharesToEnd, "0xsender", dependencies)
  assert.equal(outcome.outcome, "removed-partial")
  assert.deepEqual(outcome.endedShares, ["0xsucceeds"])
  assert.deepEqual(outcome.failedShares, [{ entityKey: "0xfails", message: "HTTP 503" }])
  console.log("PASS  one share failing to end does not stop the others ending, and is reported by entity key")
}

// --- the "opened" note is absent without a reliable open --------------------
{
  const noOpens = [
    { entityKey: "0xa", documentIds: ["x"], createdAt: 1, expiresAt: 2, openedAt: null },
    { entityKey: "0xb", documentIds: ["x"], createdAt: 1, expiresAt: 2, openedAt: null },
  ]
  assert.equal(openedNoteText(noOpens), null, "no note without a single reliable open among the listed shares")
  assert.equal(openedNoteText([]), null, "no note when there are no shares to check")

  const oneOpen = [
    { entityKey: "0xa", documentIds: ["x"], createdAt: 1, expiresAt: 2, openedAt: null },
    { entityKey: "0xb", documentIds: ["x"], createdAt: 1, expiresAt: 2, openedAt: 1_757_894_400 },
  ]
  const note = openedNoteText(oneOpen)
  assert.match(note, /was opened on/)
  assert.match(note, /cannot un-read/)
  console.log('PASS  the "opened" note appears only once a listed share has a reliable open')
}

// --- no chalk card when no live share includes it, and none is implied when
//     the index is unknown ---------------------------------------------------
{
  assert.equal(shouldShowSharesCard([], false), false, "a known, empty share list must show no card")
  assert.equal(shouldShowSharesCard([], true), true, "an unknown index must still say something, not imply zero")
  assert.equal(
    shouldShowSharesCard(
      [{ entityKey: "0xa", documentIds: ["x"], createdAt: 1, expiresAt: 2, openedAt: null }],
      false,
    ),
    true,
    "any live share holding the document must show the card",
  )
  console.log("PASS  the shares card is hidden only when the index is known and genuinely empty")
}

console.log("\nRemove document proof passed.")
