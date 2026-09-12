/**
 * H-69's own evidence for `createSendFromArchive`'s Chipotle branch
 * (`lib/sends.ts`), offline: everything that would touch a real network —
 * Swarm, Arkiv, Chipotle — is injected, the same seam
 * `scripts/archive-send-proof.mjs` already uses for the disabled path (left
 * unmodified — see docs/stories/H-69.md's acceptance criteria).
 *
 * What this proves:
 *   - with `NEXT_PUBLIC_CHIPOTLE_ENABLED=true` and no code, a code-less
 *     archive send never calls `/api/holder/share` and writes a `v: 3` grant
 *     whose `release.provider` is `"chipotle"`;
 *   - the share that grant carries actually opens — the protected envelope
 *     round-trips back to the exact original PDF bytes;
 *   - a share with a code stays on the holder path even with Chipotle
 *     enabled (H-7's attempt counter lives only in the holder — see
 *     docs/stories/H-69.md, "## Choices").
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { registerHooks } from "node:module"
import { fileURLToPath } from "node:url"
import path from "node:path"

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

process.env.NODE_ENV ??= "test"
process.env.NEXT_PUBLIC_CHIPOTLE_ENABLED = "true"
globalThis.window = { location: { origin: "http://localhost:3100" } }

const { generatePrivateKey, privateKeyToAccount } = await import("viem/accounts")
const privateKey = generatePrivateKey()
const identity = {
  privateKey,
  address: privateKeyToAccount(privateKey).address,
  blindKey: crypto.getRandomValues(new Uint8Array(32)),
  archiveKey: crypto.getRandomValues(new Uint8Array(32)),
  archiveTopic: crypto.getRandomValues(new Uint8Array(32)),
}
async function getIdentity() {
  return identity
}

let uploadCount = 0
const uploadedBlobs = []
async function uploadEncryptedBlob(bytes) {
  uploadCount += 1
  uploadedBlobs.push(bytes)
  // A valid-looking 32-byte hex reference: `protectGrantShare`'s
  // `validateBinding` (lib/grant-package.ts) refuses anything else as the
  // grant binding's `ref`, unlike the plain v2 path this proof's sibling
  // (`scripts/archive-send-proof.mjs`) exercises.
  return { reference: uploadCount.toString(16).padStart(2, "0").repeat(32) }
}

let holderShareCalls = 0
// Starts "down": the preflight GET throws. A Chipotle-enabled, code-less send
// must never call it at all — see docs/stories/H-69.md, "`/api/holder`
// preflight". Flipped to "up" before the coded-share case below, which still
// needs the holder.
let holderIsUp = false
globalThis.fetch = async (url, init) => {
  const requestPath = String(url)
  if (requestPath === "/api/fund") return new Response(JSON.stringify({ funded: true }), { status: 200 })
  if (requestPath === "/api/holder/share") {
    if ((init?.method ?? "GET") === "GET") {
      if (!holderIsUp) throw new TypeError("fetch failed: connect ECONNREFUSED")
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }
    holderShareCalls++
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  }
  throw new Error(`archive-send-chipotle-proof does not stub fetch for ${requestPath}`)
}

let currentBlock = 1_000_000n
async function getCurrentBlock() {
  return currentBlock
}

let v2Grants = 0
async function createGrant(params) {
  v2Grants++
  return {
    entityKey: "0x" + String(v2Grants).padStart(2, "0").repeat(32).slice(0, 64),
    txHash: "0x" + "22".repeat(32),
    expiresBlock: 1_000_500,
    expiresAt: Math.floor(Date.now() / 1000) + params.ttlSeconds,
  }
}

let thresholdGrants = 0
let lastThresholdPayload = null
async function createThresholdGrant(params) {
  thresholdGrants++
  lastThresholdPayload = params.payload
  return {
    entityKey: `0x${thresholdGrants.toString(16).padStart(64, "0")}`,
    txHash: `0x${"cc".repeat(32)}`,
    owner: identity.address,
    expiresBlock: Number(params.expiresBlock),
  }
}

// A fake `KeyReleaseProvider` naming itself Chipotle — XOR-only, no network,
// same style `scripts/single-upload-grants-proof.mjs` already uses for a fake
// TACo provider. This proof is about the *wiring* (which provider gets
// selected, what shape gets written, whether the holder is ever touched),
// not the Chipotle adapter's own internals — those are
// `scripts/chipotle-adapter-proof.mjs`'s job.
function selectProtectingProvider() {
  return {
    descriptor: { provider: "chipotle", domain: "chipotle", ritualId: 0 },
    async protect(heldShare) {
      return Uint8Array.from(heldShare, (b) => b ^ 0x5a)
    },
    async release(protectedShare) {
      return Uint8Array.from(protectedShare, (b) => b ^ 0x5a)
    },
  }
}

const { createSendFromArchive } = await import("../lib/sends.ts")
const { releaseGrantShare } = await import("../lib/grant-package.ts")
const { fromBase64Url, joinContentKey, open, toBase64Url } = await import("../lib/crypto.ts")
const { unpackEnvelope } = await import("../lib/envelope.ts")

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures")
function loadPdfDocument(name) {
  const bytes = new Uint8Array(readFileSync(path.join(fixturesDir, name)))
  return {
    record: {
      id: `record:${name}`,
      kind: "document",
      name,
      size: bytes.length,
      provenance: { sourceId: `source:${name}`, importedAt: new Date().toISOString() },
      bytes: toBase64Url(bytes),
    },
    rawBytes: bytes,
  }
}
const patientSummary = loadPdfDocument("patient-summary.pdf")

// --- an enabled, code-less archive send never touches the holder, and writes v3/chipotle ---
{
  const indexedShares = []
  const result = await createSendFromArchive(
    { documents: [patientSummary.record], recipientLabel: "recipient", ttlSeconds: 3600 },
    {
      getIdentity,
      uploadEncryptedBlob,
      getCurrentBlock,
      createThresholdGrant,
      selectProtectingProvider,
      addShareIndexEntry: async (entry) => indexedShares.push(entry),
    },
  )

  // H-18 × H-69: a Chipotle share is recorded in the archive's share index too, or the
  // remove sheet could never say which open shares include a document.
  assert.equal(indexedShares.length, 1, "a Chipotle archive send must record the share in the share index")
  assert.equal(indexedShares[0].entityKey, result.entityKey)
  assert.deepEqual(indexedShares[0].documentIds, [patientSummary.record.id])
  assert.equal(indexedShares[0].expiresAt, result.expiresAt)

  assert.equal(holderShareCalls, 0, "a Chipotle-enabled, code-less archive send must never call /api/holder/share")
  assert.equal(uploadCount, 1, "sharing one archived document must upload exactly once")
  assert.ok(lastThresholdPayload, "the grant must be written through createThresholdGrant, not createGrant")
  assert.equal(lastThresholdPayload.v, 3, "an enabled archive send must write a v3 grant")
  assert.equal(lastThresholdPayload.release.provider, "chipotle", "the v3 grant's release must name the Chipotle provider")
  assert.equal(result.code, undefined, "a Chipotle send never carries a code")
  assert.deepEqual(result.setAside, [])

  // The share this grant carries must actually open: reverse the same
  // envelope/binding pair `openSend`'s v3 branch would, using the fake
  // provider above, and recover the exact original PDF bytes.
  const fragment = result.url.split("#")[1]
  const linkSecret = fromBase64Url(fragment)
  // `lib/sends.ts`'s NOMINAL_BLOCK_SECONDS is 2 and unexported (duplicated by
  // design — see that file's own comment); `currentBlock + ceil(ttl / 2)` is
  // the same arithmetic `protectAndWriteThresholdGrant` just ran to bind this
  // grant, mirrored here rather than imported.
  const binding = {
    grantId: lastThresholdPayload.release.grantId,
    owner: identity.address,
    expiresBlock: currentBlock + BigInt(Math.ceil(3600 / 2)),
    ref: lastThresholdPayload.ref,
  }

  const provider = selectProtectingProvider()
  const heldShare = await releaseGrantShare(lastThresholdPayload.release, linkSecret, binding, provider)
  const contentKey = await joinContentKey(heldShare, linkSecret)

  const blob = uploadedBlobs.at(-1)
  const IV_BYTES = 12
  const envelope = await open(contentKey, { iv: blob.subarray(0, IV_BYTES), ciphertext: blob.subarray(IV_BYTES) })
  const files = unpackEnvelope(envelope)
  assert.equal(files.length, 1)
  assert.equal(
    Buffer.from(files[0].body).toString("hex"),
    Buffer.from(patientSummary.rawBytes).toString("hex"),
    "the recipient must receive the exact PDF bytes through the Chipotle-protected v3 grant",
  )

  console.log("PASS  an enabled, code-less archive send never calls /api/holder/share, even while the holder is down")
  console.log("PASS  it writes a v3 grant whose release names the Chipotle provider")
  console.log("PASS  the Chipotle-protected share round-trips back to the exact original PDF bytes")
}

// --- a coded share stays on the holder path even with Chipotle enabled -----
{
  holderIsUp = true // this case needs the holder; the case above proved it never had to
  const before = { holderShareCalls, thresholdGrants, v2Grants }
  const result = await createSendFromArchive(
    { documents: [patientSummary.record], recipientLabel: "recipient", ttlSeconds: 3600, code: "4821" },
    { getIdentity, uploadEncryptedBlob, getCurrentBlock, createThresholdGrant, createGrant, selectProtectingProvider },
  )
  assert.equal(thresholdGrants, before.thresholdGrants, "a coded share must never write a v3 grant")
  assert.equal(v2Grants, before.v2Grants + 1, "a coded share must still write the ordinary v2 grant")
  assert.equal(holderShareCalls, before.holderShareCalls + 1, "a coded share must still hand its key share to the holder")
  assert.equal(result.code, "4821")
  console.log("PASS  a coded share stays on the holder path even while Chipotle is enabled")
}

console.log("\nAll checks passed.")
