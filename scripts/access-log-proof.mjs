/**
 * Proves "When she looked" offline: no Redis, no chain, no network.
 *
 *   resolveUnlock(entityKey, authKey, { getGrant, getShare, recordAccess })  — lib/unlock.ts
 *   readAccessLog(request, { getGrant, getAccessLog })  — lib/access-log.ts
 *
 * Both take their Arkiv and holder access as injected dependencies, so the
 * property under test here is the recording hook and the sender-only read —
 * not Redis or the RPC.
 */
import assert from "node:assert/strict"
import { webcrypto } from "node:crypto"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"

const { resolveUnlock } = await import("../lib/unlock.ts")
const { readAccessLog, accessLogMessage } = await import("../lib/access-log.ts")

const ENTITY_KEY = "0x" + "22".repeat(32)

const sender = privateKeyToAccount(generatePrivateKey())
const attacker = privateKeyToAccount(generatePrivateKey())

async function commitmentFor(authKeyBytes) {
  const digest = await webcrypto.subtle.digest("SHA-256", authKeyBytes)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")
}

function toBase64Url(bytes) {
  return Buffer.from(bytes).toString("base64url")
}

async function validAuthKey() {
  const bytes = webcrypto.getRandomValues(new Uint8Array(32))
  return { authKey: toBase64Url(bytes), commitment: await commitmentFor(bytes) }
}

// --- a served unlock records exactly one event -------------------------------
{
  const now = Math.floor(Date.now() / 1000)
  const { authKey, commitment } = await validAuthKey()
  const grant = { sender: sender.address, authCommitment: commitment, expiresAt: now + 3600 }
  const stored = { share: "held-share", commitment }
  const recorded = []
  const deps = {
    getGrant: async () => grant,
    getShare: async () => stored,
    recordAccess: async (entityKey, at) => recorded.push({ entityKey, at }),
  }

  const result = await resolveUnlock(ENTITY_KEY, authKey, deps)

  assert.equal(result.ok, true, "a correct auth key must be served")
  assert.equal(recorded.length, 1, "a served unlock must record exactly one event")
  assert.equal(recorded[0].entityKey, ENTITY_KEY)
  assert.ok(Number.isFinite(recorded[0].at), "the recorded event must carry a timestamp")
  console.log("PASS  a served unlock records one event")
}

// --- a rejected unlock records none -------------------------------------------
{
  const now = Math.floor(Date.now() / 1000)
  const { commitment } = await validAuthKey()
  const { authKey: wrongAuthKey } = await validAuthKey()
  const grant = { sender: sender.address, authCommitment: commitment, expiresAt: now + 3600 }
  const stored = { share: "held-share", commitment }
  const recorded = []
  const deps = {
    getGrant: async () => grant,
    getShare: async () => stored,
    recordAccess: async (entityKey, at) => recorded.push({ entityKey, at }),
  }

  const result = await resolveUnlock(ENTITY_KEY, wrongAuthKey, deps)

  assert.equal(result.ok, false)
  assert.equal(result.status, 403)
  assert.equal(recorded.length, 0, "a rejected unlock must record nothing")
  console.log("PASS  a rejected unlock records none")
}

// --- an expired grant records nothing either ----------------------------------
{
  const { authKey } = await validAuthKey()
  const recorded = []
  const deps = {
    getGrant: async () => null,
    getShare: async () => {
      throw new Error("must not be reached once the grant is gone")
    },
    recordAccess: async (entityKey, at) => recorded.push({ entityKey, at }),
  }

  const result = await resolveUnlock(ENTITY_KEY, authKey, deps)

  assert.equal(result.ok, false)
  assert.equal(result.status, 410)
  assert.equal(recorded.length, 0, "an expired grant must record nothing")
  console.log("PASS  an expired grant records nothing")
}

// --- the sender can read the record --------------------------------------------
{
  const now = Math.floor(Date.now() / 1000)
  const grant = { sender: sender.address }
  const opened = [now - 100, now - 10]
  const deps = { getGrant: async () => grant, getAccessLog: async () => opened }

  const signature = await sender.signMessage({ message: accessLogMessage(ENTITY_KEY, now) })
  const result = await readAccessLog({ entityKey: ENTITY_KEY, signature, timestamp: now }, deps)

  assert.equal(result.ok, true, "the sender must be able to read the record")
  assert.deepEqual(result.opened, opened)
  console.log("PASS  the sender can read the record")
}

// --- a different key cannot ----------------------------------------------------
{
  const now = Math.floor(Date.now() / 1000)
  const grant = { sender: sender.address }
  let read = false
  const deps = {
    getGrant: async () => grant,
    getAccessLog: async () => {
      read = true
      return [now]
    },
  }

  const signature = await attacker.signMessage({ message: accessLogMessage(ENTITY_KEY, now) })
  const result = await readAccessLog({ entityKey: ENTITY_KEY, signature, timestamp: now }, deps)

  assert.equal(result.ok, false)
  assert.equal(result.status, 403)
  assert.ok(!read, "a signature from any other key must never reach the stored record")
  console.log("PASS  a different key cannot read the record, and never touches storage")
}

// --- a revoke signature does not authorise reading the log ---------------------
{
  const now = Math.floor(Date.now() / 1000)
  const grant = { sender: sender.address }
  let read = false
  const deps = {
    getGrant: async () => grant,
    getAccessLog: async () => {
      read = true
      return [now]
    },
  }

  // A real signature from the real sender — but signed for "revoke", not
  // "access-log". Recovery over the wrong message yields a different address,
  // so the domain prefix must stop it from crossing over.
  const { revokeMessage } = await import("../lib/revoke.ts")
  const signature = await sender.signMessage({ message: revokeMessage(ENTITY_KEY, now) })
  const result = await readAccessLog({ entityKey: ENTITY_KEY, signature, timestamp: now }, deps)

  assert.equal(result.ok, false)
  assert.equal(result.status, 403, "a signature made for a different action must not authorise the read")
  assert.ok(!read, "an unauthorised read must never touch the stored record")
  console.log("PASS  a signature made for another action does not authorise the read")
}

// --- a record-write failure still serves the share ------------------------------
{
  const now = Math.floor(Date.now() / 1000)
  const { authKey, commitment } = await validAuthKey()
  const grant = { sender: sender.address, authCommitment: commitment, expiresAt: now + 3600 }
  const stored = { share: "held-share", commitment }
  const deps = {
    getGrant: async () => grant,
    getShare: async () => stored,
    recordAccess: async () => {
      throw new Error("Redis is down")
    },
  }

  const result = await resolveUnlock(ENTITY_KEY, authKey, deps)

  assert.equal(result.ok, true, "a bookkeeping failure must not fail the unlock")
  assert.equal(result.share, "held-share")
  console.log("PASS  a record-write failure still serves the share")
}

console.log("\nAll checks passed.")
