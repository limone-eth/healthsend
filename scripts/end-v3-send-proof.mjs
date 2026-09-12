/**
 * H-69's own evidence for "Ending a v3 share early" (lib/sends.ts, `endSend`):
 * a v3, threshold-release grant has no holder half to delete, so ending one
 * early has to mean deleting the Arkiv entity itself, as its owner. Offline,
 * against a fake Arkiv ledger and a fake Chipotle-shaped provider — no
 * network, no chain.
 *
 * What this proves:
 *   - `endSend` on a v3 grant deletes the Arkiv entity, and never calls the
 *     holder's `/api/holder/revoke` at all;
 *   - `endSend` on a v2/legacy grant is unaffected — it still calls the
 *     holder, exactly as before;
 *   - once the entity is deleted, a release attempt against the same
 *     binding — the fake enclave's own liveness check, mirroring
 *     `chipotle-action.js`'s `grantIsLive` — is refused, the same way an
 *     expired grant already is. This is the "the enclave refuses afterwards"
 *     proof the story's amendments ask for.
 */
import assert from "node:assert/strict"
import { registerHooks } from "node:module"

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (error) {
      if (!specifier.startsWith(".") || /\.[cm]?[jt]sx?$/.test(specifier)) throw error
      return nextResolve(`${specifier}.ts`, context)
    }
  },
})

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

const { endSend } = await import("../lib/sends.ts")
const { ChipotleUnavailableError } = await import("../lib/key-release/chipotle.ts")

// --- a v3 grant deletes the entity, and never calls the holder -------------
{
  const entityKey = "0x" + "7a".repeat(32)
  const grant = {
    entityKey,
    payload: { v: 3, ref: "ab".repeat(32), release: { provider: "chipotle", domain: "chipotle", ritualId: 0, iv: "x", ciphertext: "y", grantId: "0x" + "11".repeat(32) } },
    authCommitment: "",
    legacy: false,
    sender: identity.address,
    owner: identity.address,
    fileKind: "pdf",
    createdAt: 0,
    expiresBlock: 1_000_500,
    expiresAt: 0,
    recipient: "",
    label: "",
    fileCount: 1,
  }
  async function getGrant() {
    return grant
  }
  let deleteCalls = 0
  let deletedEntityKey = null
  async function deleteGrant(params) {
    deleteCalls++
    deletedEntityKey = params.entityKey
    return { txHash: "0x" + "cc".repeat(32) }
  }
  async function unreachableFetch() {
    throw new Error("endSend must not call the holder for a v3 grant")
  }

  const result = await endSend(entityKey, { getIdentity, getGrant, deleteGrant, fetch: unreachableFetch })
  assert.deepEqual(result, { status: "ended" })
  assert.equal(deleteCalls, 1, "ending a v3 share must delete exactly one Arkiv entity")
  assert.equal(deletedEntityKey, entityKey, "it must delete the entity the caller actually named")
  console.log("PASS  ending a v3 share deletes the Arkiv entity and never calls the holder")
}

// --- a v2/legacy grant is unaffected: it still calls the holder -----------
{
  const entityKey = "0x" + "9b".repeat(32)
  const grant = {
    entityKey,
    payload: { v: 2, ref: "cd".repeat(32), authCommitment: "deadbeef" },
    authCommitment: "deadbeef",
    legacy: false,
    sender: identity.address,
    owner: identity.address,
    fileKind: "pdf",
    createdAt: 0,
    expiresBlock: 1_000_500,
    expiresAt: 0,
    recipient: "",
    label: "",
    fileCount: 1,
  }
  async function getGrant() {
    return grant
  }
  async function unreachableDeleteGrant() {
    throw new Error("endSend must not delete the Arkiv entity for a v2 grant")
  }
  let holderCalls = 0
  async function fakeFetch(url) {
    assert.equal(String(url), "/api/holder/revoke")
    holderCalls++
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  }

  const result = await endSend(entityKey, { getIdentity, getGrant, deleteGrant: unreachableDeleteGrant, fetch: fakeFetch })
  assert.deepEqual(result, { status: "ended" })
  assert.equal(holderCalls, 1, "a v2/legacy grant must still end through the holder")
  console.log("PASS  ending a v2/legacy share is unaffected — it still calls the holder, never Arkiv delete")
}

// --- once deleted, the enclave itself refuses a release for that grant -----
// Mirrors `chipotle-action.js`'s own liveness check
// (`scripts/chipotle-adapter-proof.mjs`'s "an expired (not-live) grant
// releases nothing" case): a grant absent from Arkiv's ledger — whether
// because it lapsed naturally or because its owner deleted it — is refused
// identically. This is what "the enclave refuses afterwards" means in
// practice, proved with a fake client offline.
{
  const { createChipotleKeyReleaseProvider, __resetChipotleAdapterStateForTests } = await import(
    "../lib/key-release/chipotle.ts"
  )
  __resetChipotleAdapterStateForTests()

  const CONFIG = {
    enabled: true,
    actionCid: "bafyreitestaction",
    pkpId: "pkp-test",
    groupId: "1",
    usageApiKey: "usage-key-for-tests",
  }
  const binding = {
    grantId: `0x${"33".repeat(32)}`,
    owner: `0x${"aa".repeat(20)}`,
    expiresBlock: 900n,
    ref: "ab".repeat(32),
  }

  // A ledger that starts with the grant live, then has it deleted — exactly
  // what `deleteGrant` does to a real Arkiv entity, reproduced here as a plain
  // Map so no chain is needed to prove the consequence.
  const arkivLedger = new Map()
  arkivLedger.set(binding.grantId.toLowerCase(), { owner: binding.owner, expiresBlock: binding.expiresBlock.toString() })

  function toBase64(bytes) {
    let s = ""
    for (const b of bytes) s += String.fromCharCode(b)
    return btoa(s)
  }
  function fromBase64(value) {
    const binary = atob(value)
    const out = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
    return out
  }
  const { encodeGrantBinding, toHex } = await import("../lib/crypto.ts")
  async function computeCommitment(grantId, owner, expiresBlockStr, ref) {
    const bytes = encodeGrantBinding({ grantId, owner, expiresBlock: BigInt(expiresBlockStr), ref })
    const digest = await crypto.subtle.digest("SHA-256", bytes)
    return toHex(new Uint8Array(digest))
  }
  const client = {
    async ping() {},
    async getGroupAuthorization() {
      return { hashedActionCids: [(await import("../lib/key-release/chipotle.ts")).hashActionCid(CONFIG.actionCid)], pkpInGroup: true }
    },
    async invokeAction({ jsParams }) {
      const expected = await computeCommitment(jsParams.grantId, jsParams.owner, jsParams.expiresBlock, jsParams.ref)
      if (expected !== jsParams.commitment) return { authorized: false, error: "commitment mismatch" }
      if (jsParams.mode === "release") {
        const entry = arkivLedger.get(jsParams.grantId.toLowerCase())
        const live = entry && entry.owner.toLowerCase() === jsParams.owner.toLowerCase() && String(entry.expiresBlock) === jsParams.expiresBlock
        if (!live) return { authorized: false, error: "grant is not live" }
      }
      const input = jsParams.mode === "protect" ? jsParams.payload : jsParams.ciphertext
      return { authorized: true, result: toBase64(Uint8Array.from(fromBase64(input), (b) => b ^ 0x5a)) }
    },
    async getActionIpfsId() {
      throw new Error("must not be needed — this proof never triggers a cache-miss retry")
    },
  }

  const provider = createChipotleKeyReleaseProvider({ client, config: CONFIG })
  const heldShare = new Uint8Array(32).fill(4)
  const protectedShare = await provider.protect(heldShare, binding)

  // While still live, release succeeds.
  const released = await provider.release(protectedShare, binding)
  assert.deepEqual(released, heldShare, "release must succeed while the grant is still live")

  // Delete it — the same effect `deleteGrant` (lib/arkiv.ts) has on a real
  // entity.
  arkivLedger.delete(binding.grantId.toLowerCase())

  await assert.rejects(
    () => provider.release(protectedShare, binding),
    (error) => error instanceof ChipotleUnavailableError && /not live/.test(error.message),
    "the enclave must refuse to release once the grant entity has been deleted",
  )
  console.log("PASS  once the grant entity is deleted, the enclave refuses to release for it")
}

console.log("\nAll checks passed.")
