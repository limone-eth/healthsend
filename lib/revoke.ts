/**
 * "End access now" — the authorisation and deletion at the heart of it.
 *
 * The sender signs the entity key with the same Arkiv key that owns the
 * grant. The route recovers the signer from that signature and compares it
 * against the grant's `sender` attribute, read fresh from Arkiv. This is
 * deliberately not a bearer secret minted at create time: a bearer token
 * leaks into logs, browser history and screen shares, and anyone holding it
 * could end someone else's share. A signature proves control of the key at
 * the moment it is made, and proves nothing to whoever intercepts it later.
 *
 * Binding the entity key into the signed message stops a signature captured
 * for one grant from ending another. Binding the timestamp, and checking it
 * against a short window, stops a captured signature from being replayed
 * once that window has passed.
 *
 * `performRevoke` takes its Arkiv and holder access as injected dependencies
 * so `scripts/revoke-proof.mjs` can prove the authorisation logic offline,
 * without Redis or a chain — see that script for the property under test.
 */

import { recoverMessageAddress, type Hex } from "viem"

/** How long a signature stays valid after the timestamp it was made over. */
export const REVOKE_SIGNATURE_WINDOW_SECONDS = 5 * 60

const ENTITY_KEY_RE = /^0x[0-9a-fA-F]{64}$/
const SIGNATURE_RE = /^0x[0-9a-fA-F]{130}$/

/**
 * The domain-prefixed, timestamp-bound message any sender-authorised action
 * signs. `action` separates the namespaces — a signature captured for one
 * action (say, the access-log read) must not verify for another (ending the
 * share), even over the same entity key and timestamp.
 */
export function signedMessage(action: string, entityKey: string, timestamp: number): string {
  return `healthsend:${action}:${entityKey.toLowerCase()}:${timestamp}`
}

export function revokeMessage(entityKey: string, timestamp: number): string {
  return signedMessage("revoke", entityKey, timestamp)
}

export function isFreshRevokeTimestamp(
  timestamp: number,
  now: number = Math.floor(Date.now() / 1000),
): boolean {
  return Number.isFinite(timestamp) && Math.abs(now - timestamp) <= REVOKE_SIGNATURE_WINDOW_SECONDS
}

export type RevokeRequest = { entityKey: string; signature: string; timestamp: number }

/** Same shape, reused wherever else a sender proves control of a grant's key. */
export type SignedEntityRequest = RevokeRequest

/**
 * Shape and format only. This runs before any network access, so a missing
 * or badly-shaped signature is refused without ever asking Arkiv.
 */
export function validateRevokeRequest(body: unknown): RevokeRequest | null {
  if (!body || typeof body !== "object") return null
  const { entityKey, signature, timestamp } = body as Record<string, unknown>
  if (typeof entityKey !== "string" || !ENTITY_KEY_RE.test(entityKey)) return null
  if (typeof signature !== "string" || !SIGNATURE_RE.test(signature)) return null
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) return null
  return { entityKey: entityKey.toLowerCase(), signature, timestamp }
}

/** Same request shape as revoke — entityKey + signature + timestamp — reused by any other signed read. */
export const validateSignedEntityRequest = validateRevokeRequest

export type SignerResult = { ok: true; signer: string } | { ok: false; status: number; error: string }

/**
 * Recover the signer of a domain-prefixed, timestamp-bound message and check
 * the timestamp is fresh. Does not check the signer against a grant's
 * `sender` — callers own that comparison, since what counts as authorised
 * differs by action (ending a share vs. reading its access log).
 */
export async function recoverSigner(action: string, req: SignedEntityRequest): Promise<SignerResult> {
  if (!isFreshRevokeTimestamp(req.timestamp)) {
    return { ok: false, status: 401, error: "Signature has expired" }
  }
  try {
    const signer = await recoverMessageAddress({
      message: signedMessage(action, req.entityKey, req.timestamp),
      signature: req.signature as Hex,
    })
    return { ok: true, signer }
  } catch {
    return { ok: false, status: 400, error: "Invalid signature" }
  }
}

export type RevokeDeps = {
  getGrant: (entityKey: string) => Promise<{ sender: string } | null>
  deleteShare: (entityKey: string) => Promise<void>
}

export type RevokeResult = { ok: true } | { ok: false; status: number; error: string }

export async function performRevoke(req: RevokeRequest, deps: RevokeDeps): Promise<RevokeResult> {
  if (!isFreshRevokeTimestamp(req.timestamp)) {
    return { ok: false, status: 401, error: "Signature has expired" }
  }

  let grant: { sender: string } | null
  try {
    grant = await deps.getGrant(req.entityKey)
  } catch (error) {
    return { ok: false, status: 503, error: `Could not reach Arkiv: ${(error as Error).message}` }
  }

  // No live grant: nothing is readable regardless of the share, because the
  // holder asks Arkiv before it serves. The access has genuinely ended, so say
  // so — but do NOT delete here.
  //
  // There is no owner to check a signature against without a grant, so this
  // branch is reachable unauthenticated by anyone holding the entity key. The
  // deletion it would perform buys at most an hour of earlier cleanup on a row
  // that is already inert and already carries its own TTL. Against that: it
  // would make an unauthenticated mutation depend on `isNotFound` in
  // lib/arkiv.ts never misclassifying a transport failure as a not-found, and
  // that check matches on error message substrings. Keeping the mutation behind
  // a signature means that heuristic can only ever cost a misleading status,
  // never a deletion.
  if (!grant) {
    return { ok: true }
  }

  const recovered = await recoverSigner("revoke", req)
  if (!recovered.ok) return recovered

  if (!grant.sender || recovered.signer.toLowerCase() !== grant.sender.toLowerCase()) {
    return { ok: false, status: 403, error: "Not authorised to end this grant" }
  }

  // Idempotent: deleting an already-deleted key is not an error, so a second
  // revoke from the rightful owner still reports the share ended.
  await deps.deleteShare(req.entityKey)
  return { ok: true }
}
