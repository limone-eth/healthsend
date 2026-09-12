/**
 * Arkiv — the grant registry.
 *
 * Arkiv is the index beside the file, never the file itself: the encrypted bytes
 * live on Swarm, and the Arkiv entity holds the hash that points at them, the
 * wrapped content key, and the typed attributes we actually want to query on.
 *
 * Two properties of Arkiv are doing real work here rather than decorative work:
 *
 *   `expires`  — a native lifetime on the entity. When it lapses the entity stops
 *                answering queries, and with it goes the wrapped content key. No
 *                revocation job runs, and no code of ours decides to stop serving.
 *                Expiry is the product feature, expressed as a storage primitive.
 *
 *   attributes — typed and queryable, so the sender's dashboard is a compound
 *                filter over owner + kind + file type + time, not a table scan.
 *
 * Because entities are public, nothing semantic goes in an attribute in the
 * clear: sensitive values are HMAC'd under a key only the user holds (see
 * `blindAttribute`), which keeps equality lookups working while leaving the
 * index opaque to everyone else. Timestamps stay plaintext so ranges still work.
 */

import { createPublicClient, createWalletClient, NoEntityFoundError } from "@arkiv-network/sdk"
import { tiramisu } from "@arkiv-network/sdk/chains"
import { addr, str, u64 } from "@arkiv-network/sdk/attr"
import { and, eq, gte } from "@arkiv-network/sdk/query"
import { ExpirationTime, jsonToPayload } from "@arkiv-network/sdk/utils"
import { http, type Hex } from "viem"
import { privateKeyToAccount } from "viem/accounts"

export const ARKIV_CHAIN = tiramisu
export const ARKIV_RPC = process.env.NEXT_PUBLIC_ARKIV_RPC ?? undefined
export const ARKIV_EXPLORER = "https://tiramisu.explorer.arkiv.network"

/** Arkiv counts lifetimes in blocks. Nominal block time, in seconds. */
const BLOCK_TIME = 2

/** Namespace so we never collide with anything else on a shared testnet. */
const APP = "healthsend"
const KIND_GRANT = "grant"

export type FileKind = "pdf" | "csv" | "text" | "mixed"

/**
 * What we put in the entity payload.
 *
 * v2 carries **no key material at all** — only a Swarm reference and a hash
 * commitment. That is deliberate and it is the fix for the defect described in
 * the README: entity payloads travel in transaction calldata, which is permanent,
 * so anything secret written here is published forever. A commitment lets the
 * holder check a claim without anyone being able to reconstruct the secret
 * behind it, which is the role Arkiv's own docs describe for an index.
 *
 * v1 put the wrapped content key here. Those grants are readable forever; see
 * `scripts/payload-survives.mjs`.
 */
export type GrantPayload = {
  v: 2
  /** Swarm content hash of `iv || ciphertext`. */
  ref: string
  /** SHA-256 of the auth key, hex. Public by design, and reveals nothing. */
  authCommitment: string
}

/** The superseded shape, still readable so old links degrade honestly. */
export type LegacyGrantPayload = {
  v: 1
  ref: string
  wrap: { iv: string; ct: string }
}

/**
 * The entity is live — Arkiv answered, it exists — but its payload will not parse. Distinct from
 * "gone" on purpose: a caller that lets this collapse into `null` tells the reader their access
 * ended, when what actually happened is that our own data is corrupt.
 */
export class MalformedGrantError extends Error {
  constructor(entityKey: string, cause: unknown) {
    super(`Grant entity ${entityKey} is live but its payload could not be read: ${String(cause)}`, {
      cause,
    })
    this.name = "MalformedGrantError"
  }
}

export type Grant = {
  entityKey: string
  payload: GrantPayload | LegacyGrantPayload
  /** Convenience accessor; empty for v1 grants, which have no commitment. */
  authCommitment: string
  /** True when this grant predates the split-key design. */
  legacy: boolean
  /** The `ownedBy` address. Authorises "End access now" — see `lib/revoke.ts`. */
  sender: string
  fileKind: FileKind
  createdAt: number
  /** The block the grant dies at. This is the authority — see `createGrant`. */
  expiresBlock: number
  /** Wall-clock expiry derived from `expiresBlock` and the chain's current head. */
  expiresAt: number
  recipient: string
  label: string
  fileCount: number
}

export async function getCurrentBlock(): Promise<bigint> {
  return getPublicClient().getBlockNumber()
}

export function getPublicClient() {
  return createPublicClient({
    chain: ARKIV_CHAIN,
    transport: http(ARKIV_RPC),
  })
}

export function getWalletClient(privateKey: Hex) {
  return createWalletClient({
    chain: ARKIV_CHAIN,
    transport: http(ARKIV_RPC),
    account: privateKeyToAccount(privateKey),
  })
}

/**
 * Write one grant.
 *
 * `expires` is the entire revocation story. We size it to the share window the
 * sender picked and then never touch the entity again — no cleanup job, no
 * cron, no delete call. The absence of the entity after the boundary is the
 * signal, which is the shape Arkiv's "built to expire" mission asks for.
 */
export async function createGrant(params: {
  privateKey: Hex
  payload: GrantPayload
  fileKind: FileKind
  /** HMAC-blinded recipient label — opaque in the public index. */
  recipientBlind: string
  /** HMAC-blinded human label for the bundle. */
  labelBlind: string
  /** How many documents the send carries. Queryable, and discloses nothing. */
  fileCount: number
  ttlSeconds: number
}): Promise<{ entityKey: string; txHash: string; expiresBlock: number; expiresAt: number }> {
  const client = getWalletClient(params.privateKey)
  const now = Math.floor(Date.now() / 1000)

  // Pin an absolute block rather than ask for a duration.
  //
  // A duration (`fromSeconds`) is resolved by the engine against the block the
  // transaction *lands in*, so the real expiry drifts later by however long
  // inclusion took — the SDK documents it as a lower bound. That drift is why a
  // grant can outlive the window its sender was shown. `atBlock` is exact, and
  // computing the target from the current head makes the deadline we enforce
  // the same one we display.
  const currentBlock = await getCurrentBlock()
  const expiresBlock = currentBlock + BigInt(Math.ceil(params.ttlSeconds / BLOCK_TIME))

  const result = await client.createEntity({
    payload: jsonToPayload(params.payload),
    contentType: "application/json",
    attributes: {
      app: str(APP),
      kind: str(KIND_GRANT),
      sender: addr(client.account.address),
      // File type is a coarse, non-identifying category, so it stays readable
      // and gives the dashboard a second axis to filter on.
      filetype: str(params.fileKind),
      recipient: str(params.recipientBlind),
      file_count: u64(BigInt(params.fileCount)),
      label: str(params.labelBlind),
      // Attribute names are lowercase by necessity, not style: the engine's
      // Ident32 grammar rejects "A"-"Z", and it rejects them on-chain — the
      // SDK validates the name client-side and lets camelCase through, so a
      // name like `createdAt` costs a reverted transaction to discover.
      created_at: u64(BigInt(now)),
      // The block height is what the engine prunes on, so it is what we store
      // and what every countdown is computed from.
      expires_block: u64(expiresBlock),
    },
    expires: ExpirationTime.atBlock(expiresBlock),
  })

  return {
    entityKey: result.entityKey,
    txHash: result.txHash,
    expiresBlock: Number(expiresBlock),
    expiresAt: now + params.ttlSeconds,
  }
}

/**
 * The sender's dashboard query.
 *
 * A compound filter over four typed attributes, not a lookup by id: ownership
 * plus namespace plus kind, optionally narrowed by file type and by a creation
 * time range. Expired grants are absent by construction — there is no "where
 * active = true" here because nothing has to maintain such a flag.
 */
export async function listGrants(params: {
  owner: string
  fileKind?: FileKind
  createdAfter?: number
  /** Only sends carrying at least this many documents. */
  minFiles?: number
  limit?: number
}): Promise<Grant[]> {
  const client = getPublicClient()

  // Every predicate carries the same tagged type the attribute was written with.
  // A bare string would assert `str` and a bare bigint `u256`, and a type
  // mismatch is not an error to the engine — it silently matches nothing.
  const predicates = [
    eq("app", str(APP)),
    eq("kind", str(KIND_GRANT)),
    eq("sender", addr(params.owner as Hex)),
  ]
  if (params.fileKind) predicates.push(eq("filetype", str(params.fileKind)))
  if (params.createdAfter) predicates.push(gte("created_at", u64(BigInt(params.createdAfter))))
  if (params.minFiles) predicates.push(gte("file_count", u64(BigInt(params.minFiles))))

  const [result, head] = await Promise.all([
    client
      .select({ key: true, attributes: true, payload: true })
      .where(and(...predicates))
      .ownedBy(params.owner as Hex)
      .limit(params.limit ?? 50)
      .fetch(),
    getCurrentBlock(),
  ])

  const grants: Grant[] = []
  for (const entity of result.entities) {
    try {
      grants.push(toGrant(entity, head))
    } catch {
      // A malformed entry does not fail the whole dashboard listing — just this row.
    }
  }
  return grants
}

/**
 * The recipient's read. Absence here is what expiry looks like from outside.
 *
 * A missing entity and an unreachable node are not the same event and must not
 * look the same: reporting "this expired" because an RPC timed out tells the
 * reader something false about their access. Only `NoEntityFoundError` — the
 * SDK's own signal that a query round-tripped and came back with zero rows —
 * means "gone". Everything else, structurally, is something we could not
 * finish or could not read, and it throws so the caller has to say so rather
 * than guess: an HTTP status from a wrong RPC URL or a proxy is a transport
 * error, never a JSON-RPC result at all, so it cannot be this one; a query the
 * node itself rejected (`QueryError`) is a protocol error, not an absence
 * either; and a live entity whose payload will not parse throws
 * `MalformedGrantError` rather than reaching this function's return at all.
 */
export async function getGrant(entityKey: string): Promise<Grant | null> {
  const client = getPublicClient()
  try {
    const [entity, head] = await Promise.all([
      client.getEntity(entityKey as Hex),
      getCurrentBlock(),
    ])
    return toGrant(entity, head)
  } catch (error) {
    if (error instanceof NoEntityFoundError) return null
    throw error
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function toGrant(entity: any, head: bigint): Grant {
  const entityKey = entity.key ?? entity.entityKey
  const attributes = normaliseAttributes(entity.attributes)
  const expiresBlock = Number(attributes.expires_block ?? 0)

  let payload: GrantPayload | LegacyGrantPayload
  try {
    payload = typeof entity.toJson === "function" ? entity.toJson() : JSON.parse(String(entity.payload))
  } catch (cause) {
    throw new MalformedGrantError(entityKey, cause)
  }
  if (!payload?.ref) throw new MalformedGrantError(entityKey, "missing payload reference")

  const legacy = payload.v !== 2
  return {
    entityKey,
    payload,
    authCommitment: legacy ? "" : ((payload as GrantPayload).authCommitment ?? ""),
    legacy,
    sender: String(attributes.sender ?? ""),
    fileKind: (attributes.filetype as FileKind) ?? "text",
    createdAt: Number(attributes.created_at ?? 0),
    expiresBlock,
    // Blocks remaining, converted at the nominal block time. Approximate as a
    // clock, exact as a boundary — and it is the boundary that matters.
    expiresAt: Math.floor(Date.now() / 1000) + Math.max(0, expiresBlock - Number(head)) * BLOCK_TIME,
    recipient: String(attributes.recipient ?? ""),
    label: String(attributes.label ?? ""),
    fileCount: Number(attributes.file_count ?? 1),
  }
}

/**
 * Attribute values come back tagged with their Arkiv type. Flatten to plain JS
 * so the rest of the app never has to care which tagged constructor produced one.
 */
function normaliseAttributes(raw: any): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!raw) return out
  const entries = Array.isArray(raw) ? raw.map((a) => [a.key ?? a.name, a.value]) : Object.entries(raw)
  for (const [key, value] of entries) {
    out[key as string] =
      value && typeof value === "object" && "value" in (value as object)
        ? (value as any).value
        : value
  }
  return out
}
/* eslint-enable @typescript-eslint/no-explicit-any */
