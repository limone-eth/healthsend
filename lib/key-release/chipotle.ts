/**
 * The Lit Chipotle `KeyReleaseProvider` — an enclave service, not a threshold committee.
 *
 * Chipotle derives its encryption key from a PKP (Programmable Key Pair) held
 * inside a TEE (trusted execution environment). One enclave, attested by Lit,
 * decides whether to hand back key material — never a quorum of independent
 * operators voting on a threshold. Moving from a threshold description swaps
 * one trusted party (this repo's Redis holder) for another (Lit's enclave
 * hardware, its attestation, and Lit as the operator running it). Every
 * message this module produces must say that plainly: never call this
 * "decentralised", "trustless", or a "threshold network" — see
 * `docs/stories/H-65.md`, "The trust model, stated honestly".
 *
 * This adapter speaks Lit's documented Chipotle API, verified 2026-09-12
 * against `https://api.chipotle.litprotocol.com/core/v1/openapi.json` and
 * `developer.litprotocol.com` — see `docs/stories/H-67.md` for the row-by-row
 * comparison against H-65's placeholder. Every action invocation runs by
 * **`ipfs_id`**, except the one cache-miss retry described below. Which code
 * a usage key may run against this PKP is decided by Lit, not by this app —
 * see the amendments paragraph.
 *
 * Two failure modes are specific to Chipotle and have no TACo analogue:
 *
 *   1. A single immutable Lit Action gates both `protect` and `release` on
 *      this adapter's PKP. If a *second*, more permissive action were ever
 *      authorized against the same PKP's group, it would bypass this gate
 *      entirely — the PKP does not care which authorized action asked it to
 *      encrypt or decrypt. `ensureSingleAuthorizedAction` checks this on
 *      every call and refuses to operate rather than assume it still holds.
 *   2. Unlike TACo, where the release condition is baked into the capsule at
 *      encrypt time and the network evaluates it unprompted, Chipotle's public
 *      API takes the grant identity as a plain argument to the action
 *      invocation. A caller could supply the ciphertext from an expired grant
 *      alongside the `binding` of a still-live one — including a live Arkiv
 *      entity they wrote themselves — and an action that only checks "is the
 *      *supplied* grant live" would release it (review-8 F1). The Lit Action
 *      (`chipotle-action.js`, alongside this file) closes that gap inside the
 *      enclave: `protect` seals the binding into the Lit ciphertext next to
 *      the share, and `release` decrypts first and checks Arkiv for the
 *      *sealed* binding, refusing any supplied field that disagrees. The
 *      commitment `protectShare` keeps in the envelope — a SHA-256 of
 *      `lib/crypto.ts`'s `encodeGrantBinding` — only lets `releaseShare`
 *      refuse a mismatched binding early, before any network call. It is not
 *      a trust boundary: anyone with the action's `ipfs_id` and a usage key
 *      can invoke the action directly, bypassing this file entirely.
 *
 * Every non-success outcome here is `ChipotleUnavailableError`, named after
 * the stage that failed, exactly as `lib/key-release/taco.ts` does and for
 * the same reason: Chipotle's own aggregate failures do not reliably
 * distinguish "the enclave said no" from "the enclave could not be reached",
 * so this adapter never converts uncertainty into a "denied" or "expired"
 * verdict. Only `lib/sends.ts` (a later story) has enough context — the
 * Arkiv entity's own state, read independently — to say "expired", and it
 * decides that before ever calling this provider.
 *
 * `NEXT_PUBLIC_CHIPOTLE_USAGE_API_KEY` is intentionally a `NEXT_PUBLIC_*`
 * variable: the story asks for walletless recipients to invoke Chipotle
 * directly from the browser under a *restricted* usage key scoped to this
 * group. The account's master key is a different thing entirely — it can
 * register actions and mint or revoke usage keys, and never appears in this
 * file, in any `NEXT_PUBLIC_*` variable, or in a commit. See `.env.example`.
 *
 * docs/stories/H-69.md's amendments, observed against the live account
 * 2026-09-12: Lit's `POST /lit_action` action cache is in memory and can
 * miss — a `code`-registered CID that was never invoked yet, or one evicted
 * by a server restart, answers `HTTP 400 No cached code found. Submit the
 * action code at least once before referencing it by IPFS ID.` rather than
 * running. `invokeActionWithCacheMissRetry` retries **exactly once**, and
 * **only** on that exact response, resubmitting with `code` set to
 * `chipotle-action-source.ts`'s bundled copy of `chipotle-action.js` — never
 * on any other 400. The retry submits exactly the registered source: this
 * adapter checks its bundled copy against `NEXT_PUBLIC_CHIPOTLE_ACTION_CID`
 * first (`ensureBundledActionSourceMatches`, via
 * `POST /get_lit_action_ipfs_id`) and refuses rather than submit code it
 * cannot confirm is the same, because a mismatch there means this build's copy
 * of the action has drifted from what is actually registered.
 *
 * What inline `code` a usage key may run is Lit's rule, and this app does not
 * verify it (review-8 F2). Lit's published API spec does not say that inline
 * `code` must match a group-permitted CID. One observation only: on
 * 2026-09-12, before the action was registered, `POST /lit_action` with
 * inline `code` and the production usage key answered `403 "The provided API
 * key is not authorized to execute the specified action (QmR32N27…/…)"`. So
 * Lit gated inline code by its CID for that key on that day. That is not a
 * guarantee this file can rely on or check.
 */

import { keccak256, stringToBytes } from "viem"
import { encodeGrantBinding, toHex } from "../crypto"
import { CHIPOTLE_ACTION_SOURCE } from "./chipotle-action-source"
import type { GrantBinding, KeyReleaseProvider, ProtectedKeyShare } from "./types"

export type ChipotleStage = "credentials" | "reachable" | "single-action" | "action-source" | "invoke"

/**
 * Every non-success outcome of this provider, named after the stage that
 * failed. There is deliberately no "denied" variant — see the module doc.
 */
export class ChipotleUnavailableError extends Error {
  readonly stage: ChipotleStage

  constructor(stage: ChipotleStage, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = "ChipotleUnavailableError"
    this.stage = stage
  }
}

export class ChipotleConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ChipotleConfigError"
  }
}

/**
 * The response shape this adapter expects back as `main`'s return value from
 * an action invocation (`LitActionResponse.response` in Lit's own schema —
 * see `createHttpChipotleClient`).
 *
 * `authorized: false` covers both "the enclave evaluated the request and
 * refused" and "the request was malformed" — this adapter does not try to
 * tell those apart from the response alone, the same refusal-vs-network-error
 * ambiguity `scripts/chipotle-live-probe.mjs` has to reason about explicitly.
 */
export type ChipotleActionResponse = {
  authorized: boolean
  /** Whatever `Lit.Actions.Encrypt`/`Decrypt` returned. Present only when `authorized` is true. */
  result?: string
  error?: string
}

/**
 * What `GET /list_actions` and `GET /list_wallets_in_group` (scoped to this
 * adapter's group) report, real data read fresh on every uncached check —
 * see `ensureSingleAuthorizedAction`.
 */
export type ChipotleGroupAuthorization = {
  /**
   * The keccak256 hash of every action CID Lit's `/list_actions` reports as
   * permitted for this group — `list_actions` returns the *hashed* CID, not
   * the raw one (`developer.litprotocol.com/management/api_direct`, "Raw CID
   * vs hashed CID"), so this adapter hashes its own configured `actionCid`
   * the same way to compare.
   */
  hashedActionCids: string[]
  /** Whether `list_wallets_in_group` reports the configured PKP as a member of this group. */
  pkpInGroup: boolean
}

/**
 * The shape of the Chipotle HTTP API this adapter calls, injectable so the
 * offline proof (`scripts/chipotle-adapter-proof.mjs`) never has to make a
 * real network call.
 */
export type ChipotleClient = {
  /** Non-destructive: proves the endpoint answers HTTP at all. */
  ping: () => Promise<void>
  /** Real data behind the single-action guarantee — see `ChipotleGroupAuthorization`. */
  getGroupAuthorization: (groupId: string) => Promise<ChipotleGroupAuthorization>
  invokeAction: (params: {
    actionCid: string
    usageApiKey: string
    jsParams: Record<string, unknown>
    /**
     * Set only for the cache-miss retry (see the module doc's amendments
     * paragraph) — everywhere else this action runs by `actionCid` alone, as
     * an `ipfs_id`, never by submitting code.
     */
    code?: string
  }) => Promise<ChipotleActionResponse>
  /**
   * `POST /get_lit_action_ipfs_id` — the CID Lit computes for a given source
   * string. Used only to confirm the bundled retry source
   * (`chipotle-action-source.ts`) is the same code registered under
   * `NEXT_PUBLIC_CHIPOTLE_ACTION_CID`, before ever submitting it — see
   * `ensureBundledActionSourceMatches`.
   */
  getActionIpfsId: (code: string) => Promise<string>
}

export type ChipotleConfig = {
  enabled: boolean
  /** IPFS CID of the immutable Lit Action published for this adapter. Run by this, never by `code`. */
  actionCid: string
  /**
   * The PKP whose TEE-derived key this adapter's action is allowed to use — its `wallet_address`
   * from `list_wallets`. Not the `id` field: a live account reports `id: "0"` for every wallet.
   */
  pkpId: string
  /** The Chipotle group scoping the usage key below — its integer id (`list_groups` shows it as 0x…01 for group 1). */
  groupId: string
  /** A restricted usage key scoped to this group — never the account's master key. */
  usageApiKey: string
}

function parseChipotleConfigFromEnv(): Partial<ChipotleConfig> {
  return {
    enabled: process.env.NEXT_PUBLIC_CHIPOTLE_ENABLED === "true",
    actionCid: process.env.NEXT_PUBLIC_CHIPOTLE_ACTION_CID ?? "",
    pkpId: process.env.NEXT_PUBLIC_CHIPOTLE_PKP_ID ?? "",
    groupId: process.env.NEXT_PUBLIC_CHIPOTLE_GROUP_ID ?? "",
    usageApiKey: process.env.NEXT_PUBLIC_CHIPOTLE_USAGE_API_KEY ?? "",
  }
}

/**
 * Resolve configuration: `NEXT_PUBLIC_CHIPOTLE_*`, overridden by `overrides`
 * (tests only — app code always calls this with no arguments).
 *
 * Unlike `readTacoConfig`, this never throws for a field that is simply
 * absent — an unconfigured account is the expected case here (see
 * `docs/stories/H-65.md`, "Credentials"), and it is classified as the named
 * `"credentials"` stage by `ensureCredentialsPresent`, not a constructor
 * failure.
 */
export function readChipotleConfig(overrides: Partial<ChipotleConfig> = {}): ChipotleConfig {
  const merged = { ...parseChipotleConfigFromEnv(), ...overrides } as ChipotleConfig
  return {
    enabled: merged.enabled ?? false,
    actionCid: merged.actionCid ?? "",
    pkpId: merged.pkpId ?? "",
    groupId: merged.groupId ?? "",
    usageApiKey: merged.usageApiKey ?? "",
  }
}

function missingCredentialVars(config: ChipotleConfig): string[] {
  const missing: string[] = []
  if (!config.actionCid) missing.push("NEXT_PUBLIC_CHIPOTLE_ACTION_CID")
  if (!config.pkpId) missing.push("NEXT_PUBLIC_CHIPOTLE_PKP_ID")
  if (!config.groupId) missing.push("NEXT_PUBLIC_CHIPOTLE_GROUP_ID")
  if (!config.usageApiKey) missing.push("NEXT_PUBLIC_CHIPOTLE_USAGE_API_KEY")
  return missing
}

/** Throws the named `"credentials"` stage error listing exactly what an operator must set. */
function ensureCredentialsPresent(config: ChipotleConfig): void {
  const missing = missingCredentialVars(config)
  if (missing.length > 0) {
    throw new ChipotleUnavailableError(
      "credentials",
      `Chipotle needs an account, usage key, group, and published action. Missing: ${missing.join(", ")}. ` +
        `Create them at developer.litprotocol.com, then set these environment variables.`,
    )
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * `list_actions` returns the keccak256 hash of each permitted action's raw
 * IPFS CID, not the CID itself — see `ChipotleGroupAuthorization`. This
 * mirrors the server's own hashing (`AccountConfig.sol`, via
 * `add_action_to_group`'s `action_ipfs_cid`): keccak256 of the CID string's
 * UTF-8 bytes.
 */
export function hashActionCid(actionCid: string): string {
  return keccak256(stringToBytes(actionCid)).toLowerCase()
}

/**
 * `developer.litprotocol.com/architecture/groups`: a group's
 * `cid_hashes_permitted` array uses the literal integer `0` as a wildcard
 * meaning "permit all actions" — a value with no corresponding registered
 * action, so it cannot be told apart from "no such action" by CID comparison
 * alone. Any hash that is numerically zero is treated as that wildcard.
 */
function isWildcardCidHash(hash: string): boolean {
  try {
    return BigInt(hash) === BigInt(0)
  } catch {
    return false
  }
}

/**
 * One promise per (groupId, pkpId, actionCid) triple, shared across provider
 * instances and calls — re-checking on every `protect`/`release` would be
 * correct but wasteful; this still re-checks per distinct configuration, so a
 * group that gains a second permitted action after this process started is
 * caught the next time a *different* configuration is used, and callers that
 * need a fresh check can `__resetChipotleAdapterStateForTests`.
 */
let singleActionCache = new Map<string, Promise<void>>()

/**
 * The adapter must refuse to operate if it cannot confirm, from real group
 * data, that exactly one action — this adapter's own — is permitted to use
 * the PKP within its group, and that the PKP actually belongs to that group.
 * A second, more permissive action permitted on the same group, or a group
 * that permits all actions via the `0` wildcard, would bypass this gate
 * entirely, so "cannot confirm" is treated the same as "confirmed false":
 * both throw.
 */
async function ensureSingleAuthorizedAction(client: ChipotleClient, config: ChipotleConfig): Promise<void> {
  const cacheKey = `${config.groupId}:${config.pkpId}:${config.actionCid}`
  let promise = singleActionCache.get(cacheKey)
  if (!promise) {
    promise = (async () => {
      let auth: ChipotleGroupAuthorization
      try {
        auth = await client.getGroupAuthorization(config.groupId)
      } catch (error) {
        throw new ChipotleUnavailableError("single-action", describeError(error), { cause: error })
      }

      if (!auth.pkpInGroup) {
        throw new ChipotleUnavailableError(
          "single-action",
          `PKP ${config.pkpId} is not a member of group ${config.groupId} — list_wallets_in_group does not report it`,
        )
      }

      if (auth.hashedActionCids.some(isWildcardCidHash)) {
        throw new ChipotleUnavailableError(
          "single-action",
          `group ${config.groupId} permits all actions (cid_hashes_permitted includes the 0 wildcard) — refusing to trust a single-action gate that does not hold`,
        )
      }

      const expectedHash = hashActionCid(config.actionCid)
      if (auth.hashedActionCids.length !== 1 || auth.hashedActionCids[0] !== expectedHash) {
        throw new ChipotleUnavailableError(
          "single-action",
          `group ${config.groupId} permits ${auth.hashedActionCids.length} action(s) (${auth.hashedActionCids.join(", ") || "none"}); ` +
            `expected exactly one, matching the configured action ${config.actionCid} (hash ${expectedHash})`,
        )
      }
    })().catch((error: unknown) => {
      singleActionCache.delete(cacheKey)
      throw error
    })
    singleActionCache.set(cacheKey, promise)
  }
  return promise
}

/**
 * Lit's own literal response body for a `POST /lit_action` submitted by
 * `ipfs_id` whose code the enclave's in-memory cache does not currently hold
 * — observed against the live account 2026-09-12, see the module doc's
 * amendments paragraph. This is the ONLY 400 this adapter ever retries; any
 * other 400 (a malformed request, a genuine refusal surfaced as an error
 * string, and so on) is not a cache miss and must not be treated as one.
 */
const CACHE_MISS_MESSAGE =
  "No cached code found. Submit the action code at least once before referencing it by IPFS ID."

function isCacheMissError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("HTTP 400") && error.message.includes(CACHE_MISS_MESSAGE)
}

/**
 * One promise per configured `actionCid`, shared across calls — the CID Lit
 * computes for a fixed source string never changes, so this needs checking
 * once per process, not once per retry. Cleared by
 * `__resetChipotleAdapterStateForTests`, same as `singleActionCache`.
 */
let bundledActionSourceCache = new Map<string, Promise<void>>()

/**
 * Before ever submitting `chipotle-action-source.ts`'s bundled copy as a
 * cache-miss retry's `code`, confirm Lit would compute the same CID for it
 * that this build is configured to trust — refusing rather than submitting
 * code that might not be the one actually registered. See the module doc's
 * amendments paragraph.
 */
async function ensureBundledActionSourceMatches(client: ChipotleClient, config: ChipotleConfig): Promise<void> {
  let promise = bundledActionSourceCache.get(config.actionCid)
  if (!promise) {
    promise = (async () => {
      let computedCid: string
      try {
        computedCid = await client.getActionIpfsId(CHIPOTLE_ACTION_SOURCE)
      } catch (error) {
        throw new ChipotleUnavailableError("action-source", describeError(error), { cause: error })
      }
      if (computedCid !== config.actionCid) {
        throw new ChipotleUnavailableError(
          "action-source",
          `The bundled chipotle-action.js source computes to CID ${computedCid}, not the configured ` +
            `NEXT_PUBLIC_CHIPOTLE_ACTION_CID (${config.actionCid}) — refusing to submit code that may not be ` +
            "the one actually registered",
        )
      }
    })().catch((error: unknown) => {
      bundledActionSourceCache.delete(config.actionCid)
      throw error
    })
    bundledActionSourceCache.set(config.actionCid, promise)
  }
  return promise
}

/**
 * Invoke the action by `ipfs_id`, and on that one exact cache-miss response —
 * never any other failure — retry exactly once with `code` set to the
 * bundled action source, after confirming that source's CID actually matches
 * what is configured. See the module doc's amendments paragraph.
 *
 * Exported so `scripts/chipotle-live-probe.mjs` exercises the same retry a
 * real `protect`/`release` call would, rather than a second, narrower copy of
 * it — a cold cache on the live account is exactly the case that probe's
 * stage 5 is most likely to hit first.
 */
export async function invokeActionWithCacheMissRetry(
  client: ChipotleClient,
  config: ChipotleConfig,
  jsParams: Record<string, unknown>,
): Promise<ChipotleActionResponse> {
  try {
    return await client.invokeAction({ actionCid: config.actionCid, usageApiKey: config.usageApiKey, jsParams })
  } catch (error) {
    if (!isCacheMissError(error)) throw error
    await ensureBundledActionSourceMatches(client, config)
    // Exactly once: this call is never itself wrapped in the same retry, so a
    // second cache-miss response here surfaces as a plain "invoke" failure
    // rather than looping.
    return client.invokeAction({
      actionCid: config.actionCid,
      usageApiKey: config.usageApiKey,
      jsParams,
      code: CHIPOTLE_ACTION_SOURCE,
    })
  }
}

/** Test-only: clears memoized single-action state between proof scenarios. Never call from app code. */
export function __resetChipotleAdapterStateForTests(): void {
  singleActionCache = new Map()
  bundledActionSourceCache = new Map()
}

/** SHA-256 of the grant binding's canonical bytes — see the module doc, failure mode 2. */
async function computeCommitment(binding: GrantBinding): Promise<string> {
  const bytes = encodeGrantBinding(binding)
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource)
  return toHex(new Uint8Array(digest))
}

/** The opaque envelope this adapter's `protect`/`release` exchange as `Uint8Array`. */
type ChipotleEnvelope = {
  v: 1
  /** Whatever `Lit.Actions.Encrypt` returned. */
  ciphertext: string
  /** SHA-256 of the grant binding this envelope was protected for. */
  commitment: string
}

function encodeEnvelope(envelope: ChipotleEnvelope): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(envelope))
}

function decodeEnvelope(bytes: Uint8Array): ChipotleEnvelope {
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes))
  } catch (error) {
    throw new ChipotleUnavailableError("invoke", "Protected share is not a readable Chipotle envelope", {
      cause: error,
    })
  }
  const envelope = parsed as Partial<ChipotleEnvelope>
  if (envelope.v !== 1 || typeof envelope.ciphertext !== "string" || typeof envelope.commitment !== "string") {
    throw new ChipotleUnavailableError("invoke", "Protected share is not a valid Chipotle envelope")
  }
  return envelope as ChipotleEnvelope
}

function toBase64(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

/**
 * `chipotle-action.js`'s `main({ pkpId, mode, ... })` reads these as its
 * single `js_params` argument. `pkpId` travels with every call because
 * `Lit.Actions.Encrypt`/`Decrypt` both take it as a parameter — Chipotle has
 * no separate top-level "which PKP" field on `POST /lit_action` itself.
 */
function bindingJsParams(binding: GrantBinding, config: ChipotleConfig): Record<string, unknown> {
  return {
    pkpId: config.pkpId,
    grantId: binding.grantId,
    owner: binding.owner,
    expiresBlock: binding.expiresBlock.toString(10),
    ref: binding.ref,
  }
}

async function protectShare(
  heldShare: Uint8Array,
  binding: GrantBinding,
  config: ChipotleConfig,
  client: ChipotleClient,
): Promise<Uint8Array> {
  if (!config.enabled) {
    throw new ChipotleUnavailableError("credentials", 'Chipotle is disabled (NEXT_PUBLIC_CHIPOTLE_ENABLED is not "true")')
  }
  ensureCredentialsPresent(config)
  await ensureSingleAuthorizedAction(client, config)

  const commitment = await computeCommitment(binding)
  let response: ChipotleActionResponse
  try {
    response = await invokeActionWithCacheMissRetry(client, config, {
      mode: "protect",
      payload: toBase64(heldShare),
      commitment,
      ...bindingJsParams(binding, config),
    })
  } catch (error) {
    if (error instanceof ChipotleUnavailableError) throw error
    throw new ChipotleUnavailableError("invoke", describeError(error), { cause: error })
  }
  if (!response.authorized || !response.result) {
    throw new ChipotleUnavailableError("invoke", response.error ?? "Chipotle action declined to protect this share")
  }

  return encodeEnvelope({ v: 1, ciphertext: response.result, commitment })
}

async function releaseShare(
  protectedShare: Uint8Array,
  binding: GrantBinding,
  config: ChipotleConfig,
  client: ChipotleClient,
): Promise<Uint8Array> {
  if (!config.enabled) {
    throw new ChipotleUnavailableError("credentials", 'Chipotle is disabled (NEXT_PUBLIC_CHIPOTLE_ENABLED is not "true")')
  }
  ensureCredentialsPresent(config)
  await ensureSingleAuthorizedAction(client, config)

  const envelope = decodeEnvelope(protectedShare)
  const expectedCommitment = await computeCommitment(binding)
  if (envelope.commitment !== expectedCommitment) {
    // The envelope was protected for a different grant. Refuse here, before
    // ever invoking the action — see the module doc, failure mode 2. The
    // action does not rely on this line: a caller that skips this adapter
    // skips it too, so the action checks the binding sealed in its ciphertext.
    throw new ChipotleUnavailableError(
      "invoke",
      "Protected share's commitment does not match the supplied grant binding — refusing a substituted grant",
    )
  }

  let response: ChipotleActionResponse
  try {
    response = await invokeActionWithCacheMissRetry(client, config, {
      mode: "release",
      ciphertext: envelope.ciphertext,
      commitment: envelope.commitment,
      ...bindingJsParams(binding, config),
    })
  } catch (error) {
    if (error instanceof ChipotleUnavailableError) throw error
    throw new ChipotleUnavailableError("invoke", describeError(error), { cause: error })
  }
  if (!response.authorized || !response.result) {
    throw new ChipotleUnavailableError("invoke", response.error ?? "Chipotle action declined to release this share")
  }

  return fromBase64(response.result)
}

export type ChipotleProviderOptions = {
  /** Test-only: replaces the real HTTP client. Never set by app code. */
  client?: ChipotleClient
  /** Test-only: overrides config normally read from `NEXT_PUBLIC_CHIPOTLE_*`. */
  config?: Partial<ChipotleConfig>
}

/**
 * Build a `KeyReleaseProvider` backed by Lit Chipotle.
 *
 * `types.ts`'s `ProtectedKeyShare.provider`/`.domain` now include `"chipotle"`
 * alongside the parked `"taco"` (H-69 widened the union that H-67 had cast
 * through `unknown` around, since real Chipotle grants must type-check
 * honestly rather than lie about their own provider — see this story's
 * report, "Choices"). `ritualId` has no Chipotle equivalent — there is no DKG
 * ritual, only one PKP — and is fixed at `0` rather than repurposed to mean
 * something else.
 */
export function createChipotleKeyReleaseProvider(options: ChipotleProviderOptions = {}): KeyReleaseProvider {
  const config = readChipotleConfig(options.config)
  const client = options.client ?? createHttpChipotleClient(config)
  const descriptor: Pick<ProtectedKeyShare, "provider" | "domain" | "ritualId"> = {
    provider: "chipotle",
    domain: "chipotle",
    ritualId: 0,
  }
  return {
    descriptor,
    protect(heldShare: Uint8Array, binding: GrantBinding) {
      return protectShare(heldShare, binding, config, client)
    },
    release(protectedShare: Uint8Array, binding: GrantBinding) {
      return releaseShare(protectedShare, binding, config, client)
    },
  }
}

export type ChipotleProbeResult = { status: "available" } | { status: "unavailable"; stage: ChipotleStage; message: string }

/**
 * A non-secret, non-destructive check of whether Chipotle infrastructure is
 * reachable and correctly configured right now. It never releases a real
 * share. It stops at the first stage that fails, exactly like
 * `probeTacoInfrastructure` — see `lib/key-release/taco.ts`.
 *
 * Finer-grained network staging (DNS resolution vs. an HTTP answer, and a
 * genuine refusal vs. a network failure for a fabricated grant) lives only in
 * `scripts/chipotle-live-probe.mjs`, which talks to the real endpoint over
 * Node's `dns` module — a browser-safe library function like this one cannot
 * do that split itself, the same reason `probeTacoInfrastructure` folds
 * coordination-RPC DNS and reachability into one "coordination" stage.
 */
export async function probeChipotleInfrastructure(
  options: Pick<ChipotleProviderOptions, "client" | "config"> = {},
): Promise<ChipotleProbeResult> {
  let config: ChipotleConfig
  try {
    config = readChipotleConfig(options.config)
  } catch (error) {
    return { status: "unavailable", stage: "credentials", message: describeError(error) }
  }

  if (!config.enabled) {
    return { status: "unavailable", stage: "credentials", message: 'Chipotle is disabled (NEXT_PUBLIC_CHIPOTLE_ENABLED is not "true")' }
  }

  try {
    ensureCredentialsPresent(config)
  } catch (error) {
    if (error instanceof ChipotleUnavailableError) return { status: "unavailable", stage: error.stage, message: error.message }
    return { status: "unavailable", stage: "credentials", message: describeError(error) }
  }

  const client = options.client ?? createHttpChipotleClient(config)
  try {
    await client.ping()
  } catch (error) {
    return { status: "unavailable", stage: "reachable", message: describeError(error) }
  }

  try {
    await ensureSingleAuthorizedAction(client, config)
  } catch (error) {
    if (error instanceof ChipotleUnavailableError) return { status: "unavailable", stage: error.stage, message: error.message }
    return { status: "unavailable", stage: "single-action", message: describeError(error) }
  }

  return { status: "available" }
}

/**
 * Lit's documented Chipotle base URL — fixed, not caller-supplied, verified
 * 2026-09-12 against `https://api.chipotle.litprotocol.com/core/v1/openapi.json`.
 * There is exactly one Chipotle service, unlike TACo's per-deployment
 * coordination RPC, so there is nothing for an env var to override.
 */
export const CHIPOTLE_API_BASE = "https://api.chipotle.litprotocol.com/core/v1"

/** A page this large is treated as "possibly truncated" — see `fetchList`. */
const LIST_PAGE_SIZE = 100

function authHeaders(apiKey: string): HeadersInit {
  return { "X-Api-Key": apiKey, "content-type": "application/json" }
}

/**
 * Every read/write endpoint responds with `oneOf [<schema>, ErrMessage]`,
 * where `ErrMessage` is a bare JSON string — so a parsed body that is a
 * string, or a non-OK HTTP status, both mean the call failed.
 */
async function callChipotle(path: string, init: RequestInit): Promise<unknown> {
  const res = await fetch(`${CHIPOTLE_API_BASE}${path}`, init)
  const body: unknown = await res.json()
  if (!res.ok || typeof body === "string") {
    throw new Error(`Chipotle ${path} failed: HTTP ${res.status}${typeof body === "string" ? ` ${body}` : ""}`)
  }
  return body
}

/**
 * `list_actions`/`list_wallets_in_group` are paginated; this adapter only
 * ever needs "the complete list, or refuse" — never a specific page — so it
 * requests one large page and refuses rather than silently truncate if the
 * result looks like it might have overflowed that page.
 */
async function fetchList(path: string, apiKey: string): Promise<Array<{ id: string; wallet_address?: string }>> {
  const body = await callChipotle(`${path}&page_number=0&page_size=${LIST_PAGE_SIZE}`, {
    method: "GET",
    headers: authHeaders(apiKey),
  })
  if (!Array.isArray(body)) throw new Error(`Chipotle ${path} returned a non-array body`)
  if (body.length >= LIST_PAGE_SIZE) {
    throw new Error(`Chipotle ${path} returned ${body.length} items — cannot confirm the full list fits on one page`)
  }
  return body as Array<{ id: string; wallet_address?: string }>
}

/**
 * The real HTTP client, speaking Lit's documented Chipotle API — see the
 * module doc's verification note. `fetch` only, deliberately: no new
 * dependency is pinned in `package.json` for this.
 */
export function createHttpChipotleClient(config: ChipotleConfig): ChipotleClient {
  return {
    async ping() {
      // GET /version needs no auth and any HTTP response — even an error
      // status — proves the endpoint is live. Only a transport failure
      // (DNS, connection, TLS, timeout) means "unreachable"; `fetch` throws
      // for those and resolves for the rest.
      await fetch(`${CHIPOTLE_API_BASE}/version`)
    },
    async getGroupAuthorization(groupId: string) {
      const [actions, wallets] = await Promise.all([
        fetchList(`/list_actions?group_id=${encodeURIComponent(groupId)}`, config.usageApiKey),
        fetchList(`/list_wallets_in_group?group_id=${encodeURIComponent(groupId)}`, config.usageApiKey),
      ])
      return {
        hashedActionCids: actions.map((action) => action.id.toLowerCase()),
        // Matched on wallet_address, not id: on a live account (2026-09-12)
        // list_wallets and list_wallets_in_group report `id: "0"` for every
        // wallet, the Account Master Wallet included, so an id match cannot
        // tell the group's wallet from the master one.
        pkpInGroup: wallets.some(
          (wallet) => wallet.wallet_address?.toLowerCase() === config.pkpId.toLowerCase(),
        ),
      }
    },
    async invokeAction({ actionCid, usageApiKey, jsParams, code }) {
      const body = await callChipotle("/lit_action", {
        method: "POST",
        headers: authHeaders(usageApiKey),
        // ipfs_id, never code, except for the cache-miss retry (`code` set) —
        // see the module doc's amendments paragraph and
        // `invokeActionWithCacheMissRetry`.
        body: JSON.stringify(code !== undefined ? { code, js_params: jsParams } : { ipfs_id: actionCid, js_params: jsParams }),
      })
      const { response, has_error, logs } = body as { response: unknown; has_error: boolean; logs: string }
      if (has_error) {
        // The action itself threw an uncaught exception rather than
        // returning `{ authorized: false, error }` — Chipotle's own crash,
        // not a considered refusal. See the module doc on never converting
        // uncertainty into a verdict.
        throw new Error(`Lit Action execution failed: ${logs || "no logs returned"}`)
      }
      return response as ChipotleActionResponse
    },
    async getActionIpfsId(code: string) {
      // Not `callChipotle`: that helper treats any bare-string response body
      // as `ErrMessage` (see its own doc comment), but this endpoint's
      // *success* response is itself a bare string — the computed CID.
      const res = await fetch(`${CHIPOTLE_API_BASE}/get_lit_action_ipfs_id`, {
        method: "POST",
        headers: authHeaders(config.usageApiKey),
        body: JSON.stringify(code),
      })
      const responseBody: unknown = await res.json()
      if (!res.ok || typeof responseBody !== "string") {
        throw new Error(
          `Chipotle /get_lit_action_ipfs_id failed: HTTP ${res.status}${
            typeof responseBody !== "string" ? ` ${JSON.stringify(responseBody)}` : ""
          }`,
        )
      }
      return responseBody
    },
  }
}
