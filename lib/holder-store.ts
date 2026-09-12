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
 * **Every coordinated holder change here is one Lua script, not several round trips.**
 * `@upstash/redis` is an HTTP client: there is no `MULTI`/`EXEC` transaction,
 * and `.pipeline()` (`.multi()` is an alias for the same thing) is explicitly
 * documented as non-atomic — "commands sent by other clients can interleave
 * with the pipeline." The one primitive that *is* atomic against interleaving
 * is `EVAL`: each script runs to completion on the Redis server as one
 * operation. A transport failure before the script reaches Redis leaves no
 * effect. Redis does not roll back commands before a script runtime error, so
 * each script also keeps its command sequence small and direct.
 *
 * Four holder operations use this mechanism:
 *
 *   - `recordAccess` keeps `RPUSH` and `EXPIRE` together for old callers.
 *   - `tombstoneShare` deletes the share and creates its tombstone together,
 *     while it preserves the access history.
 *   - `putShare` checks the tombstone and claims the write-once slot together,
 *     and — H-7 — writes a share's code verifier in the same call, so a crash
 *     between two separate writes can never leave a share stored with no code
 *     guard at all.
 *   - `serveShare` checks the tombstone, reads the share, and records the open
 *     together. This is the final unlock operation.
 *   - `checkCode` (H-7) checks a presented code's proof against the stored
 *     verifier and counts the attempt in the same call, so concurrent guesses
 *     cannot each observe room for one more try.
 *
 * See `scripts/access-log-proof.mjs` and `scripts/code-proof.mjs`. Fengari runs
 * the real Lua text against an in-memory Redis command surface.
 */

const TTL_GRACE_SECONDS = 60 * 60

/**
 * How many wrong codes a grant tolerates before it refuses every further
 * attempt for the rest of its life. Four digits is a 10,000-entry space; five
 * tries costs an attacker thousands of grants' worth of guessing to land one,
 * and still leaves a legitimate reader room for a mistyped digit or two.
 */
export const MAX_CODE_ATTEMPTS = 5

let client: Redis | null = null

export function holderConfigured(): boolean {
  if (!process.env.KV_REST_API_TOKEN) return false

  try {
    const url = new URL(process.env.KV_REST_API_URL ?? "")
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
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

/**
 * A real round trip to the store — H-58/R3-003.
 *
 * `createSend`'s preflight (`lib/sends.ts`) needs to know the store itself is
 * reachable, not just that its own route is configured and parses requests.
 * This uses its own client rather than the memoized one `redis()` hands the
 * write paths above: those benefit from the client's default retries against
 * a transient blip mid-send, but a preflight exists to fail fast, so it
 * disables them — a slow "Checking key-share holder" step that still ends in
 * failure is worse than a quick one.
 */
export async function pingHolder(): Promise<void> {
  const probe = new Redis({
    url: process.env.KV_REST_API_URL!,
    token: process.env.KV_REST_API_TOKEN!,
    retry: false,
  })
  await probe.ping()
}

const key = (entityKey: string) => `healthsend:share:${entityKey.toLowerCase()}`
const accessLogKey = (entityKey: string) => `healthsend:access:${entityKey.toLowerCase()}`
const tombstoneKey = (entityKey: string) => `healthsend:revoked:${entityKey.toLowerCase()}`
/** Set only when the older standalone log writer drops a write. */
const degradedKey = (entityKey: string) => `healthsend:degraded:${entityKey.toLowerCase()}`
/** The code verifier for a share that carries one. Absent for an uncoded send. */
const codeHashKey = (entityKey: string) => `healthsend:codehash:${entityKey.toLowerCase()}`
/** Wrong-code attempts against a coded share. Gone at expiry, same as the share itself. */
const codeAttemptsKey = (entityKey: string) => `healthsend:codeattempts:${entityKey.toLowerCase()}`

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

// KEYS[1] = share key, KEYS[2] = tombstone key.
// ARGV[1] = tombstone value, ARGV[2] = tombstone ttl seconds.
// One call: the slot can never be observed freed (share gone) without the
// tombstone that guards it also being in place. The access log keeps its own
// TTL and survives so the sender can still see opens after ending access.
export const TOMBSTONE_SCRIPT = `
redis.call("DEL", KEYS[1])
return redis.call("SET", KEYS[2], ARGV[1], "EX", ARGV[2])
`

// KEYS[1] = share key, KEYS[2] = tombstone key, KEYS[3] = code-hash key.
// ARGV[1] = share JSON, ARGV[2] = ttl seconds, ARGV[3] = code proof to verify
// future attempts against ("" when this send carries no code).
// One call: the tombstone check, the write-once share, and the code guard all
// happen in the same atomic step — there is no gap for a revoke to land in,
// and no gap that could leave a coded share stored with its guard missing.
export const PUT_SHARE_SCRIPT = `
if redis.call("EXISTS", KEYS[2]) == 1 then
  return 0
end
if redis.call("SET", KEYS[1], ARGV[1], "NX", "EX", ARGV[2]) then
  if ARGV[3] ~= "" then
    redis.call("SET", KEYS[3], ARGV[3], "EX", ARGV[2])
  end
  return 1
end
return 0
`

// KEYS[1] = code-hash key, KEYS[2] = attempt-counter key.
// ARGV[1] = presented proof ("" to ask only whether a code is required, never
// counted as a guess), ARGV[2] = max attempts, ARGV[3] = counter ttl seconds.
// One call: the attempt limit is read and consumed together, so concurrent
// guesses against the same grant cannot each observe room for one more try.
export const CHECK_CODE_SCRIPT = `
local codeHash = redis.call("GET", KEYS[1])
if not codeHash then
  return "NONE"
end
if ARGV[1] == "" then
  return "REQUIRED"
end
local attempts = tonumber(redis.call("GET", KEYS[2]) or "0")
if attempts >= tonumber(ARGV[2]) then
  return "LOCKED"
end
if ARGV[1] ~= codeHash then
  local updated = redis.call("INCR", KEYS[2])
  if updated == 1 then
    redis.call("EXPIRE", KEYS[2], ARGV[3])
  end
  if updated >= tonumber(ARGV[2]) then
    return "LOCKED"
  end
  return "WRONG"
end
return "OK"
`

// KEYS[1] = share key, KEYS[2] = tombstone key, KEYS[3] = access log key.
// ARGV[1] = access timestamp, ARGV[2] = access-log ttl seconds.
// This is the unlock linearization point. A revoke cannot run between the
// tombstone check, the share read, the access record, and the script return.
export const SERVE_SHARE_SCRIPT = `
if redis.call("EXISTS", KEYS[2]) == 1 then
  return false
end
local share = redis.call("GET", KEYS[1])
if not share then
  return false
end
redis.call("RPUSH", KEYS[3], ARGV[1])
redis.call("EXPIRE", KEYS[3], ARGV[2])
return share
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
  /** The code proof to require on future unlocks — H-7. Omit for an uncoded send. */
  codeHash?: string,
): Promise<boolean> {
  const ex = Math.max(60, Math.floor(ttlSeconds) + TTL_GRACE_SECONDS)
  const result = await client.eval(
    PUT_SHARE_SCRIPT,
    [key(entityKey), tombstoneKey(entityKey), codeHashKey(entityKey)],
    [JSON.stringify(value), ex, codeHash ?? ""],
  )
  return result === 1
}

export async function putShare(
  entityKey: string,
  value: StoredShare,
  ttlSeconds: number,
  codeHash?: string,
): Promise<boolean> {
  return putShareWith(redis(), entityKey, value, ttlSeconds, codeHash)
}

/** What `checkCode` found, for the caller to translate into a response. */
export type CodeCheckOutcome =
  | "none" // this send carries no code — proceed as before
  | "required" // a code is needed and none was presented yet — ask for it
  | "ok" // the presented proof matches — proceed to serve
  | "wrong" // the presented proof does not match — an attempt was counted
  | "locked" // too many wrong attempts — refused for the rest of this grant's life

const CODE_CHECK_OUTCOMES: readonly CodeCheckOutcome[] = ["none", "required", "ok", "wrong", "locked"]

function parseCodeCheckOutcome(raw: unknown): CodeCheckOutcome {
  const lower = String(raw).toLowerCase()
  const match = CODE_CHECK_OUTCOMES.find((outcome) => outcome === lower)
  if (!match) throw new Error(`checkCode: unexpected result from the holder: ${String(raw)}`)
  return match
}

/**
 * Verify a presented code proof against the stored verifier, rate-limited.
 *
 * Called with an empty `presentedProof` to ask only whether a code is
 * required at all — that probe is never counted as a guess. `at`/`expiresAt`
 * size the attempt counter's TTL exactly like `serveShareWith` sizes the
 * share's, so a coded share's rate limit is gone at expiry along with
 * everything else the holder keeps for it.
 */
export async function checkCodeWith(
  client: HolderClient,
  entityKey: string,
  presentedProof: string,
  at: number,
  expiresAt: number,
): Promise<CodeCheckOutcome> {
  const ttlSeconds = Math.max(60, Math.ceil(expiresAt - at) + TTL_GRACE_SECONDS)
  const result = await client.eval(
    CHECK_CODE_SCRIPT,
    [codeHashKey(entityKey), codeAttemptsKey(entityKey)],
    [presentedProof, MAX_CODE_ATTEMPTS, ttlSeconds],
  )
  return parseCodeCheckOutcome(result)
}

export async function checkCode(
  entityKey: string,
  presentedProof: string,
  at: number,
  expiresAt: number,
): Promise<CodeCheckOutcome> {
  return checkCodeWith(redis(), entityKey, presentedProof, at, expiresAt)
}

function parseStoredShare(raw: StoredShare | string | null): StoredShare | null {
  if (!raw) return null
  return typeof raw === "string" ? (JSON.parse(raw) as StoredShare) : raw
}

export async function getShare(entityKey: string): Promise<StoredShare | null> {
  return parseStoredShare(await redis().get<StoredShare | string>(key(entityKey)))
}

/**
 * Return the share and record its delivery in one Redis operation.
 *
 * This is the final holder operation in an unlock. `SERVE_SHARE_SCRIPT` refuses
 * a tombstoned key, reads the share, appends the access event, and sets the log
 * TTL without an interleaving point. A holder failure returns no share to the
 * caller, so a later empty log remains a true empty log.
 */
export async function serveShareWith(
  client: HolderClient,
  entityKey: string,
  at: number,
  expiresAt: number,
): Promise<StoredShare | null> {
  const ttlSeconds = Math.max(60, Math.ceil(expiresAt - at) + TTL_GRACE_SECONDS)
  const raw = await client.eval(
    SERVE_SHARE_SCRIPT,
    [key(entityKey), tombstoneKey(entityKey), accessLogKey(entityKey)],
    [at, ttlSeconds],
  )
  return parseStoredShare(raw as StoredShare | string | null)
}

export async function serveShare(
  entityKey: string,
  at: number,
  expiresAt: number,
): Promise<StoredShare | null> {
  return serveShareWith(redis(), entityKey, at, expiresAt)
}

/**
 * Used when a sender ends a send early. Expiry does not need this.
 *
 * Deletes the share, preserves its access log, and leaves a tombstone under a
 * TTL at least as long as the grant's own remaining life (`ttlSeconds`, plus
 * the same grace as everything else here). The delete and tombstone write run
 * in one atomic script (`TOMBSTONE_SCRIPT`) instead of independent requests.
 * While the grant is live, `putShare` refuses any write to a tombstoned entity,
 * so the recipient's copy cannot reopen access. Preserving the access log lets
 * the sender see prior opens after ending access.
 */
export async function tombstoneShareWith(
  client: HolderClient,
  entityKey: string,
  ttlSeconds: number,
): Promise<void> {
  const ttl = Math.max(60, Math.floor(ttlSeconds) + TTL_GRACE_SECONDS)
  await client.eval(
    TOMBSTONE_SCRIPT,
    [key(entityKey), tombstoneKey(entityKey)],
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
 * Standalone access writer kept for old callers and direct atomicity proofs.
 *
 * New unlocks use `serveShareWith`, which reads and records in one operation.
 * This helper still pins the record to the grant expiry and marks the log as
 * degraded if its atomic append fails. The marker keeps older deployments'
 * dropped writes visible after a rolling release.
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
