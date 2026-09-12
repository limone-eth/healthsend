/**
 * Proves "End access now" offline: no Redis, no chain, no network.
 *
 *   performRevoke(request, { getGrant, tombstoneShare })  — lib/revoke.ts
 *   resolveUnlock(entityKey, authKey, { getGrant, getShare, serveShare })  — lib/unlock.ts
 *   performShare(request, { getGrant, putShare })  — lib/share.ts
 *
 * All three take their Arkiv and holder access as injected dependencies, so
 * the property under test here is the signature checks, the permanence of a
 * revoke, and the read/return race — not Redis or the RPC.
 */
import assert from "node:assert/strict"
import { webcrypto } from "node:crypto"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"

const {
  performRevoke,
  validateRevokeRequest,
  revokeMessage,
  signedMessage,
  isFreshRevokeTimestamp,
  REVOKE_SIGNATURE_WINDOW_SECONDS,
} = await import("../lib/revoke.ts")
const { resolveUnlock } = await import("../lib/unlock.ts")
const { performShare, validateShareRequest, shareMessage } = await import("../lib/share.ts")

const ENTITY_KEY = "0x" + "11".repeat(32)
const AUTH_COMMITMENT = "c".repeat(64)

const sender = privateKeyToAccount(generatePrivateKey())
const attacker = privateKeyToAccount(generatePrivateKey())

const grant = () => ({
  sender: sender.address,
  authCommitment: AUTH_COMMITMENT,
  expiresAt: Math.floor(Date.now() / 1000) + 3600,
})

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

/** A tiny in-memory stand-in for lib/holder-store.ts, just enough to prove the tombstone. */
function fakeHolder() {
  let share = null
  let tombstoned = false
  return {
    async putShare(_entityKey, value) {
      if (tombstoned) return false
      if (share) return false
      share = value
      return true
    },
    async tombstoneShare() {
      share = null
      tombstoned = true
    },
    async getShare() {
      return share
    },
  }
}

// --- a valid signature is accepted ------------------------------------------
{
  const now = Math.floor(Date.now() / 1000)
  let tombstoned = false
  const deps = { getGrant: async () => grant(), tombstoneShare: async () => { tombstoned = true } }

  const signature = await sender.signMessage({ message: revokeMessage(ENTITY_KEY, now) })
  const result = await performRevoke({ entityKey: ENTITY_KEY, signature, timestamp: now }, deps)

  assert.equal(result.ok, true, "a valid signature from the sender's key must be accepted")
  assert.ok(tombstoned, "the share must be tombstoned on a valid revoke")
  console.log("PASS  a valid signature from the sender's key is accepted")
}

// --- a signature from a different key is rejected ---------------------------
{
  const now = Math.floor(Date.now() / 1000)
  let tombstoned = false
  const deps = { getGrant: async () => grant(), tombstoneShare: async () => { tombstoned = true } }

  const signature = await attacker.signMessage({ message: revokeMessage(ENTITY_KEY, now) })
  const result = await performRevoke({ entityKey: ENTITY_KEY, signature, timestamp: now }, deps)

  assert.equal(result.ok, false)
  assert.equal(result.status, 403)
  assert.ok(!tombstoned, "a signature from any other key must not tombstone the share")
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

  let tombstoned = false
  const deps = { getGrant: async () => grant(), tombstoneShare: async () => { tombstoned = true } }
  const result = await performRevoke(parsed, deps)
  assert.equal(result.ok, false)
  assert.ok(!tombstoned, "a malformed signature must not tombstone the share")
  console.log("PASS  a malformed or missing signature is rejected, and the share survives")
}

// --- a replayed (stale) signature is rejected --------------------------------
{
  const stale = Math.floor(Date.now() / 1000) - REVOKE_SIGNATURE_WINDOW_SECONDS - 60
  assert.equal(isFreshRevokeTimestamp(stale), false)

  let tombstoned = false
  const deps = { getGrant: async () => grant(), tombstoneShare: async () => { tombstoned = true } }

  // A real signature from the real sender — captured once, replayed late.
  const signature = await sender.signMessage({ message: revokeMessage(ENTITY_KEY, stale) })
  const result = await performRevoke({ entityKey: ENTITY_KEY, signature, timestamp: stale }, deps)

  assert.equal(result.ok, false)
  assert.equal(result.status, 401)
  assert.ok(!tombstoned, "a stale, replayed signature must not end the share")
  console.log("PASS  a replayed (stale) signature is rejected")
}

// --- a revoked entity reports ended, not unavailable -------------------------
{
  const now = Math.floor(Date.now() / 1000)
  let stored = { share: "held-share", commitment: AUTH_COMMITMENT }
  const revokeDeps = { getGrant: async () => grant(), tombstoneShare: async () => { stored = null } }

  const signature = await sender.signMessage({ message: revokeMessage(ENTITY_KEY, now) })
  const revoked = await performRevoke({ entityKey: ENTITY_KEY, signature, timestamp: now }, revokeDeps)
  assert.equal(revoked.ok, true)

  // Same grant, still live — only the share is gone, exactly the state a
  // revoke leaves behind. This must read as "expired" (410), not a 5xx.
  const unlockDeps = { getGrant: async () => grant(), getShare: async () => stored, serveShare: async () => stored }
  const opened = await resolveUnlock(ENTITY_KEY, "irrelevant-once-the-share-is-gone", unlockDeps)

  assert.equal(opened.ok, false)
  assert.equal(opened.status, 410, "a revoked share must read as ended (410), not unavailable")
  assert.equal(opened.error, "expired")
  console.log("PASS  a revoked entity reports ended (410), not unavailable")
}

// --- a double revoke is not an error -----------------------------------------
{
  const now = Math.floor(Date.now() / 1000)
  let tombstones = 0
  const deps = { getGrant: async () => grant(), tombstoneShare: async () => { tombstones++ } }

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
  assert.equal(tombstones, 2, "the second call still finds nothing to delete, and still reports ended")
  console.log("PASS  revoking twice is not an error")
}

{
  // Hardening: the no-grant branch is reachable without any signature, because
  // there is no owner to check one against. It must therefore not mutate.
  let tombstoned = false
  const result = await performRevoke(
    { entityKey: `0x${"ab".repeat(32)}`, signature: `0x${"cd".repeat(65)}`, timestamp: Math.floor(Date.now() / 1000) },
    { getGrant: async () => null, tombstoneShare: async () => { tombstoned = true } },
  )
  assert.equal(result.ok, true, "with no live grant the access has ended, so report ok")
  assert.ok(!tombstoned, "an unauthenticated caller must not be able to delete anything")
  console.log("PASS  the unauthenticated no-grant path reports ended without deleting")
}

// --- revocation is permanent: a re-POST of the saved share does not restore access ---
{
  const now = Math.floor(Date.now() / 1000)
  const { authKey, commitment } = await validAuthKey()
  const g = { sender: sender.address, authCommitment: commitment, expiresAt: now + 3600 }
  const holder = fakeHolder()

  // The legitimate first write, exactly as createSend performs it once the
  // grant exists.
  const firstWrite = await performShare(
    {
      entityKey: ENTITY_KEY,
      signature: await sender.signMessage({
        message: shareMessage(ENTITY_KEY, now, { share: "held-share", commitment, ttlSeconds: 3600 }),
      }),
      timestamp: now,
      share: "held-share",
      commitment,
      ttlSeconds: 3600,
    },
    { getGrant: async () => g, putShare: holder.putShare },
  )
  assert.equal(firstWrite.ok, true, "the legitimate first write must succeed")

  // This is exactly what the recipient's browser received back from unlock.
  const savedShare = await holder.getShare(ENTITY_KEY)
  assert.ok(savedShare, "the recipient must have a copy of the share to attempt a replay with")

  // The sender ends access.
  const revoked = await performRevoke(
    {
      entityKey: ENTITY_KEY,
      signature: await sender.signMessage({ message: revokeMessage(ENTITY_KEY, now + 1) }),
      timestamp: now + 1,
    },
    { getGrant: async () => g, tombstoneShare: holder.tombstoneShare },
  )
  assert.equal(revoked.ok, true)

  // The recipient — or anyone, even the rightful sender — re-POSTs the exact
  // share that was saved before the revoke.
  const replay = await performShare(
    {
      entityKey: ENTITY_KEY,
      signature: await sender.signMessage({
        message: shareMessage(ENTITY_KEY, now + 2, {
          share: savedShare.share,
          commitment: savedShare.commitment,
          ttlSeconds: 3600,
        }),
      }),
      timestamp: now + 2,
      share: savedShare.share,
      commitment: savedShare.commitment,
      ttlSeconds: 3600,
    },
    { getGrant: async () => g, putShare: holder.putShare },
  )
  assert.equal(replay.ok, false, "a re-POST of a revoked share must be refused, even from the sender")

  // And the link genuinely does not open.
  const opened = await resolveUnlock(ENTITY_KEY, authKey, {
    getGrant: async () => g,
    getShare: holder.getShare,
    serveShare: holder.getShare,
  })
  assert.equal(opened.ok, false)
  assert.equal(opened.status, 410, "the link must not open after the replayed share was refused")
  console.log("PASS  revocation is permanent: a re-POST of the saved share does not restore access")
}

// --- an unlock paused after its read must not return a share revoked in between ---
{
  const now = Math.floor(Date.now() / 1000)
  const { authKey, commitment } = await validAuthKey()
  const g = { sender: sender.address, authCommitment: commitment, expiresAt: now + 3600 }
  let stored = { share: "held-share", commitment }
  let calls = 0

  const unlockDeps = {
    getGrant: async () => g,
    // The preliminary read captures a value for the commitment check. A revoke
    // then completes underneath it before the final atomic serve.
    getShare: async () => {
      calls++
      const before = stored
      await performRevoke(
        {
          entityKey: ENTITY_KEY,
          signature: await sender.signMessage({ message: revokeMessage(ENTITY_KEY, now) }),
          timestamp: now,
        },
        { getGrant: async () => g, tombstoneShare: async () => { stored = null } },
      )
      return before
    },
    serveShare: async () => {
      calls++
      return stored
    },
  }

  const result = await resolveUnlock(ENTITY_KEY, authKey, unlockDeps)

  assert.equal(result.ok, false, "a share revoked after the unlock's own read must not be served")
  assert.equal(result.status, 410)
  assert.ok(calls >= 2, "the unlock must check again before returning, not trust its first read")
  console.log("PASS  an unlock paused after its read does not return a share revoked in between")
}

// --- an unlock paused in its final serve cannot outlive a completed revoke ----
{
  const now = Math.floor(Date.now() / 1000)
  const { authKey, commitment } = await validAuthKey()
  const g = { sender: sender.address, authCommitment: commitment, expiresAt: now + 3600 }
  let stored = { share: "held-share", commitment }
  let revoked = false

  const revoke = async () => {
    if (revoked) return
    revoked = true
    await performRevoke(
      {
        entityKey: ENTITY_KEY,
        signature: await sender.signMessage({ message: revokeMessage(ENTITY_KEY, now) }),
        timestamp: now,
      },
      { getGrant: async () => g, tombstoneShare: async () => { stored = null } },
    )
  }

  const result = await resolveUnlock(ENTITY_KEY, authKey, {
    getGrant: async () => g,
    getShare: async () => stored,
    serveShare: async () => {
      await revoke()
      return stored
    },
  })

  assert.equal(result.ok, false, "an unlock must not return a share after revoke succeeds")
  assert.equal(result.status, 410)
  console.log("PASS  an unlock paused in its final serve cannot outlive a completed revoke")
}

// --- a captured share signature cannot authorise an altered payload -----------
{
  const now = Math.floor(Date.now() / 1000)
  const original = {
    entityKey: ENTITY_KEY,
    share: "legitimate-share",
    commitment: "d".repeat(64),
    ttlSeconds: 3600,
  }
  const message = shareMessage(ENTITY_KEY, now, original)
  assert.ok(
    message.startsWith(`${signedMessage("share", ENTITY_KEY, now)}:`),
    "the payload-bound message must keep the share action namespace",
  )
  const signature = await sender.signMessage({ message })
  const alterations = [
    { label: "share", payload: { ...original, share: "attacker-selected-share" } },
    { label: "commitment", payload: { ...original, commitment: "e".repeat(64) } },
    { label: "requested TTL", payload: { ...original, ttlSeconds: 365 * 24 * 60 * 60 } },
    {
      label: "complete payload",
      payload: {
        ...original,
        share: "attacker-selected-share",
        commitment: "e".repeat(64),
        ttlSeconds: 365 * 24 * 60 * 60,
      },
    },
  ]

  for (const { label, payload } of alterations) {
    let stored = null
    const result = await performShare(
      { ...payload, signature, timestamp: now },
      {
        getGrant: async () => ({ sender: sender.address }),
        putShare: async (_entityKey, value, ttlSeconds) => {
          stored = { value, ttlSeconds }
          return true
        },
      },
    )

    assert.equal(result.ok, false, `the signature must bind the ${label}`)
    assert.equal(stored, null, `an altered ${label} must not consume the write-once slot`)
  }
  console.log("PASS  a captured share signature binds the action, share, commitment, and requested TTL")
}

// --- share POST: no signature, wrong signer, or a revoke-action signature is refused ---
{
  const now = Math.floor(Date.now() / 1000)
  const g = { sender: sender.address }
  const base = { entityKey: ENTITY_KEY, share: "held-share", commitment: "d".repeat(64), ttlSeconds: 3600 }

  // Missing signature entirely — shape validation must refuse it before Arkiv is asked.
  assert.equal(
    validateShareRequest({ ...base, timestamp: now }),
    null,
    "a missing signature must be refused",
  )

  // Wrong signer.
  {
    let stored = false
    const signature = await attacker.signMessage({ message: shareMessage(ENTITY_KEY, now, base) })
    const result = await performShare(
      { ...base, signature, timestamp: now },
      { getGrant: async () => g, putShare: async () => { stored = true; return true } },
    )
    assert.equal(result.ok, false)
    assert.equal(result.status, 403)
    assert.ok(!stored, "a signature from any other key must not store a share")
  }

  // A signature made for "revoke", not "share" — the domain prefix must stop it crossing over.
  {
    let stored = false
    const signature = await sender.signMessage({ message: revokeMessage(ENTITY_KEY, now) })
    const result = await performShare(
      { ...base, signature, timestamp: now },
      { getGrant: async () => g, putShare: async () => { stored = true; return true } },
    )
    assert.equal(result.ok, false)
    assert.ok(!stored, "a signature made for a different action must not authorise storing a share")
  }

  // Sanity: the same sender key, signed for "share", is accepted.
  {
    let stored = false
    const signature = await sender.signMessage({ message: shareMessage(ENTITY_KEY, now, base) })
    const result = await performShare(
      { ...base, signature, timestamp: now },
      { getGrant: async () => g, putShare: async () => { stored = true; return true } },
    )
    assert.equal(result.ok, true)
    assert.ok(stored, "the rightful sender's own 'share' signature must be accepted")
  }

  console.log("PASS  a share POST is refused without a signature, with the wrong signer, or with a signature made for another action")
}

// --- a signature made for another action cannot authorise a revoke either ---
{
  const now = Math.floor(Date.now() / 1000)
  let tombstoned = false
  const deps = { getGrant: async () => grant(), tombstoneShare: async () => { tombstoned = true } }

  const signature = await sender.signMessage({ message: signedMessage("share", ENTITY_KEY, now) })
  const result = await performRevoke({ entityKey: ENTITY_KEY, signature, timestamp: now }, deps)

  assert.equal(result.ok, false)
  assert.equal(result.status, 403, "a 'share' signature must not authorise a revoke")
  assert.ok(!tombstoned)
  console.log("PASS  a signature made for another action does not authorise a revoke")
}

// --- a signature captured for one entity key cannot end another --------------
{
  const now = Math.floor(Date.now() / 1000)
  const ENTITY_A = ENTITY_KEY
  const ENTITY_B = "0x" + "33".repeat(32)

  // Two live grants, same sender — the realistic case: a sender who legitimately
  // controls both entities, so a message-format bug (not a wrong-key bug) is the
  // only thing that could let one signature reach the other's storage.
  const grants = {
    [ENTITY_A]: { sender: sender.address, authCommitment: AUTH_COMMITMENT, expiresAt: now + 3600 },
    [ENTITY_B]: { sender: sender.address, authCommitment: AUTH_COMMITMENT, expiresAt: now + 3600 },
  }
  const tombstoned = []
  const deps = {
    getGrant: async (entityKey) => grants[entityKey.toLowerCase()] ?? null,
    tombstoneShare: async (entityKey) => { tombstoned.push(entityKey.toLowerCase()) },
  }

  // A real signature the sender made for entity A's revoke message...
  const signatureForA = await sender.signMessage({ message: revokeMessage(ENTITY_A, now) })

  // ...replayed against entity B, the sender's other live grant. The entity key
  // is baked into the signed message specifically to stop this.
  const crossed = await performRevoke({ entityKey: ENTITY_B, signature: signatureForA, timestamp: now }, deps)
  assert.equal(crossed.ok, false, "a signature captured for one entity must not end a different one")
  assert.equal(tombstoned.length, 0, "no entity's share may be deleted by another entity's signature")

  // The legitimate signature for A still only ever reaches A's storage — this
  // is what would catch `getGrant`/`tombstoneShare` being called with the wrong
  // key even while the authorisation check itself stayed correct.
  const legitimate = await performRevoke(
    { entityKey: ENTITY_A, signature: await sender.signMessage({ message: revokeMessage(ENTITY_A, now) }), timestamp: now },
    deps,
  )
  assert.equal(legitimate.ok, true)
  assert.deepEqual(
    tombstoned,
    [ENTITY_A.toLowerCase()],
    "the storage call must carry the entity key the caller actually authorised, not any other",
  )
  console.log("PASS  a signature captured for one entity key cannot end another")
}

console.log("\nAll checks passed.")
