/**
 * "When she looked" — the record of every unlock the holder actually served,
 * readable by the grant's sender alone.
 *
 * Authorisation reuses the signature scheme `lib/revoke.ts` established for
 * "End access now": the sender signs a domain-prefixed message binding the
 * entity key and a timestamp, we recover the signer, and compare it against
 * the grant's `sender` attribute read fresh from Arkiv. Same reasoning as
 * revoke — a signature proves control of the key at the moment it is made,
 * and a bearer secret would not.
 *
 * `readAccessLog` takes its Arkiv and holder access as injected dependencies
 * so `scripts/access-log-proof.mjs` can prove this offline, the same way
 * `scripts/revoke-proof.mjs` proves `lib/revoke.ts`.
 */

import { recoverSigner, signedMessage, validateSignedEntityRequest, type SignedEntityRequest } from "./revoke.ts"

export { validateSignedEntityRequest as validateAccessLogRequest }
export type { SignedEntityRequest as AccessLogRequest }

/** The message the sender signs to read the log for one entity key. */
export function accessLogMessage(entityKey: string, timestamp: number): string {
  return signedMessage("access-log", entityKey, timestamp)
}

export type AccessLogDeps = {
  getGrant: (entityKey: string) => Promise<{ sender: string } | null>
  getAccessLog: (entityKey: string) => Promise<number[]>
}

export type AccessLogResult =
  | { ok: true; opened: number[] }
  | { ok: false; status: number; error: string }

export async function readAccessLog(
  req: SignedEntityRequest,
  deps: AccessLogDeps,
): Promise<AccessLogResult> {
  const recovered = await recoverSigner("access-log", req)
  if (!recovered.ok) return recovered

  let grant: { sender: string } | null
  try {
    grant = await deps.getGrant(req.entityKey)
  } catch (error) {
    return { ok: false, status: 503, error: `Could not reach Arkiv: ${(error as Error).message}` }
  }

  // No live grant: there is no sender attribute left to authorise against,
  // and the log's own TTL is pinned to the same expiry — so there is nothing
  // left to read either. Refuse rather than guess.
  if (!grant) {
    return { ok: false, status: 410, error: "This record is gone" }
  }

  if (!grant.sender || recovered.signer.toLowerCase() !== grant.sender.toLowerCase()) {
    return { ok: false, status: 403, error: "Not authorised to read this record" }
  }

  const opened = await deps.getAccessLog(req.entityKey)
  return { ok: true, opened }
}
