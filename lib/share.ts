/**
 * Authenticate "hand the key share to the holder" — the write `createSend`
 * performs immediately after writing the grant.
 *
 * Reuses the signature scheme `lib/revoke.ts` established: the sender signs a
 * domain-prefixed message binding the entity key and a timestamp, we recover
 * the signer, and compare it against the grant's `sender` attribute read
 * fresh from Arkiv. The action string is "share" — distinct from "revoke" and
 * "access-log" — so a signature captured for one action can never authorise
 * another, even over the same entity key and timestamp.
 *
 * `performShare` takes its Arkiv and holder access as injected dependencies
 * so `scripts/revoke-proof.mjs` can prove it offline, the same way it already
 * proves `performRevoke` and `resolveUnlock`.
 */

import {
  recoverMessageSigner,
  signedMessage,
  validateSignedEntityRequest,
  type SignedEntityRequest,
} from "./revoke.ts"

export type SharePayload = {
  share: string
  commitment: string
  ttlSeconds: number
  /** H-7: the verifier for this share's code, if it has one. Bound into the signature like everything else here. */
  codeHash?: string
}

/** The message the sender signs to store one exact share payload. */
export function shareMessage(
  entityKey: string,
  timestamp: number,
  { share, commitment, ttlSeconds, codeHash }: SharePayload,
): string {
  const payload = JSON.stringify([share, commitment, ttlSeconds, codeHash ?? ""])
  return `${signedMessage("share", entityKey, timestamp)}:${payload}`
}

export type ShareRequest = SignedEntityRequest & SharePayload

const COMMITMENT_RE = /^[0-9a-f]{64}$/

/**
 * Shape only, same as revoke — the signature is verified only once Arkiv is
 * asked, so a badly-shaped request is refused before any network access.
 */
export function validateShareRequest(body: unknown): ShareRequest | null {
  const base = validateSignedEntityRequest(body)
  if (!base) return null
  if (!body || typeof body !== "object") return null
  const { share, commitment, ttlSeconds, codeHash } = body as Record<string, unknown>
  if (typeof share !== "string" || share.length === 0) return null
  if (typeof commitment !== "string" || !COMMITMENT_RE.test(commitment)) return null
  if (typeof ttlSeconds !== "number" || !Number.isFinite(ttlSeconds) || ttlSeconds <= 0) return null
  if (codeHash !== undefined && (typeof codeHash !== "string" || !COMMITMENT_RE.test(codeHash))) return null
  return { ...base, share, commitment, ttlSeconds, ...(codeHash !== undefined ? { codeHash } : {}) }
}

export type ShareDeps = {
  getGrant: (entityKey: string) => Promise<{ sender: string } | null>
  putShare: (
    entityKey: string,
    value: { share: string; commitment: string },
    ttlSeconds: number,
    codeHash?: string,
  ) => Promise<boolean>
}

export type ShareResult = { ok: true } | { ok: false; status: number; error: string }

export async function performShare(req: ShareRequest, deps: ShareDeps): Promise<ShareResult> {
  const recovered = await recoverMessageSigner(
    shareMessage(req.entityKey, req.timestamp, req),
    req,
  )
  if (!recovered.ok) return recovered

  let grant: { sender: string } | null
  try {
    grant = await deps.getGrant(req.entityKey)
  } catch (error) {
    return { ok: false, status: 503, error: `Could not reach Arkiv: ${(error as Error).message}` }
  }

  // No live grant: there is no sender attribute to authorise against, and
  // nothing left to hand a share to either.
  if (!grant) {
    return { ok: false, status: 410, error: "No live grant for this entity" }
  }

  if (!grant.sender || recovered.signer.toLowerCase() !== grant.sender.toLowerCase()) {
    return { ok: false, status: 403, error: "Not authorised to store a share for this grant" }
  }

  // Refuses a second write for a live entity, and any write at all for a
  // tombstoned one — see `putShare` in lib/holder-store.ts. The code guard, if
  // this share carries one, lands in the same call.
  const stored = await deps.putShare(
    req.entityKey,
    { share: req.share, commitment: req.commitment },
    req.ttlSeconds,
    req.codeHash,
  )
  if (!stored) {
    return { ok: false, status: 409, error: "A share already exists for this grant" }
  }
  return { ok: true }
}
