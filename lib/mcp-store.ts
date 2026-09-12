import { Redis } from "@upstash/redis"

/**
 * The remote MCP store contains ciphertext only. Its lookup key is a SHA-256
 * digest of the bearer capability, so neither the capability's AES key nor the
 * sender address is persisted beside the encrypted slice. The public Arkiv
 * entity key stays as routing metadata so expiry can be checked before decrypting
 * any health record.
 */

const CIPHERTEXT_TTL_GRACE_SECONDS = 60 * 60
const DIGEST_RE = /^[0-9a-f]{64}$/
const RATE_SCOPE_RE = /^[a-z0-9_-]{1,32}$/

let client: Redis | null = null

export type StoredMcpCiphertext = {
  v: 1
  /** Public routing metadata; lets the server ask Arkiv before decrypting. */
  entityKey: string
  iv: string
  ciphertext: string
}

export type McpStoreClient = Pick<Redis, "eval" | "get" | "set">

export function mcpStoreConfigured(): boolean {
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

function assertDigest(value: string, label: string): void {
  if (!DIGEST_RE.test(value)) throw new Error(`Invalid ${label}`)
}

const ciphertextKey = (capabilityId: string) => {
  assertDigest(capabilityId, "capability id")
  return `healthsend:mcp:ciphertext:${capabilityId}`
}

const mintKey = (mintId: string) => {
  assertDigest(mintId, "mint id")
  return `healthsend:mcp:mint:${mintId}`
}

// KEYS[1] = ciphertext key, KEYS[2] = one-time signed-consent key.
// ARGV[1] = ciphertext JSON, ARGV[2] = ciphertext ttl, ARGV[3] = consent ttl.
// The signature is claimed in the same operation as the encrypted write. A
// captured five-minute signature can therefore never mint a second capability.
export const PUT_MCP_CIPHERTEXT_SCRIPT = `
if redis.call("EXISTS", KEYS[2]) == 1 then
  return 0
end
if not redis.call("SET", KEYS[1], ARGV[1], "NX", "EX", ARGV[2]) then
  return -1
end
redis.call("SET", KEYS[2], "1", "EX", ARGV[3])
return 1
`

/**
 * Write once under a random capability digest and claim the signed consent once.
 * The one-hour ciphertext grace avoids deleting a still-live grant early if
 * nominal Arkiv block time and wall time drift apart. It does not extend access:
 * every tool call asks Arkiv whether the entity still exists before returning a
 * record.
 */
export async function putMcpCiphertextWith(
  store: McpStoreClient,
  capabilityId: string,
  mintId: string,
  value: StoredMcpCiphertext,
  ttlSeconds: number,
  consentTtlSeconds: number,
): Promise<"stored" | "replayed" | "collision"> {
  const ttl = Math.max(60, Math.ceil(ttlSeconds) + CIPHERTEXT_TTL_GRACE_SECONDS)
  const consentTtl = Math.max(1, Math.ceil(consentTtlSeconds))
  const result = await store.eval(
    PUT_MCP_CIPHERTEXT_SCRIPT,
    [ciphertextKey(capabilityId), mintKey(mintId)],
    [JSON.stringify(value), ttl, consentTtl],
  )
  if (result === 1) return "stored"
  if (result === 0) return "replayed"
  return "collision"
}

export async function putMcpCiphertext(
  capabilityId: string,
  mintId: string,
  value: StoredMcpCiphertext,
  ttlSeconds: number,
  consentTtlSeconds: number,
): Promise<"stored" | "replayed" | "collision"> {
  return putMcpCiphertextWith(
    redis(),
    capabilityId,
    mintId,
    value,
    ttlSeconds,
    consentTtlSeconds,
  )
}

export async function getMcpCiphertextWith(
  store: McpStoreClient,
  capabilityId: string,
): Promise<StoredMcpCiphertext | null> {
  const raw = await store.get<StoredMcpCiphertext | string>(ciphertextKey(capabilityId))
  if (!raw) return null
  return typeof raw === "string" ? (JSON.parse(raw) as StoredMcpCiphertext) : raw
}

export async function getMcpCiphertext(
  capabilityId: string,
): Promise<StoredMcpCiphertext | null> {
  return getMcpCiphertextWith(redis(), capabilityId)
}

export type McpRateLimitBucket = {
  /** A small route-local namespace, never user-controlled. */
  scope: string
  /** A SHA-256 digest. Raw IP addresses and bearer capabilities never enter Redis keys. */
  subject: string
  limit: number
}

export type McpRateLimitPolicy = {
  windowSeconds: number
  blockSeconds: number
}

export type McpRateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number }

/**
 * KEYS are counter/block pairs, one pair per bucket. ARGV[1] is the counter
 * window, ARGV[2] the abuse block, and ARGV[3..] each bucket's limit.
 *
 * Checking existing blocks, incrementing all counters, setting their expiries,
 * and escalating any exceeded bucket must be one operation. Separate HTTP calls
 * to Upstash could otherwise interleave and let concurrent requests each see an
 * allowed state. EVAL makes the complete multi-key decision atomic.
 */
export const MCP_RATE_LIMIT_SCRIPT = `
local window = tonumber(ARGV[1])
local block_for = tonumber(ARGV[2])
local retry_after = 0

for i = 1, #KEYS, 2 do
  local blocked_ttl = redis.call("TTL", KEYS[i + 1])
  if blocked_ttl > retry_after then
    retry_after = blocked_ttl
  end
end

if retry_after > 0 then
  return {0, retry_after}
end

local exceeded = {}
for i = 1, #KEYS, 2 do
  local count = redis.call("INCR", KEYS[i])
  if count == 1 then
    redis.call("EXPIRE", KEYS[i], window)
  end
  local bucket = ((i + 1) / 2)
  if count > tonumber(ARGV[bucket + 2]) then
    table.insert(exceeded, i + 1)
  end
end

if #exceeded > 0 then
  for _, block_key_index in ipairs(exceeded) do
    redis.call("SET", KEYS[block_key_index], "1", "EX", block_for)
  end
  return {0, block_for}
end

return {1, 0}
`

function rateKeys(bucket: McpRateLimitBucket): [string, string] {
  if (!RATE_SCOPE_RE.test(bucket.scope)) throw new Error("Invalid rate-limit scope")
  assertDigest(bucket.subject, "rate-limit subject")
  if (!Number.isSafeInteger(bucket.limit) || bucket.limit < 1) {
    throw new Error("Invalid rate-limit bucket")
  }
  const prefix = `healthsend:mcp:rate:${bucket.scope}:${bucket.subject}`
  return [`${prefix}:count`, `${prefix}:blocked`]
}

/** Offline-proofable rate-limit primitive; production passes the Upstash client. */
export async function consumeMcpRateLimitWith(
  store: McpStoreClient,
  buckets: McpRateLimitBucket[],
  policy: McpRateLimitPolicy,
): Promise<McpRateLimitResult> {
  if (buckets.length === 0) throw new Error("A rate limit needs at least one bucket")
  if (!Number.isSafeInteger(policy.windowSeconds) || policy.windowSeconds < 1) {
    throw new Error("Invalid rate-limit window")
  }
  if (!Number.isSafeInteger(policy.blockSeconds) || policy.blockSeconds < 1) {
    throw new Error("Invalid abuse-block duration")
  }

  const keys = buckets.flatMap(rateKeys)
  const args = [policy.windowSeconds, policy.blockSeconds, ...buckets.map((bucket) => bucket.limit)]
  const raw = await store.eval(MCP_RATE_LIMIT_SCRIPT, keys, args)
  if (!Array.isArray(raw) || raw.length < 2) throw new Error("Invalid rate-limit response")

  const allowed = Number(raw[0]) === 1
  if (allowed) return { allowed: true }
  return { allowed: false, retryAfterSeconds: Math.max(1, Number(raw[1]) || 1) }
}

export async function consumeMcpRateLimit(
  buckets: McpRateLimitBucket[],
  policy: McpRateLimitPolicy,
): Promise<McpRateLimitResult> {
  return consumeMcpRateLimitWith(redis(), buckets, policy)
}
