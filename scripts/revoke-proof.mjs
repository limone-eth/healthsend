/**
 * Proves "End access now" offline: no Redis, no chain, no network.
 *
 *   performRevoke(request, { getGrant, deleteShare })  — lib/revoke.ts
 *   resolveUnlock(entityKey, authKey, { getGrant, getShare })  — lib/unlock.ts
 *
 * Both take their Arkiv and holder access as injected dependencies, so the
 * property under test here is the signature check and the status codes it
 * produces — not Redis or the RPC.
 */
import assert from "node:assert/strict"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"

const { performRevoke, validateRevokeRequest, revokeMessage, isFreshRevokeTimestamp, REVOKE_SIGNATURE_WINDOW_SECONDS } =
  await import("../lib/revoke.ts")
const { resolveUnlock } = await import("../lib/unlock.ts")

const ENTITY_KEY = "0x" + "11".repeat(32)
const AUTH_COMMITMENT = "c".repeat(64)

const sender = privateKeyToAccount(generatePrivateKey())
const attacker = privateKeyToAccount(generatePrivateKey())

const grant = () => ({ sender: sender.address, authCommitment: AUTH_COMMITMENT });

// --- a valid signature is accepted ------------------------------------------
{
  const now = Math.floor(Date.now() / 1000)
  let deleted = false
  const deps = { getGrant: async () => grant(), deleteShare: async () => { deleted = true } }

  const signature = await sender.signMessage({ message: revokeMessage(ENTITY_KEY, now) })
  const result = await performRevoke({ entityKey: ENTITY_KEY, signature, timestamp: now }, deps)

  assert.equal(result.ok, true, "a valid signature from the sender's key must be accepted")
  assert.ok(deleted, "the share must be deleted on a valid revoke")
  console.log("PASS  a valid signature from the sender's key is accepted")
}

// --- a signature from a different key is rejected ---------------------------
{
  const now = Math.floor(Date.now() / 1000)
  let deleted = false
  const deps = { getGrant: async () => grant(), deleteShare: async () => { deleted = true } }

  const signature = await attacker.signMessage({ message: revokeMessage(ENTITY_KEY, now) })
  const result = await performRevoke({ entityKey: ENTITY_KEY, signature, timestamp: now }, deps)

  assert.equal(result.ok, false)
  assert.equal(result.status, 403)
  assert.ok(!deleted, "a signature from any other key must not delete the share")
  console.log("PASS  a signature from a different key is rejected, and the share survives")
}

// --- a malformed or missing signature is rejected ----------------------------
{
  const now = Math.floor(Date.now() / 1000)

  // Missing entirely.
  assert.equal(
    validateRevokeRequest({ entityKey: ENTITY_KEY, timestamp: now }),
    null,
    "a missing signature must be refused",
  )

  // Wrong shape — not even hex of the right length.
  assert.equal(
    validateRevokeRequest({ entityKey: ENTITY_KEY, signature: "0xnothex", timestamp: now }),
    null,
    "a badly-shaped signature must be refused before it reaches Arkiv",
  )

  // Right shape at the HTTP boundary, but not a real signature.
  const garbage = "0x" + "00".repeat(65)
  const parsed = validateRevokeRequest({ entityKey: ENTITY_KEY, signature: garbage, timestamp: now })
  assert.ok(parsed, "well-formed hex passes shape validation, so this exercises the recovery check")

  let deleted = false
  const deps = { getGrant: async () => grant(), deleteShare: async () => { deleted = true } }
  const result = await performRevoke(parsed, deps)
  assert.equal(result.ok, false)
  assert.ok(!deleted, "a malformed signature must not delete the share")
  console.log("PASS  a malformed or missing signature is rejected, and the share survives")
}

// --- a replayed (stale) signature is rejected --------------------------------
{
  const stale = Math.floor(Date.now() / 1000) - REVOKE_SIGNATURE_WINDOW_SECONDS - 60
  assert.equal(isFreshRevokeTimestamp(stale), false)

  let deleted = false
  const deps = { getGrant: async () => grant(), deleteShare: async () => { deleted = true } }

  // A real signature from the real sender — captured once, replayed late.
  const signature = await sender.signMessage({ message: revokeMessage(ENTITY_KEY, stale) })
  const result = await performRevoke({ entityKey: ENTITY_KEY, signature, timestamp: stale }, deps)

  assert.equal(result.ok, false)
  assert.equal(result.status, 401)
  assert.ok(!deleted, "a stale, replayed signature must not end the share")
  console.log("PASS  a replayed (stale) signature is rejected")
}

// --- a revoked entity reports ended, not unavailable -------------------------
{
  const now = Math.floor(Date.now() / 1000)
  let stored = { share: "held-share", commitment: AUTH_COMMITMENT }
  const revokeDeps = { getGrant: async () => grant(), deleteShare: async () => { stored = null } }

  const signature = await sender.signMessage({ message: revokeMessage(ENTITY_KEY, now) })
  const revoked = await performRevoke({ entityKey: ENTITY_KEY, signature, timestamp: now }, revokeDeps)
  assert.equal(revoked.ok, true)

  // Same grant, still live — only the share is gone, exactly the state a
  // revoke leaves behind. This must read as "expired" (410), not a 5xx.
  const unlockDeps = { getGrant: async () => grant(), getShare: async () => stored }
  const opened = await resolveUnlock(ENTITY_KEY, "irrelevant-once-the-share-is-gone", unlockDeps)

  assert.equal(opened.ok, false)
  assert.equal(opened.status, 410, "a revoked share must read as ended (410), not unavailable")
  assert.equal(opened.error, "expired")
  console.log("PASS  a revoked entity reports ended (410), not unavailable")
}

// --- a double revoke is not an error -----------------------------------------
{
  const now = Math.floor(Date.now() / 1000)
  let deletions = 0
  const deps = { getGrant: async () => grant(), deleteShare: async () => { deletions++ } }

  const first = await performRevoke(
    { entityKey: ENTITY_KEY, signature: await sender.signMessage({ message: revokeMessage(ENTITY_KEY, now) }), timestamp: now },
    deps,
  )
  const later = now + 1
  const second = await performRevoke(
    { entityKey: ENTITY_KEY, signature: await sender.signMessage({ message: revokeMessage(ENTITY_KEY, later) }), timestamp: later },
    deps,
  )

  assert.equal(first.ok, true)
  assert.equal(second.ok, true, "revoking twice must not be an error")
  assert.equal(deletions, 2, "the second call still finds nothing to delete, and still reports ended")
  console.log("PASS  revoking twice is not an error")
}

{
  // Hardening: the no-grant branch is reachable without any signature, because
  // there is no owner to check one against. It must therefore not mutate.
  let deleted = false
  const result = await performRevoke(
    { entityKey: `0x${"ab".repeat(32)}`, signature: `0x${"cd".repeat(65)}`, timestamp: Math.floor(Date.now() / 1000) },
    { getGrant: async () => null, deleteShare: async () => { deleted = true } },
  )
  assert.equal(result.ok, true, "with no live grant the access has ended, so report ok")
  assert.ok(!deleted, "an unauthenticated caller must not be able to delete anything")
  console.log("PASS  the unauthenticated no-grant path reports ended without deleting")
}

console.log("\nAll checks passed.")
