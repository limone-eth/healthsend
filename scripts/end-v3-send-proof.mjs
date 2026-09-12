/**
 * H-69's own evidence for "Ending a v3 share early" (lib/sends.ts, `endSend`):
 * a v3, threshold-release grant has no holder half to delete, so ending one
 * early has to mean deleting the Arkiv entity itself, as its owner. Offline,
 * against a fake Arkiv ledger and a fake Chipotle-shaped provider — no
 * network, no chain.
 *
 * What this proves:
 *   - `endSend` on a v3 grant deletes the Arkiv entity, reads it back, and
 *     reports "ended" only once it is gone. It never calls the holder's
 *     `/api/holder/revoke` at all;
 *   - H-72 (review-8 F5): a `getGrant` that throws returns an error and never
 *     falls through to the holder; a delete whose read-back still shows the
 *     entity, or cannot read it, returns an error rather than "ended";
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

async function unreachableFetch() {
  throw new Error("endSend must not call the holder for a v3 grant")
}
async function noWait() {}

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
  let getGrantCalls = 0
  let deleted = false
  async function getGrant() {
    getGrantCalls++
    return deleted ? null : grant
  }
  let deleteCalls = 0
  let deletedEntityKey = null
  async function deleteGrant(params) {
    deleteCalls++
    deletedEntityKey = params.entityKey
    deleted = true
    return { txHash: "0x" + "cc".repeat(32) }
  }

  const result = await endSend(entityKey, { getIdentity, getGrant, deleteGrant, fetch: unreachableFetch, wait: noWait })
  assert.deepEqual(result, { status: "ended" })
  assert.equal(deleteCalls, 1, "ending a v3 share must delete exactly one Arkiv entity")
  assert.equal(deletedEntityKey, entityKey, "it must delete the entity the caller actually named")
  assert.equal(getGrantCalls, 2, "it must read the grant back after the delete before saying ended")
  console.log("PASS  ending a v3 share deletes the Arkiv entity, confirms it is gone, and never calls the holder")
}

// --- H-72 (review-8 F5): a failed grant read never falls through to the holder ---
{
  let deleteCalls = 0
  const result = await endSend("0x" + "7c".repeat(32), {
    getIdentity,
    async getGrant() {
      throw new Error("HTTP 502 from the Arkiv RPC")
    },
    async deleteGrant() {
      deleteCalls++
      return { txHash: "0x" + "cc".repeat(32) }
    },
    fetch: async () => {
      throw new Error("endSend must not call the holder when it could not read the grant")
    },
    wait: noWait,
  })
  assert.equal(result.status, "error", "a thrown getGrant must never report ended")
  assert.match(result.message, /wasn't ended/)
  assert.equal(deleteCalls, 0)
  console.log("PASS  a thrown getGrant returns an error and never reaches the holder revoke")
}

// --- H-72 (review-8 F5): the delete read-back decides "ended" ---------------
{
  const v3Grant = { payload: { v: 3 } }

  async function endWithReadBack(readBack) {
    let reads = 0
    let waits = 0
    const result = await endSend("0x" + "7d".repeat(32), {
      getIdentity,
      async getGrant() {
        reads++
        if (reads === 1) return v3Grant
        return readBack(reads - 1)
      },
      async deleteGrant() {
        return { txHash: "0x" + "cc".repeat(32) }
      },
      fetch: unreachableFetch,
      async wait() {
        waits++
      },
    })
    return { result, readBacks: reads - 1, waits }
  }

  const stillLive = await endWithReadBack(() => v3Grant)
  assert.equal(stillLive.result.status, "error", "an entity still live after the delete must never report ended")
  assert.match(stillLive.result.message, /still shows this share as live/)
  assert.equal(stillLive.readBacks, 3)
  assert.equal(stillLive.waits, 2)
  console.log("PASS  a delete whose read-back still shows the entity returns an error, after 3 read-backs")

  const unreadable = await endWithReadBack(() => {
    throw new Error("timeout")
  })
  assert.equal(unreadable.result.status, "error", "a read-back that never succeeds must never report ended")
  assert.match(unreadable.result.message, /couldn't be read/)
  console.log("PASS  a delete whose read-back cannot read Arkiv returns an error")

  const lagging = await endWithReadBack((n) => {
    if (n === 1) throw new Error("timeout")
    return null
  })
  assert.deepEqual(lagging.result, { status: "ended" })
  assert.equal(lagging.readBacks, 2)
  console.log("PASS  a read-back that fails once and then finds the entity gone reports ended")
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
// A simplified stand-in for `chipotle-action.js`'s liveness check — the real
// action, with the binding sealed in its ciphertext, runs in
// `scripts/chipotle-binding-proof.mjs` (H-72). As in
// `scripts/chipotle-adapter-proof.mjs`'s "an expired (not-live) grant
// releases nothing" case, a grant absent from Arkiv's ledger — whether
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
