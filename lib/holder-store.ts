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
 *
 * A third thing — a sender ending a send early, see `lib/revoke.ts` — does not
 * just delete the share. It leaves a tombstone behind under the same
 * grant-length TTL. Without it, the recipient still holds the exact bytes the
 * holder returned on unlock, and could POST them straight back through the
 * same write-once slot the legitimate send used, since an empty slot and a
 * slot that never existed look identical to `SET NX`. The tombstone is what
 * makes the deletion permanent rather than a one-step-behind race the
 * recipient can always win.
 *
 * ---
 *
 * **Every multi-key write here is one Lua script, not several round trips.**
 * `@upstash/redis` is an HTTP client: there is no `MULTI`/`EXEC` transaction,
 * and `.pipeline()` (`.multi()` is an alias for the same thing) is explicitly
 * documented as non-atomic — "commands sent by other clients can interleave
 * with the pipeline." The one primitive that *is* atomic is `EVAL`: the script
 * runs to completion on the Redis server as a single operation, so nothing
 * else can be interleaved between the commands inside it, and a failure to
 * reach the server (the only realistic way an `RPUSH` succeeds while the
 * following `EXPIRE` does not) now fails the whole call — either every effect
 * lands, or none of them do. That closes three separate bugs at once with one
 * mechanism:
 *
 *   - `recordAccess` used to `RPUSH` then `EXPIRE` as two calls, so a dropped
 *     second call left timestamps with no TTL at all.
 *   - `tombstoneShare` used to `del(share)`, `del(accessLog)`, `set(tombstone)`
 *     in a `Promise.all` — independent HTTP requests, not a bundle. A dropped
 *     tombstone write after the delete succeeded would free the slot with
 *     nothing marking it revoked, reopening the hole H-29 closed.
 *   - `putShare` used to read `isRevoked` and then `SET NX` as two calls, so a
 *     revoke landing in the gap between them could let a write through.
 *
 * All three now go through `eval()`. See `scripts/access-log-proof.mjs` for
 * the proof, against a fake client that can fail a call outright to model an
 * unreachable server.
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
const tombstoneKey = (entityKey: string) => `healthsend:revoked:${entityKey.toLowerCase()}`
/** Set only when a log write was dropped — see `recordAccessWith`. */
const degradedKey = (entityKey: string) => `healthsend:degraded:${entityKey.toLowerCase()}`

export type StoredShare = {
  /** The holder's half of the content key, base64url. */
  share: string
  /** SHA-256 of the auth key, hex. Mirrors the commitment in the Arkiv entity. */
  commitment: string
}

/**
 * The narrow slice of the Upstash client every function below actually needs.
 * Every real Redis instance satisfies this structurally, and a test can hand
 * in a plain object with the same five methods — no network, no mocking
 * framework — which is what `scripts/access-log-proof.mjs` does to prove the
 * atomicity of the scripts below without Redis.
 */
export type HolderClient = Pick<Redis, "eval" | "get" | "set" | "lrange" | "exists">

// KEYS[1] = access log key. ARGV[1] = timestamp, ARGV[2] = ttl seconds.
// One call: the list and its expiry either both land or neither does.
export const RECORD_ACCESS_SCRIPT = `
redis.call("RPUSH", KEYS[1], ARGV[1])
return redis.call("EXPIRE", KEYS[1], ARGV[2])
`

// KEYS[1] = share key, KEYS[2] = access log key, KEYS[3] = tombstone key.
// ARGV[1] = tombstone value, ARGV[2] = tombstone ttl seconds.
// One call: the slot can never be observed freed (share gone) without the
// tombstone that guards it also being in place.
export const TOMBSTONE_SCRIPT = `
redis.call("DEL", KEYS[1])
redis.call("DEL", KEYS[2])
return redis.call("SET", KEYS[3], ARGV[1], "EX", ARGV[2])
`

// KEYS[1] = share key, KEYS[2] = tombstone key.
// ARGV[1] = share JSON, ARGV[2] = ttl seconds.
// One call: the tombstone check and the write happen in the same atomic step,
// so nothing can tombstone the entity in the gap between them — there is no
// gap.
export const PUT_SHARE_SCRIPT = `
if redis.call("EXISTS", KEYS[2]) == 1 then
  return 0
end
if redis.call("SET", KEYS[1], ARGV[1], "NX", "EX", ARGV[2]) then
  return 1
end
return 0
`

/**
 * Write once, never overwrite.
 *
 * `nx` matters: without it anyone could POST a new share for an existing entity
 * key and lock the real recipient out, or worse, swap in a share of their own.
 *
 * A tombstoned entity refuses too, unconditionally — checked in the same
 * atomic script as the write itself, see `PUT_SHARE_SCRIPT` above. Without
 * this, `SET NX` alone cannot tell a slot that was revoked from a slot that
 * never existed, and the recipient still holds the bytes to refill it.
 */
export async function putShareWith(
  client: HolderClient,
  entityKey: string,
  value: StoredShare,
  ttlSeconds: number,
): Promise<boolean> {
  const ex = Math.max(60, Math.floor(ttlSeconds) + TTL_GRACE_SECONDS)
  const result = await client.eval(
    PUT_SHARE_SCRIPT,
    [key(entityKey), tombstoneKey(entityKey)],
    [JSON.stringify(value), ex],
  )
  return result === 1
}

export async function putShare(
  entityKey: string,
  value: StoredShare,
  ttlSeconds: number,
): Promise<boolean> {
  return putShareWith(redis(), entityKey, value, ttlSeconds)
}

export async function getShare(entityKey: string): Promise<StoredShare | null> {
  const raw = await redis().get<StoredShare | string>(key(entityKey))
  if (!raw) return null
  return typeof raw === "string" ? (JSON.parse(raw) as StoredShare) : raw
}

/**
 * Used when a sender ends a send early. Expiry does not need this.
 *
 * Deletes the share and its access log, the same as before, and leaves a
 * tombstone under a TTL at least as long as the grant's own remaining life
 * (`ttlSeconds`, plus the same grace as everything else here) — all three in
 * the one atomic script (`TOMBSTONE_SCRIPT`) instead of a `Promise.all` of
 * independent calls. While the grant is live, `putShare` refuses any write to
 * a tombstoned entity — so the recipient's copy of the share, still sitting
 * in their browser, cannot be POSTed back to reopen what was just closed. A
 * `Promise.all` could previously delete the share and then drop the tombstone
 * write, freeing the slot with nothing marking it revoked; the atomic script
 * cannot land in that half-applied state.
 */
export async function tombstoneShareWith(
  client: HolderClient,
  entityKey: string,
  ttlSeconds: number,
): Promise<void> {
  const ttl = Math.max(60, Math.floor(ttlSeconds) + TTL_GRACE_SECONDS)
  await client.eval(
    TOMBSTONE_SCRIPT,
    [key(entityKey), accessLogKey(entityKey), tombstoneKey(entityKey)],
    ["1", ttl],
  )
}

export async function tombstoneShare(entityKey: string, ttlSeconds: number): Promise<void> {
  return tombstoneShareWith(redis(), entityKey, ttlSeconds)
}

/** Whether an entity key was ended early by its sender, as opposed to never used or lapsed. */
export async function isRevoked(entityKey: string): Promise<boolean> {
  return (await redis().exists(tombstoneKey(entityKey))) === 1
}

/**
 * Record one served unlock. Called only after the holder has actually handed
 * back the share — see `resolveUnlock` in lib/unlock.ts, which swallows any
 * error this throws so a bookkeeping failure can never turn a served share
 * into a failed one.
 *
 * The log's TTL is pinned to the grant's own expiry, the same way the share's
 * TTL is: the record lives only as long as the arrangement it describes. The
 * append and the expiry are one atomic script (`RECORD_ACCESS_SCRIPT`), so a
 * list can never be observed holding timestamps with no TTL at all.
 *
 * If the write is dropped anyway — the whole call never reaches Redis, or
 * comes back as an error — a served unlock still leaves no record, by design
 * (see the file header on `lib/unlock.ts`). That would let the access-log
 * read report a confident "never opened" about a share that was, in fact,
 * opened. So a dropped write makes one more best-effort attempt: a single
 * `SET` marking this entity's log as degraded. `getAccessLogWith` checks that
 * marker and reports `reliable: false` when it is set, so a reader is told
 * "we don't know" instead of a false negative. If even that marker write
 * fails, there is nothing further to try here — this function still rethrows,
 * and `lib/unlock.ts`'s own swallow is the last line of defense.
 */
export async function recordAccessWith(
  client: HolderClient,
  entityKey: string,
  at: number,
  expiresAt: number,
): Promise<void> {
  const ttlSeconds = Math.max(60, Math.ceil(expiresAt - at) + TTL_GRACE_SECONDS)
  try {
    await client.eval(RECORD_ACCESS_SCRIPT, [accessLogKey(entityKey)], [at, ttlSeconds])
  } catch (error) {
    await client.set(degradedKey(entityKey), "1", { ex: ttlSeconds }).catch(() => {})
    throw error
  }
}

export async function recordAccess(entityKey: string, at: number, expiresAt: number): Promise<void> {
  return recordAccessWith(redis(), entityKey, at, expiresAt)
}

export type AccessLogState = {
  /** Every timestamp the holder has recorded for this entity key, oldest first. */
  opened: number[]
  /**
   * False once a log write for this entity is known to have been dropped.
   * `opened` may then be missing an entry — an empty or short list must not
   * be read as a confident "never opened" while this is false.
   */
  reliable: boolean
}

export async function getAccessLogWith(client: HolderClient, entityKey: string): Promise<AccessLogState> {
  const [raw, degraded] = await Promise.all([
    client.lrange<number>(accessLogKey(entityKey), 0, -1),
    client.exists(degradedKey(entityKey)),
  ])
  return { opened: raw.map(Number), reliable: degraded !== 1 }
}

export async function getAccessLog(entityKey: string): Promise<AccessLogState> {
  return getAccessLogWith(redis(), entityKey)
}
