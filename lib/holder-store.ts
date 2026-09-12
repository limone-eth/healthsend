import { Redis } from "@upstash/redis"

/**
 * The key-share holder.
 *
 * This is the one place in HealthSend that can genuinely delete something, and
 * that is the entire reason it exists. Swarm and Arkiv are permissionless and
 * replicated: anything published to either is permanent, which is why a wrapped
 * key put on-chain never expires no matter what the entity does.
 *
 * So this store holds the half of the content key that is never published:
 * 32 random-looking bytes per send, keyed by a *public* entity key. It holds no
 * identities, no filenames, no documents, and no link to a person — and it
 * cannot read anything it guards, because the other half only ever exists in a
 * URL fragment that never leaves the recipient's browser.
 *
 * Two independent things end a send, and they are deliberately not the same
 * mechanism:
 *
 *   1. Arkiv expires the grant. The holder asks the chain before serving, so
 *      refusal is driven by an authority we do not own and anyone can check.
 *   2. The TTL below deletes the share outright, so a later compromise of this
 *      store finds nothing.
 *
 * The TTL deliberately outlasts the grant. If it fired first, access would end
 * before the window the sender was shown — which is the failure mode that must
 * never be mistaken for expiry.
 */

const TTL_GRACE_SECONDS = 60 * 60

let client: Redis | null = null

export function holderConfigured(): boolean {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN)
}

function redis(): Redis {
  if (!client) {
    client = new Redis({
      url: process.env.KV_REST_API_URL!,
      token: process.env.KV_REST_API_TOKEN!,
    })
  }
  return client
}

const key = (entityKey: string) => `healthsend:share:${entityKey.toLowerCase()}`
const accessLogKey = (entityKey: string) => `healthsend:access:${entityKey.toLowerCase()}`

export type StoredShare = {
  /** The holder's half of the content key, base64url. */
  share: string
  /** SHA-256 of the auth key, hex. Mirrors the commitment in the Arkiv entity. */
  commitment: string
}

/**
 * Write once, never overwrite.
 *
 * `nx` matters: without it anyone could POST a new share for an existing entity
 * key and lock the real recipient out, or worse, swap in a share of their own.
 */
export async function putShare(
  entityKey: string,
  value: StoredShare,
  ttlSeconds: number,
): Promise<boolean> {
  const result = await redis().set(key(entityKey), JSON.stringify(value), {
    nx: true,
    ex: Math.max(60, Math.floor(ttlSeconds) + TTL_GRACE_SECONDS),
  })
  return result === "OK"
}

export async function getShare(entityKey: string): Promise<StoredShare | null> {
  const raw = await redis().get<StoredShare | string>(key(entityKey))
  if (!raw) return null
  return typeof raw === "string" ? (JSON.parse(raw) as StoredShare) : raw
}

/** Used when a sender ends a send early. Expiry does not need this. */
export async function deleteShare(entityKey: string): Promise<void> {
  // The access log is part of the same arrangement as the share, not a
  // separate record of the recipient's reading habits — see lib/access-log.ts.
  // Ending the share early ends it too.
  await Promise.all([redis().del(key(entityKey)), redis().del(accessLogKey(entityKey))])
}

/**
 * Record one served unlock. Called only after the holder has actually handed
 * back the share — see `resolveUnlock` in lib/unlock.ts, which swallows any
 * error this throws so a bookkeeping failure can never turn a served share
 * into a failed one.
 *
 * The log's TTL is pinned to the grant's own expiry, the same way the share's
 * TTL is: the record lives only as long as the arrangement it describes.
 */
export async function recordAccess(entityKey: string, at: number, expiresAt: number): Promise<void> {
  const k = accessLogKey(entityKey)
  const ttlSeconds = Math.max(60, Math.ceil(expiresAt - at) + TTL_GRACE_SECONDS)
  await redis().rpush(k, at)
  await redis().expire(k, ttlSeconds)
}

/** Every timestamp the holder has recorded for this entity key, oldest first. */
export async function getAccessLog(entityKey: string): Promise<number[]> {
  const raw = await redis().lrange<number>(accessLogKey(entityKey), 0, -1)
  return raw.map(Number)
}
