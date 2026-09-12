/**
 * H-70's required evidence: the Swarm feed can keep answering the reference
 * from before a write for a while after that write lands. Without a memory
 * of its own last write, `lib/archive-store.ts`'s read-modify-write cycle
 * would start the next change from that stale archive and silently discard
 * the edit just made — see docs/stories/H-70.md, "Why".
 *
 * `makeLaggingBackend` below is a feed stub that, after every write, keeps
 * answering the previous reference for a fixed number of reads before
 * catching up — the same shape `e2e/archive-persistence.spec.ts`'s lagging
 * mode uses in the browser, but here with no network and no Swarm ID: every
 * dependency `lib/archive-store.ts` takes (`getIdentity`,
 * `readArchiveReference`, `writeArchiveReference`, `fetchBlobFromGateway`,
 * `uploadEncryptedBlob`) is injected the same way `scripts/archive-store-proof.mjs`
 * already does.
 *
 * Run red first: before this story, `readStoredArchive` read only the feed
 * (`lib/archive-store.ts`'s old `readStoredArchive`, one line —
 * `dependencies.readArchiveReference(identity.archiveTopic)` with nothing to
 * compare it against), so every "survives the lag" assertion below fails.
 * This file's own git history shows that red run.
 */
import assert from "node:assert/strict"
import { registerHooks } from "node:module"

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

const { addRecordsToMyArchive, removeDocumentFromMyArchive, loadMyArchive } = await import(
  "../lib/archive-store.ts"
)
const { openArchive } = await import("../lib/archive.ts")

const senderKey = crypto.getRandomValues(new Uint8Array(32))

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
    provenance: { sourceId: `source:${id}`, importedAt: "2026-09-13T09:00:00.000Z" },
    bytes: Buffer.from(bytes).toString("base64url"),
  }
}

const ARCHIVE_MAGIC = new Uint8Array([0x48, 0x53, 0x41, 0x52]) // HSAR, matches lib/archive.ts
const ARCHIVE_VERSION = 1
const ARCHIVE_IV_BYTES = 12

/** Builds ciphertext in the exact shape an archive sealed before this story has: no `rev`, no `updatedAt`. */
async function encryptLegacyArchive(archiveWithoutRevision, key) {
  const prefix = new Uint8Array([...ARCHIVE_MAGIC, ARCHIVE_VERSION])
  const iv = crypto.getRandomValues(new Uint8Array(ARCHIVE_IV_BYTES))
  const cryptoKey = await crypto.subtle.importKey("raw", key, "AES-GCM", false, ["encrypt"])
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: prefix },
    cryptoKey,
    new TextEncoder().encode(JSON.stringify(archiveWithoutRevision)),
  )
  const out = new Uint8Array(prefix.length + iv.length + ciphertext.byteLength)
  out.set(prefix, 0)
  out.set(iv, prefix.length)
  out.set(new Uint8Array(ciphertext), prefix.length + iv.length)
  return out
}

/**
 * A feed that, after every write, keeps answering the *previous* reference
 * for `lagReads` more calls to `readArchiveReference` before it catches up —
 * exactly the behaviour docs/stories/H-70.md describes. `blobs` is a real
 * reference-keyed store, so a caller that fetches the wrong reference gets
 * the wrong (or missing) bytes, not silently the right ones.
 */
function makeLaggingBackend({ lagReads, identity, seedReference, seedBlob }) {
  const blobs = new Map()
  if (seedReference) blobs.set(seedReference, seedBlob)
  let visibleReference = seedReference ?? null
  let pendingReference = null
  let remainingLaggedReads = 0
  let uploadCount = 0

  const deps = {
    getIdentity: async () => identity,
    readArchiveReference: async () => {
      if (pendingReference !== null) {
        if (remainingLaggedReads > 0) {
          remainingLaggedReads -= 1
          return visibleReference
        }
        visibleReference = pendingReference
        pendingReference = null
      }
      return visibleReference
    },
    writeArchiveReference: async (_topic, reference) => {
      pendingReference = reference
      remainingLaggedReads = lagReads
    },
    fetchBlobFromGateway: async (reference) => {
      const blob = blobs.get(reference)
      if (!blob) throw new Error(`Lagging backend has no blob for ${reference}`)
      return blob
    },
    uploadEncryptedBlob: async (bytes) => {
      uploadCount += 1
      const reference = `rev-${uploadCount}`
      blobs.set(reference, bytes)
      return { reference }
    },
  }

  return { deps, blobs }
}

const identityFor = (fill) => ({
  archiveKey: senderKey,
  archiveTopic: new Uint8Array(32).fill(fill),
})

// --- add A, then add B, then remove A: the final archive holds exactly B,
//     and so does a fresh `loadMyArchive` while the feed is still lagging ---
{
  const identity = identityFor(70)
  const { deps } = makeLaggingBackend({ lagReads: 2, identity })
  const docA = documentRecord("record:document:a", "Blood test, March.pdf")
  const docB = documentRecord("record:document:b", "Thyroid panel, June.pdf")

  const afterA = await addRecordsToMyArchive([docA], deps)
  assert.deepEqual(afterA.records.map((r) => r.id), [docA.id])
  assert.equal(afterA.rev, 1)

  // The feed is still answering the reference from before A landed (or from
  // before B, below) for up to two more reads — the exact lag the story
  // describes: "cleared with no error, and the list still said 1 BLOOD TEST."
  const afterB = await addRecordsToMyArchive([docB], deps)
  assert.deepEqual(
    afterB.records.map((r) => r.id).sort(),
    [docA.id, docB.id],
    "adding B while the feed still reports A's reference must not lose A",
  )
  assert.equal(afterB.rev, 2)

  const afterRemoveA = await removeDocumentFromMyArchive(docA.id, deps)
  assert.deepEqual(
    afterRemoveA.records.map((r) => r.id),
    [docB.id],
    "removing A must leave exactly B, not silently restore A from a stale read",
  )
  assert.equal(afterRemoveA.rev, 3)

  // "So does a fresh loadMyArchive while the feed is still lagging": read
  // again immediately, before the feed has caught up to the removal.
  const reloaded = await loadMyArchive(deps)
  assert.deepEqual(
    reloaded.records.map((r) => r.id),
    [docB.id],
    "a fresh read while the feed lags must still see the final state, not an older one",
  )
  console.log("PASS  add A, add B, remove A survive a lagging feed — the final archive holds exactly B")
}

// --- two concurrent adds both survive -----------------------------------
{
  const identity = identityFor(71)
  const { deps } = makeLaggingBackend({ lagReads: 3, identity })
  const docA = documentRecord("record:document:concurrent-a", "Concurrent A.pdf")
  const docB = documentRecord("record:document:concurrent-b", "Concurrent B.pdf")

  // Two picks fired back to back, exactly as a second file-picker selection
  // landing while the first is still uploading would: `addRecordsToMyArchive`
  // must serialise them rather than let both start from the same read.
  const [resultA, resultB] = await Promise.all([
    addRecordsToMyArchive([docA], deps),
    addRecordsToMyArchive([docB], deps),
  ])

  const finalIds = new Set([...resultA.records, ...resultB.records].map((r) => r.id))
  assert.ok(finalIds.has(docA.id) && finalIds.has(docB.id), "both concurrent adds must be visible somewhere")

  const settled = await loadMyArchive(deps)
  assert.deepEqual(
    settled.records.map((r) => r.id).sort(),
    [docA.id, docB.id].sort(),
    "two concurrent adds must both survive in the final archive, none silently overwritten",
  )
  console.log("PASS  two concurrent adds are serialised and both survive")
}

// --- an old archive without `rev` still opens, and upgrades on its first
//     write through the store ------------------------------------------
{
  const identity = identityFor(72)
  const legacyDoc = documentRecord("record:document:legacy", "Sealed before this story.pdf")
  const legacyBlob = await encryptLegacyArchive(
    { v: 1, kind: "healthsend-archive", records: [legacyDoc] },
    senderKey,
  )
  const opened = await openArchive(legacyBlob, senderKey)
  assert.equal(opened.rev, 0, "an archive with no rev field must open as rev 0")
  assert.equal(opened.updatedAt, 0)

  const { deps } = makeLaggingBackend({
    lagReads: 1,
    identity,
    seedReference: "legacy-ref",
    seedBlob: legacyBlob,
  })

  const loaded = await loadMyArchive(deps)
  assert.equal(loaded.rev, 0, "loadMyArchive must open a legacy archive as rev 0, not fail")
  assert.deepEqual(loaded.records.map((r) => r.id), [legacyDoc.id])

  const newDoc = documentRecord("record:document:after-legacy", "Added after upgrade.pdf")
  const upgraded = await addRecordsToMyArchive([newDoc], deps)
  assert.equal(upgraded.rev, 1, "the first write through the store must bump a legacy archive's rev")
  assert.deepEqual(
    upgraded.records.map((r) => r.id).sort(),
    [legacyDoc.id, newDoc.id].sort(),
    "the legacy record must survive its own archive's upgrade",
  )
  console.log("PASS  an archive sealed before this story opens as rev 0 and upgrades on its first write")
}

console.log("\nArchive lag proof passed.")
