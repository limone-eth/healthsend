/**
 * H-53's Task 4 proof: one Swarm upload backs as many grants as the sender
 * likes.
 *
 * `createEncryptedAsset` (lib/assets.ts) is called once; `createThresholdSend`
 * (lib/sends.ts) is called twice against the asset it returns. Everything
 * that would touch a real network — Swarm, Arkiv, TACo — is injected, the
 * same seam `scripts/send-path-proof.mjs` already uses for `createSend`.
 *
 * What this proves:
 *   - exactly one upload happens, no matter how many grants follow;
 *   - both grants land as distinct Arkiv entities, both pointing at the same
 *     Swarm reference;
 *   - the two share links carry different fragments (a different link secret,
 *     and so a different derived TACo-protected share, per grant) even though
 *     they decrypt the same underlying content key.
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { registerHooks } from "node:module"
import { fileURLToPath } from "node:url"
import path from "node:path"

// Same extensionless-.ts resolution rule the rest of this repo's proofs use
// for Node's strip-types runner (see scripts/send-path-proof.mjs).
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
// lib/arkiv.ts reads this at import time, before a TACo condition is ever built.
process.env.NEXT_PUBLIC_ARKIV_RPC ??= "https://rpc.tiramisu.db-chain.testnet.arkiv.network"
// `createThresholdSend` reads `window.location.origin` to build the share URL.
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

let uploads = 0
async function uploadEncryptedBlob() {
  uploads++
  return { reference: "ab".repeat(32) }
}

let currentBlock = 1_000_000n
async function getCurrentBlock() {
  return currentBlock
}

let grants = 0
const writtenEntities = []
async function createThresholdGrant(params) {
  grants++
  const entityKey = `0x${grants.toString(16).padStart(64, "0")}`
  writtenEntities.push({ entityKey, ...params })
  return {
    entityKey,
    txHash: `0x${"cc".repeat(32)}`,
    owner: identity.address,
    expiresBlock: Number(params.expiresBlock),
  }
}

// A fake `KeyReleaseProvider` — no `@nucypher/taco`, no network, XOR-only, the
// same style `scripts/taco-package-proof.mjs` already uses. `createThresholdSend`
// does not need this to check anything against Arkiv; that is `openSend`'s job
// (see `scripts/taco-unlock-proof.mjs`), not something this proof re-tests.
function fakeCreateTacoKeyReleaseProvider() {
  return {
    descriptor: { provider: "taco", domain: "lynx", ritualId: 27 },
    async protect(heldShare) {
      return Uint8Array.from(heldShare, (b) => b ^ 0xa5)
    },
    async release(protectedShare) {
      return Uint8Array.from(protectedShare, (b) => b ^ 0xa5)
    },
  }
}

const { createEncryptedAsset } = await import("../lib/assets.ts")
const { createThresholdSend } = await import("../lib/sends.ts")

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures")
const bloodTestPdf = new File(
  [readFileSync(path.join(fixturesDir, "thyroid-panel.pdf"))],
  "thyroid-panel.pdf",
  { type: "application/pdf" },
)

const asset = await createEncryptedAsset({ files: [bloodTestPdf] }, { uploadEncryptedBlob })

assert.equal(uploads, 1, "packing and encrypting the asset must upload exactly once")
assert.ok(asset.contentKey instanceof Uint8Array && asset.contentKey.length === 32)
assert.equal(typeof asset.ref, "string")

const deps = { getIdentity, ensureFunded, getCurrentBlock, createThresholdGrant, selectProtectingProvider: fakeCreateTacoKeyReleaseProvider }

const a = await createThresholdSend(asset, { recipientLabel: "Doctor A", ttlSeconds: 30 }, deps)
const b = await createThresholdSend(asset, { recipientLabel: "Doctor B", ttlSeconds: 300 }, deps)

assert.equal(uploads, 1, "issuing a second grant must not upload again")
assert.equal(grants, 2, "two grants must be written")
assert.notEqual(a.entityKey, b.entityKey, "each grant is its own Arkiv entity")
assert.equal(a.swarmRef, asset.ref, "grant A must point at the one uploaded asset")
assert.equal(b.swarmRef, asset.ref, "grant B must point at the same uploaded asset")
assert.equal(a.swarmRef, b.swarmRef, "both grants share one Swarm reference")
assert.notEqual(new URL(a.url).hash, new URL(b.url).hash, "each grant gets its own link secret")

// Each grant's payload carries a different TACo-protected share — never the
// same ciphertext reused across recipients, even though both decrypt the
// same content key once joined with their own link secret.
const [entityA, entityB] = writtenEntities
assert.notEqual(entityA.grantId, entityB.grantId, "each grant gets its own random grant id")
assert.notEqual(entityA.payload.release.ciphertext, entityB.payload.release.ciphertext, "each grant's protected share must be distinct ciphertext")
assert.equal(entityA.payload.ref, asset.ref)
assert.equal(entityB.payload.ref, asset.ref)

console.log("PASS  one createEncryptedAsset call uploads exactly once")
console.log("PASS  two createThresholdSend calls write two distinct grants against that one asset")
console.log("PASS  both grants share a Swarm reference but carry distinct links and protected shares")
console.log("\nSingle-upload, many-grants proof passed.")
