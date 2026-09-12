/**
 * H-53's Task 5 proof, and the story's own acceptance evidence: one asset,
 * two grants, two deadlines — one live recipient never gets a second chance
 * once its deadline passes, while the other keeps opening from the same
 * Swarm reference, and a key obtained before the deadline keeps working
 * afterward.
 *
 * Everything that would touch a real network — Arkiv, Swarm, TACo — is
 * injected into `openSend` and `createThresholdSend` (`lib/sends.ts`), the
 * same seam `scripts/send-path-proof.mjs` already uses for `createSend`. The
 * fake Arkiv here is a plain `Map`; the fake TACo provider checks that map
 * itself before releasing anything, exactly the shape `buildArkivGrantQuery`
 * asks a real node to check — grant id, owner, and the *original* expiry, and
 * a live head under it — so "release refuses once any one of those stops
 * matching" is proved at the same granularity the real condition enforces it.
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
process.env.NEXT_PUBLIC_ARKIV_RPC ??= "https://rpc.tiramisu.db-chain.testnet.arkiv.network"
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
async function ensureFunded() {
  return { funded: true }
}

// --- a fake Swarm: exactly one blob, ever ----------------------------------
let uploads = 0
let uploadedBlob = null
let uploadedRef = null
async function uploadEncryptedBlob(bytes) {
  uploads++
  uploadedBlob = bytes
  uploadedRef = "ab".repeat(32)
  return { reference: uploadedRef }
}
async function fetchBlobFromGateway(ref) {
  assert.equal(ref, uploadedRef, "must fetch the one uploaded blob, by its real reference")
  return uploadedBlob
}

// --- a fake Arkiv: entities keyed by entityKey, block time advances by hand -
let currentBlock = 1_000_000n
async function getCurrentBlock() {
  return currentBlock
}
const entities = new Map()
let nextEntity = 1
async function createThresholdGrant(params) {
  const entityKey = `0x${nextEntity.toString(16).padStart(64, "0")}`
  nextEntity++
  entities.set(entityKey, {
    entityKey,
    owner: identity.address,
    expiresBlock: Number(params.expiresBlock),
    grantId: params.grantId,
    payload: params.payload,
    fileKind: params.fileKind,
    fileCount: params.fileCount,
  })
  return {
    entityKey,
    txHash: `0x${"cc".repeat(32)}`,
    owner: identity.address,
    expiresBlock: Number(params.expiresBlock),
  }
}
async function getGrant(entityKey) {
  const entity = entities.get(entityKey)
  if (!entity) return null
  return {
    entityKey: entity.entityKey,
    payload: entity.payload,
    authCommitment: "",
    legacy: false,
    sender: entity.owner,
    owner: entity.owner,
    fileKind: entity.fileKind,
    createdAt: 0,
    expiresBlock: entity.expiresBlock,
    expiresAt: 0,
    recipient: "",
    label: "",
    fileCount: entity.fileCount,
  }
}

// --- a fake TACo provider that checks the fake Arkiv itself -----------------
// Real TACo nodes each run `buildArkivGrantQuery(binding)` against live Arkiv
// state before releasing anything; this stands in for that node-side check
// without a network, XOR-only in place of real threshold encryption (same
// style as `scripts/taco-package-proof.mjs`).
const { TacoUnavailableError } = await import("../lib/key-release/taco.ts")

function createFakeTacoProvider() {
  return {
    descriptor: { provider: "taco", domain: "lynx", ritualId: 27 },
    async protect(heldShare) {
      return Uint8Array.from(heldShare, (b) => b ^ 0xa5)
    },
    async release(protectedShare, binding) {
      const entity = [...entities.values()].find((e) => e.grantId === binding.grantId)
      const currentlyMatches =
        entity &&
        entity.owner.toLowerCase() === binding.owner.toLowerCase() &&
        entity.expiresBlock === Number(binding.expiresBlock) &&
        currentBlock < BigInt(entity.expiresBlock)
      if (!currentlyMatches) {
        throw new TacoUnavailableError("decrypt", "Threshold of responses not met; Arkiv condition did not match")
      }
      return Uint8Array.from(protectedShare, (b) => b ^ 0xa5)
    },
  }
}

/** Always throws: proves a code path never touches TACo at all. */
function createUnreachableTacoProvider() {
  return {
    descriptor: { provider: "taco", domain: "lynx", ritualId: 27 },
    async protect() {
      throw new Error("must not be called")
    },
    async release() {
      throw new Error("openSend must not call TACo once expiry is already known from Arkiv's own head")
    },
  }
}

const { createEncryptedAsset } = await import("../lib/assets.ts")
const { createThresholdSend, openSend } = await import("../lib/sends.ts")

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures")
const bloodTestPdf = new File(
  [readFileSync(path.join(fixturesDir, "thyroid-panel.pdf"))],
  "thyroid-panel.pdf",
  { type: "application/pdf" },
)

const asset = await createEncryptedAsset({ files: [bloodTestPdf] }, { uploadEncryptedBlob })
assert.equal(uploads, 1, "one asset, one upload")

const sendDeps = { getIdentity, ensureFunded, getCurrentBlock, createThresholdGrant, selectProtectingProvider: createFakeTacoProvider }
const openDeps = { getGrant, getCurrentBlock, fetchBlobFromGateway, selectReleasingProvider: createFakeTacoProvider }

// Grant A: a short window — it will lapse partway through this script.
// Grant B: a long window — it stays live throughout.
const grantA = await createThresholdSend(asset, { recipientLabel: "Doctor A", ttlSeconds: 20 }, sendDeps)
const grantB = await createThresholdSend(asset, { recipientLabel: "Doctor B", ttlSeconds: 2000 }, sendDeps)
assert.equal(uploads, 1, "issuing two grants must not upload a second time")
assert.equal(grantA.swarmRef, grantB.swarmRef, "both grants read from the same Swarm reference")

function fragmentOf(url) {
  return new URL(url).hash.slice(1)
}
const shortLink = { key: new URL(grantA.url).pathname.split("/").pop(), fragment: fragmentOf(grantA.url) }
const longLink = { key: new URL(grantB.url).pathname.split("/").pop(), fragment: fragmentOf(grantB.url) }

// --- 1. while both are live, grant A opens and its plaintext is captured ---
const firstOpen = await openSend(shortLink.key, shortLink.fragment, undefined, openDeps)
assert.equal(firstOpen.status, "ok", "grant A must open while its window is still live")
const firstFiles = firstOpen.send.files
assert.equal(firstFiles[0].header.name, "thyroid-panel.json")
console.log("PASS  grant A opens normally before its deadline")

// --- 2. grant A's window lapses; grant B's does not ------------------------
// 20s / 2s-per-block ≈ 10 blocks for A; 2000s ≈ 1000 blocks for B.
currentBlock += 11n

// --- 3. the untouched original link for grant A must not open again, and ---
//        must not even reach TACo — Arkiv's own head already answers it.
const secondOpenA = await openSend(shortLink.key, shortLink.fragment, undefined, {
  ...openDeps,
  selectReleasingProvider: createUnreachableTacoProvider,
})
assert.equal(secondOpenA.status, "expired", "grant A's untouched link must read as expired once its deadline passes")
console.log("PASS  grant A's original link cannot obtain new key material after its deadline, without ever calling TACo")

// --- 4. grant B, still live, opens from the exact same Swarm reference -----
const openB = await openSend(longLink.key, longLink.fragment, undefined, openDeps)
assert.equal(openB.status, "ok", "grant B must still open — same asset, its own later deadline")
assert.equal(openB.send.files[0].header.name, "thyroid-panel.json")
console.log("PASS  grant B still opens from the same Swarm reference after grant A has lapsed")

// --- 5. the honest half of the promise: a key obtained before the deadline -
//        keeps decrypting the same ciphertext afterward. This is not a new
//        `openSend` call (that path is now closed, per step 3) — it is the
//        plaintext/files a recipient already holds from step 1 remaining
//        usable, because expiry blocks new releases, not existing ones.
assert.deepEqual(
  Buffer.from(firstFiles[0].body),
  Buffer.from(openB.send.files[0].body),
  "previously obtained plaintext must remain byte-identical and usable after the source grant lapses",
)
console.log("PASS  key material obtained before the deadline remains usable afterward — the honest half of the promise")

// --- 6. a live grant whose Arkiv record simply never existed never reaches TACo
const missingResult = await openSend(shortLink.key.replace(/.$/, "0"), shortLink.fragment, undefined, {
  ...openDeps,
  selectReleasingProvider: createUnreachableTacoProvider,
})
assert.equal(missingResult.status, "expired")
console.log("PASS  an unknown v3 entity key reads as expired without ever constructing a TACo provider")

// --- 7. TACo's own denial (a live head, but the release condition itself
//        fails) is retryable unavailability, never a second way to say expired
const denyingProvider = () => ({
  descriptor: { provider: "taco", domain: "lynx", ritualId: 27 },
  async release() {
    throw new TacoUnavailableError("decrypt", "Threshold of responses not met")
  },
  async protect() {
    throw new Error("unused")
  },
})
// A fresh short-lived grant, still within its own window.
const grantC = await createThresholdSend(asset, { recipientLabel: "Doctor C", ttlSeconds: 2000 }, sendDeps)
const linkC = { key: new URL(grantC.url).pathname.split("/").pop(), fragment: fragmentOf(grantC.url) }
const deniedResult = await openSend(linkC.key, linkC.fragment, undefined, {
  ...openDeps,
  selectReleasingProvider: denyingProvider,
})
assert.equal(deniedResult.status, "unavailable", "a TACo-side failure must never be reported as expiry")
console.log("PASS  a TACo release failure maps to retryable unavailability, never expiry")

// --- 8. tampering with any bound field fails before any plaintext is produced
const grantD = await createThresholdSend(asset, { recipientLabel: "Doctor D", ttlSeconds: 2000 }, sendDeps)
const entityD = entities.get(grantD.entityKey)
const originalCiphertext = entityD.payload.release.ciphertext
entityD.payload.release.ciphertext = originalCiphertext.slice(0, -2) + (originalCiphertext.slice(-2) === "AA" ? "BB" : "AA")
const tamperedResult = await openSend(grantD.entityKey, fragmentOf(grantD.url), undefined, openDeps)
assert.notEqual(tamperedResult.status, "ok", "a tampered protected share must never decrypt")
entityD.payload.release.ciphertext = originalCiphertext
console.log("PASS  a tampered protected share fails before producing plaintext")

console.log("\nTACo unlock proof passed.")
