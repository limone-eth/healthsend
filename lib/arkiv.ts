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
import { addr, bytes32, str, u64 } from "@arkiv-network/sdk/attr"
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
 * What a threshold-release grant binds its condition to.
 *
 * `owner` and `expiresBlock` are repeated here rather than looked up fresh at release time on
 * purpose — they are the exact values the TACo condition was built against, and the whole point of
 * this shape is that release only succeeds when Arkiv's *current* native state still matches them.
 * See `buildArkivGrantQuery`.
 *
 * This mirrors the shape H-50 defines in `lib/key-release/types.ts`; duplicated here rather than
 * imported because that module does not exist in this worktree yet. Structurally identical, so
 * nothing downstream needs to change once the two are reconciled.
 */
export type GrantBinding = {
  grantId: `0x${string}`
  owner: `0x${string}`
  expiresBlock: bigint
  ref: string
}

/**
 * A key share a `KeyReleaseProvider` has protected, still wrapped in the outer
 * link-secret envelope. Mirrors `lib/key-release/types.ts`'s `ProtectedKeyShare`
 * — see that file's own comment for why H-69 widened both to `"taco" |
 * "chipotle"` rather than leaving Chipotle to cast through `unknown`.
 */
export type ProtectedKeyShare = {
  provider: "taco" | "chipotle"
  domain: "lynx" | "chipotle"
  ritualId: number
  iv: string
  ciphertext: string
}

/**
 * The v3 shape: no key material of any kind, only a Swarm reference and a protected share whose
 * release TACo gates on the Arkiv condition `buildArkivGrantQuery` describes.
 */
export type ThresholdGrantPayload = {
  v: 3
  ref: string
  release: ProtectedKeyShare & { grantId: `0x${string}` }
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
  payload: GrantPayload | LegacyGrantPayload | ThresholdGrantPayload
  /** Convenience accessor; empty for v1 grants, which have no commitment. */
  authCommitment: string
  /** True when this grant predates the split-key design. */
  legacy: boolean
  /** The `ownedBy` address. Authorises "End access now" — see `lib/revoke.ts`. */
  sender: string
  /**
   * The entity's native owner, read from Arkiv itself rather than from an attribute anyone with a
   * key can shape. Authoritative for v3 grants — see `toGrant`.
   */
  owner: string
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

/** A fresh, unpredictable 32-byte grant identifier — the client never gets to choose the entity. */
function randomGrantId(): `0x${string}` {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  let hex = ""
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0")
  return `0x${hex}`
}

/**
 * Binds a threshold-release condition to one grant, before that grant exists on chain.
 *
 * `expiresBlock` is supplied, not computed here, because the caller must build the TACo condition
 * — and encrypt under it — using the exact same value the grant transaction will write. Computing
 * it twice (once here, once at write time) would let the two drift, which is exactly the
 * substitution/extension gap this design closes.
 */
export function buildGrantBinding(params: {
  owner: `0x${string}`
  expiresBlock: bigint
  ref: string
}): GrantBinding {
  return { grantId: randomGrantId(), owner: params.owner, expiresBlock: params.expiresBlock, ref: params.ref }
}

/** One `arkiv_query` request, and how to read its answer. */
export type ArkivGrantQuery = {
  endpoint: string
  method: "arkiv_query"
  params: [string, { select: { owner: true }; limit: string }]
  /** JSONPath into the RPC result. */
  query: string
  /** What `query` must equal for the condition to be satisfied. */
  expected: string
}

/**
 * The current-state Arkiv query a TACo `JsonRpcCondition` runs at release time.
 *
 * Every field of the binding is pinned as an equality against **live** Arkiv state — never
 * `atBlock`, so a historical read can never satisfy it (see `SelectQueryBuilder.atBlock` in the
 * SDK: it reads at a given height, which is exactly the convenient-past-block reading this
 * condition must refuse). Three properties fall out of that:
 *
 *   - Substitution is refused: a caller cannot point a live grant at this condition, because
 *     `grant_id` pins the one entity this binding names.
 *   - Extension does not widen the policy: if the owner extends the entity's native `expiresAt`,
 *     current state no longer matches the `$expiresAt = u64(originalBlock)` predicate, and the
 *     condition stops matching anything rather than starting to match the extended entity.
 *   - A convenient past read is impossible: there is no `atBlock` in the request at all.
 *
 * The rendered query string comes from the SDK's own `eq`/`and` expression builders, not hand
 * assembly, so its grammar — attribute-name rules, per-type literal spelling, `$owner`/`$expiresAt`
 * as the queryable system attributes — is exactly what a real Arkiv node parses.
 */
export function buildArkivGrantQuery(binding: GrantBinding): ArkivGrantQuery {
  const endpoint = resolveConditionEndpoint()

  const clause = and(
    eq("app", str(APP)),
    eq("kind", str(KIND_GRANT)),
    eq("grant_id", bytes32(binding.grantId)),
    eq("$owner", addr(binding.owner)),
    eq("$expiresAt", u64(binding.expiresBlock)),
  ).toString()

  return {
    endpoint,
    method: "arkiv_query",
    params: [clause, { select: { owner: true }, limit: "0x1" }],
    query: "$.data[0].owner",
    expected: binding.owner.toLowerCase(),
  }
}

/**
 * The endpoint a TACo condition embeds is permanent — it travels inside encrypted ciphertext that
 * outlives any one process's environment. An API key or credential in the URL would be published
 * forever right along with it, so this refuses anything but a bare HTTPS origin.
 */
function resolveConditionEndpoint(): string {
  const endpoint = ARKIV_RPC ?? ARKIV_CHAIN.rpcUrls.default.http[0]
  if (!endpoint) throw new Error("No Arkiv RPC endpoint is configured for a TACo release condition")

  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    throw new Error(`Arkiv RPC endpoint for a TACo condition is not a valid URL: ${endpoint}`)
  }
  if (url.protocol !== "https:") {
    throw new Error(`A TACo release condition must query Arkiv over HTTPS, got ${url.protocol} for ${endpoint}`)
  }
  if (url.username || url.password || [...url.searchParams.keys()].length > 0) {
    throw new Error(
      "The Arkiv RPC endpoint for a TACo condition must not embed credentials or an API key — the condition is permanent ciphertext",
    )
  }
  return endpoint
}

/**
 * Write one v3, threshold-release grant.
 *
 * `expiresBlock` and `grantId` are taken as given, not derived here — they are the same values
 * `buildGrantBinding`/`buildArkivGrantQuery` already used to build the TACo condition the payload's
 * protected share is gated on, and this transaction has to land on exactly those, not values
 * recomputed a moment later against a block that may have moved.
 *
 * `permissionlessExtension: false` keeps a third party from extending this entity's lifetime.
 * It is not what stops the *owner* from extending it — nothing can, ownership includes that right —
 * which is why the release condition pins the original `expiresBlock` rather than trusting the
 * entity to still be capped once it exists. See `buildArkivGrantQuery`.
 */
export async function createThresholdGrant(params: {
  privateKey: Hex
  grantId: `0x${string}`
  expiresBlock: bigint
  payload: ThresholdGrantPayload
  fileKind: FileKind
  recipientBlind: string
  labelBlind: string
  fileCount: number
}): Promise<{ entityKey: string; txHash: string; owner: string; expiresBlock: number }> {
  const client = getWalletClient(params.privateKey)
  const now = Math.floor(Date.now() / 1000)

  const result = await client.createEntity({
    payload: jsonToPayload(params.payload),
    contentType: "application/json",
    attributes: {
      app: str(APP),
      kind: str(KIND_GRANT),
      // The random identifier the release condition pins — see `buildGrantBinding`.
      grant_id: bytes32(params.grantId),
      // Kept alongside the native owner so `listGrants` can keep filtering by
      // `sender`; `toGrant` rejects this entity outright if the two disagree.
      sender: addr(client.account.address),
      filetype: str(params.fileKind),
      recipient: str(params.recipientBlind),
      file_count: u64(BigInt(params.fileCount)),
      label: str(params.labelBlind),
      created_at: u64(BigInt(now)),
      // Kept alongside the native expiry for the same reason as `sender`, above.
      expires_block: u64(params.expiresBlock),
    },
    expires: ExpirationTime.atBlock(params.expiresBlock),
    flags: { permissionlessExtension: false },
  })

  return {
    entityKey: result.entityKey,
    txHash: result.txHash,
    owner: client.account.address,
    expiresBlock: Number(params.expiresBlock),
  }
}

/**
 * End a v3 grant before its date by deleting the entity outright, as its
 * owner.
 *
 * A v3 share has no holder half to delete — the whole point of the design is
 * that nothing but Arkiv's own live state gates release (see
 * `buildArkivGrantQuery`). Deleting the entity is therefore what "end this
 * early" has to mean for a threshold-release grant: `chipotle-action.js`'s
 * `grantIsLive` (and TACo's own condition) checks for exactly this entity, at
 * exactly this owner and `$expiresAt`, so a deleted entity fails that check
 * the same way a naturally-expired one already does. See
 * docs/stories/H-69.md, "Ending a v3 share early".
 */
export async function deleteGrant(params: { privateKey: Hex; entityKey: string }): Promise<{ txHash: string }> {
  const client = getWalletClient(params.privateKey)
  const result = await client.deleteEntity({ entityKey: params.entityKey as Hex })
  return { txHash: result.txHash }
}

/**
 * A runaway-loop guard on the page walk below, not a product limit: at the
 * node's own page maximum (200) this is 20,000 entities. A real sender's
 * dashboard should never approach it — if one does, something upstream is
 * wrong (pruning stalled, a cursor loop), and the honest answer is to say so
 * rather than silently report a partial, wrong list.
 */
const MAX_LIST_PAGES = 100

type ListGrantsDependencies = {
  getPublicClient: typeof getPublicClient
  getCurrentBlock: typeof getCurrentBlock
}

const defaultListGrantsDependencies: ListGrantsDependencies = { getPublicClient, getCurrentBlock }

/**
 * The sender's dashboard query.
 *
 * A compound filter over four typed attributes, not a lookup by id: ownership
 * plus namespace plus kind, optionally narrowed by file type and by a creation
 * time range. Expired grants are absent by construction — there is no "where
 * active = true" here because nothing has to maintain such a flag.
 *
 * A single capped page used to be the whole of this query, and a sender past
 * that cap saw their oldest *live* grants reported as ended — the one
 * direction this product cannot afford to get wrong. This walks every page
 * the cursor offers instead of stopping at the first one.
 */
export async function listGrants(
  params: {
    owner: string
    fileKind?: FileKind
    createdAfter?: number
    /** Only sends carrying at least this many documents. */
    minFiles?: number
    limit?: number
  },
  dependencies: Partial<ListGrantsDependencies> = {},
): Promise<Grant[]> {
  const deps = { ...defaultListGrantsDependencies, ...dependencies }
  const client = deps.getPublicClient()

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

  const [firstPage, head] = await Promise.all([
    client
      .select({ key: true, owner: true, expiresAt: true, attributes: true, payload: true })
      .where(and(...predicates))
      .ownedBy(params.owner as Hex)
      .limit(params.limit ?? 200)
      .fetch(),
    deps.getCurrentBlock(),
  ])

  const entities = [...firstPage.entities]
  let page = firstPage
  let pages = 1
  while (page.hasNextPage()) {
    if (pages >= MAX_LIST_PAGES) {
      throw new Error(
        `Grant list for ${params.owner} did not end after ${pages} pages (${entities.length} entities) — refusing to guess which are still live`,
      )
    }
    page = await page.next()
    entities.push(...page.entities)
    pages++
  }

  const grants: Grant[] = []
  for (const entity of entities) {
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
  // Only populated when the caller's `.select()`/`getEntity()` asked for them — `getEntity` always
  // does (it selects "*"); `listGrants` asks explicitly. See the two call sites.
  const nativeOwner: string | undefined = entity.owner !== undefined ? String(entity.owner) : undefined
  const nativeExpiresBlock: number | undefined =
    entity.expiresAt !== undefined ? Number(entity.expiresAt) : undefined

  let payload: GrantPayload | LegacyGrantPayload | ThresholdGrantPayload
  try {
    payload = typeof entity.toJson === "function" ? entity.toJson() : JSON.parse(String(entity.payload))
  } catch (cause) {
    throw new MalformedGrantError(entityKey, cause)
  }
  if (!payload?.ref) throw new MalformedGrantError(entityKey, "missing payload reference")

  if (payload.v === 3) {
    // A v3 grant trusts Arkiv's own record of who owns it and when it dies, never a duplicated
    // attribute anyone with a key could have written to say anything. A `sender`/`expires_block`
    // attribute may still ride along so `listGrants`' predicates keep matching, but if it disagrees
    // with the native field, this entity is not trustworthy enough to open — reject it outright
    // rather than silently picking one side, exactly as the story asks.
    if (nativeOwner === undefined || nativeExpiresBlock === undefined) {
      throw new MalformedGrantError(entityKey, "v3 grant was read without its native owner/expiresAt selected")
    }
    const attrSender = attributes.sender !== undefined ? String(attributes.sender) : undefined
    if (attrSender !== undefined && attrSender.toLowerCase() !== nativeOwner.toLowerCase()) {
      throw new MalformedGrantError(
        entityKey,
        `native owner ${nativeOwner} disagrees with its own sender attribute ${attrSender}`,
      )
    }
    const attrExpiresBlock =
      attributes.expires_block !== undefined ? Number(attributes.expires_block) : undefined
    if (attrExpiresBlock !== undefined && attrExpiresBlock !== nativeExpiresBlock) {
      throw new MalformedGrantError(
        entityKey,
        `native expiresAt ${nativeExpiresBlock} disagrees with its own expires_block attribute ${attrExpiresBlock}`,
      )
    }
    return {
      entityKey,
      payload,
      authCommitment: "",
      legacy: false,
      sender: nativeOwner,
      owner: nativeOwner,
      fileKind: (attributes.filetype as FileKind) ?? "text",
      createdAt: Number(attributes.created_at ?? 0),
      expiresBlock: nativeExpiresBlock,
      expiresAt:
        Math.floor(Date.now() / 1000) + Math.max(0, nativeExpiresBlock - Number(head)) * BLOCK_TIME,
      recipient: String(attributes.recipient ?? ""),
      label: String(attributes.label ?? ""),
      fileCount: Number(attributes.file_count ?? 1),
    }
  }

  const expiresBlock = Number(attributes.expires_block ?? 0)
  const legacy = payload.v !== 2
  return {
    entityKey,
    payload,
    authCommitment: legacy ? "" : ((payload as GrantPayload).authCommitment ?? ""),
    legacy,
    sender: String(attributes.sender ?? ""),
    owner: nativeOwner ?? String(attributes.sender ?? ""),
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
