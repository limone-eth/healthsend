/**
 * Hand back the holder's half — but only while Arkiv says the grant is live.
 *
 * This is the point of the whole architecture, so it is worth being explicit
 * about what it does and does not decide.
 *
 * It does **not** keep its own timer. It asks Arkiv whether the grant entity
 * still exists, and Arkiv's answer is not ours to give: grants are `ownedBy` the
 * sender's key, so we cannot forge one, backdate one, or quietly un-expire one,
 * and the recipient can verify the same fact from the same public chain. The
 * holder has the *means* to complete a key and no *authority* over whether it
 * should; Arkiv has the authority and holds no secret. A gatekeeper needs both.
 *
 * The caller proves it holds the link by sending an auth key derived from the
 * URL fragment. We compare its hash against the commitment written into the
 * grant, in constant time so a wrong guess leaks nothing through timing.
 * Learning that value gains us nothing: the decryption half is derived
 * separately and never leaves the recipient's browser.
 *
 * A revoked share (see `lib/revoke.ts`) reaches this function through the
 * ordinary path: the grant is still live, but the share is gone, so it falls
 * out of the same `!stored` branch that an expired share does — 410 either
 * way, and the copy shown to the reader does not change. But the two are not
 * quite the same fact underneath: a `revoked` flag rides along on the result
 * so a caller that needs to tell them apart — H-35's copy on the open-link
 * page — can, without this function deciding how that gets shown.
 *
 * Every unlock actually served is recorded — see `lib/access-log.ts` for who
 * gets to read that record back. The recording happens after every check
 * above has passed, once and only once, and its own failure is swallowed:
 * bookkeeping must never be able to turn a served share into a failed one.
 */

import type { Grant } from "./arkiv"
import type { StoredShare } from "./holder-store"

function sha256Hex(input: Uint8Array): Promise<string> {
  return crypto.subtle
    .digest("SHA-256", input as BufferSource)
    .then((d) =>
      Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join(""),
    )
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/")
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="))
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}

/** Constant-time compare, so a wrong guess leaks nothing through timing. */
function equal(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export type UnlockDeps = {
  getGrant: (entityKey: string) => Promise<Grant | null>
  getShare: (entityKey: string) => Promise<StoredShare | null>
  recordAccess: (entityKey: string, at: number, expiresAt: number) => Promise<void>
  /** Consulted only once the share is already missing, to tell a revoke apart from a lapsed grant. */
  isRevoked?: (entityKey: string) => Promise<boolean>
}

export type UnlockResult =
  | { ok: true; share: string; expiresAt: number }
  | { ok: false; status: number; error: string; retryable?: boolean; revoked?: boolean }

/** A missing share, either because the grant lapsed or because it was revoked. */
async function noShare(entityKey: string, deps: UnlockDeps): Promise<UnlockResult> {
  let revoked = false
  if (deps.isRevoked) {
    try {
      revoked = await deps.isRevoked(entityKey)
    } catch {
      // Could not tell — default to "not revoked" rather than claim a fact we don't have.
    }
  }
  return { ok: false, status: 410, error: "expired", revoked }
}

export async function resolveUnlock(
  entityKey: string,
  authKey: string,
  deps: UnlockDeps,
): Promise<UnlockResult> {
  // 1. Ask Arkiv. A missing grant is expiry, and it is the end of the matter.
  //
  // No internal timer: we ask Arkiv whether the grant is live every time,
  // rather than keeping our own clock for it — see the file header.
  let grant: Grant | null
  try {
    grant = await deps.getGrant(entityKey)
  } catch (error) {
    // We could not reach the chain, so we cannot tell. Saying "expired" here
    // would assert something we do not know.
    return {
      ok: false,
      status: 503,
      error: `Could not reach Arkiv: ${(error as Error).message}`,
      retryable: true,
    }
  }
  // A lapsed grant is never a revoke — there would be nothing left to
  // tombstone once Arkiv itself has expired the entity.
  if (!grant) return { ok: false, status: 410, error: "expired", revoked: false }

  // 2. The share may outlive the grant by its grace period, or be gone
  // because the sender ended it early. Either way, Arkiv still decides
  // whether the grant is live; this only decides whether we have a share.
  let stored = await deps.getShare(entityKey)
  if (!stored) return noShare(entityKey, deps)

  // 3. Prove the caller holds the link, against the commitment Arkiv itself
  // carries — the authoritative copy, not this store's own record of it.
  // Constant-time, so a wrong guess leaks nothing through timing.
  let presented: string
  try {
    presented = await sha256Hex(fromBase64Url(authKey))
  } catch {
    return { ok: false, status: 400, error: "Invalid auth key" }
  }
  if (!equal(presented, grant.authCommitment) || !equal(stored.commitment, grant.authCommitment)) {
    return { ok: false, status: 403, error: "Not authorised for this grant" }
  }

  // 4. Re-check, right before anything is handed back. Step 2 read the share
  // once; a revoke can complete between that read and this line, and an
  // unlock that trusted its first read would hand back a share the sender
  // had already ended. Re-reading closes that window instead of widening it
  // with a timer or a lock this store does not have.
  stored = await deps.getShare(entityKey)
  if (!stored) return noShare(entityKey, deps)

  // 5. Served. Record it — never allowed to fail the unlock itself.
  try {
    await deps.recordAccess(entityKey, Math.floor(Date.now() / 1000), grant.expiresAt)
  } catch {
    // Swallow: the reader's access does not depend on our bookkeeping.
  }

  return { ok: true, share: stored.share, expiresAt: grant.expiresAt }
}
