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
 * Two failure modes are specific to Chipotle and have no TACo analogue:
 *
 *   1. A single immutable Lit Action gates both `protect` and `release` on
 *      this adapter's PKP. If a *second*, more permissive action were ever
 *      authorized against the same PKP, it would bypass this gate entirely —
 *      the PKP does not care which authorized action asked it to sign or
 *      decrypt. `ensureSingleAuthorizedAction` checks this on every call and
 *      refuses to operate rather than assume it still holds.
 *   2. Unlike TACo, where the release condition is baked into the capsule at
 *      encrypt time and the network evaluates it unprompted, Chipotle's public
 *      API takes the grant identity as a plain argument to the action
 *      invocation. A caller could supply the ciphertext from an expired grant
 *      alongside the `binding` of a still-live one, and an action that only
 *      checks "is the *supplied* grant live" would release it. This adapter
 *      closes that gap itself: `protectShare` embeds a commitment — a SHA-256
 *      of the grant binding's canonical bytes, `lib/crypto.ts`'s
 *      `encodeGrantBinding` — inside the envelope it returns. `releaseShare`
 *      recomputes that commitment from the caller's `binding` and refuses
 *      before ever invoking the action if the two disagree. The Lit Action
 *      source (`chipotle-action.js`, alongside this file) performs the same
 *      check again, server-side, inside the enclave, because this adapter's
 *      own TypeScript is not a trust boundary — anyone with the endpoint, the
 *      action CID, and a usage key can invoke the action directly, bypassing
 *      this file entirely.
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
 * mint and revoke usage keys, and never appears in this file, in any
 * `NEXT_PUBLIC_*` variable, or in a commit. See `.env.example`.
 */

import { encodeGrantBinding, toHex } from "../crypto"
import type { GrantBinding, KeyReleaseProvider } from "./types"

export type ChipotleStage = "credentials" | "reachable" | "single-action" | "invoke"

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
 * The response shape this adapter expects back from an action invocation.
 *
 * `authorized: false` covers both "the enclave evaluated the request and
 * refused" and "the request was malformed" — this adapter does not try to
 * tell those apart from the response alone, the same refusal-vs-network-error
 * ambiguity `scripts/chipotle-live-probe.mjs` has to reason about explicitly.
 */
export type ChipotleActionResponse = {
  authorized: boolean
  /** Base64. Present only when `authorized` is true. */
  result?: string
  error?: string
}

/**
 * The shape of the Chipotle HTTP API this adapter calls, injectable so the
 * offline proof (`scripts/chipotle-adapter-proof.mjs`) never has to make a
 * real network call.
 *
 * The wire format `createHttpChipotleClient` speaks below is this adapter's
 * own placeholder for what the research (`docs/research/threshold-expiry-alternatives.md`,
 * "Lit: separate the products and trust models") describes only as "plain
 * HTTP invocation" — this session had no network access to confirm the
 * current request/response schema against `developer.litprotocol.com`, and
 * building against a guessed schema is exactly the kind of URL/API guessing
 * this repo's own rules refuse to do. Confirm and adjust
 * `createHttpChipotleClient` once real credentials exist; the live probe
 * documents this as a named blocker rather than a silent assumption. Every
 * property this adapter is responsible for — commitment binding, expiry
 * refusal, the single-action guarantee, fail-closed error handling — is
 * proved offline against this interface regardless of the real wire shape.
 */
export type ChipotleClient = {
  /** Non-destructive: proves the endpoint answers HTTP at all. */
  ping: () => Promise<void>
  /** The action CIDs currently authorized to use this PKP. */
  listAuthorizedActions: (pkpPublicKey: string) => Promise<string[]>
  invokeAction: (params: {
    actionCid: string
    pkpPublicKey: string
    usageApiKey: string
    jsParams: Record<string, unknown>
  }) => Promise<ChipotleActionResponse>
}

export type ChipotleConfig = {
  enabled: boolean
  /** The Chipotle network's HTTPS base URL. No verified default exists — see the module doc. */
  endpoint: string
  /** IPFS CID of the immutable Lit Action published for this adapter. */
  actionCid: string
  /** The PKP whose TEE-derived key this adapter's action is allowed to use. */
  pkpPublicKey: string
  /** A restricted usage key scoped to this group — never the account's master key. */
  usageApiKey: string
}

function parseChipotleConfigFromEnv(): Partial<ChipotleConfig> {
  return {
    enabled: process.env.NEXT_PUBLIC_CHIPOTLE_ENABLED === "true",
    endpoint: process.env.NEXT_PUBLIC_CHIPOTLE_ENDPOINT ?? "",
    actionCid: process.env.NEXT_PUBLIC_CHIPOTLE_ACTION_CID ?? "",
    pkpPublicKey: process.env.NEXT_PUBLIC_CHIPOTLE_PKP_PUBLIC_KEY ?? "",
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
 * failure. It still throws `ChipotleConfigError` for a value that is present
 * but malformed, because that is a code or deployment bug, not a missing
 * account.
 */
export function readChipotleConfig(overrides: Partial<ChipotleConfig> = {}): ChipotleConfig {
  const merged = { ...parseChipotleConfigFromEnv(), ...overrides } as ChipotleConfig

  if (merged.endpoint) {
    let url: URL
    try {
      url = new URL(merged.endpoint)
    } catch {
      throw new ChipotleConfigError(`NEXT_PUBLIC_CHIPOTLE_ENDPOINT is not a valid URL: ${merged.endpoint}`)
    }
    if (url.protocol !== "https:") {
      throw new ChipotleConfigError(`NEXT_PUBLIC_CHIPOTLE_ENDPOINT must be HTTPS, got ${url.protocol}`)
    }
  }

  return {
    enabled: merged.enabled ?? false,
    endpoint: merged.endpoint ?? "",
    actionCid: merged.actionCid ?? "",
    pkpPublicKey: merged.pkpPublicKey ?? "",
    usageApiKey: merged.usageApiKey ?? "",
  }
}

function missingCredentialVars(config: ChipotleConfig): string[] {
  const missing: string[] = []
  if (!config.endpoint) missing.push("NEXT_PUBLIC_CHIPOTLE_ENDPOINT")
  if (!config.actionCid) missing.push("NEXT_PUBLIC_CHIPOTLE_ACTION_CID")
  if (!config.pkpPublicKey) missing.push("NEXT_PUBLIC_CHIPOTLE_PKP_PUBLIC_KEY")
  if (!config.usageApiKey) missing.push("NEXT_PUBLIC_CHIPOTLE_USAGE_API_KEY")
  return missing
}

/** Throws the named `"credentials"` stage error listing exactly what an operator must set. */
function ensureCredentialsPresent(config: ChipotleConfig): void {
  const missing = missingCredentialVars(config)
  if (missing.length > 0) {
    throw new ChipotleUnavailableError(
      "credentials",
      `Chipotle needs an account, usage key, and published action. Missing: ${missing.join(", ")}. ` +
        `Create them at developer.litprotocol.com, then set these environment variables.`,
    )
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * One promise per (pkpPublicKey, actionCid) pair, shared across provider
 * instances and calls — re-checking on every `protect`/`release` would be
 * correct but wasteful; this still re-checks per distinct configuration, so a
 * PKP that gains a second authorized action after this process started is
 * caught the next time a *different* configuration is used, and callers that
 * need a fresh check can `__resetChipotleAdapterStateForTests`.
 */
let singleActionCache = new Map<string, Promise<void>>()

/**
 * The adapter must refuse to operate if it cannot confirm that exactly one
 * action — this adapter's own — is authorized to use the PKP. A second,
 * more permissive decrypt action allowed on the same PKP would bypass this
 * gate entirely, so "cannot confirm" is treated the same as "confirmed
 * false": both throw.
 */
async function ensureSingleAuthorizedAction(client: ChipotleClient, config: ChipotleConfig): Promise<void> {
  const cacheKey = `${config.pkpPublicKey}:${config.actionCid}`
  let promise = singleActionCache.get(cacheKey)
  if (!promise) {
    promise = (async () => {
      let actions: string[]
      try {
        actions = await client.listAuthorizedActions(config.pkpPublicKey)
      } catch (error) {
        throw new ChipotleUnavailableError("single-action", describeError(error), { cause: error })
      }
      if (actions.length !== 1 || actions[0] !== config.actionCid) {
        throw new ChipotleUnavailableError(
          "single-action",
          `PKP ${config.pkpPublicKey} authorizes ${actions.length} action(s) (${actions.join(", ") || "none"}); ` +
            `expected exactly one, matching the configured action ${config.actionCid}`,
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

/** Test-only: clears memoized single-action state between proof scenarios. Never call from app code. */
export function __resetChipotleAdapterStateForTests(): void {
  singleActionCache = new Map()
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
  /** Base64 of whatever the action returned as ciphertext. */
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

function bindingJsParams(binding: GrantBinding): Record<string, unknown> {
  return {
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
    response = await client.invokeAction({
      actionCid: config.actionCid,
      pkpPublicKey: config.pkpPublicKey,
      usageApiKey: config.usageApiKey,
      jsParams: { mode: "protect", payload: toBase64(heldShare), commitment, ...bindingJsParams(binding) },
    })
  } catch (error) {
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
    // action re-checks this same commitment independently, because a caller
    // that skips this adapter entirely would skip this line too.
    throw new ChipotleUnavailableError(
      "invoke",
      "Protected share's commitment does not match the supplied grant binding — refusing a substituted grant",
    )
  }

  let response: ChipotleActionResponse
  try {
    response = await client.invokeAction({
      actionCid: config.actionCid,
      pkpPublicKey: config.pkpPublicKey,
      usageApiKey: config.usageApiKey,
      jsParams: {
        mode: "release",
        ciphertext: envelope.ciphertext,
        commitment: envelope.commitment,
        ...bindingJsParams(binding),
      },
    })
  } catch (error) {
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
 * `types.ts`'s `ProtectedKeyShare.provider`/`.domain` are literal `"taco"` /
 * `"lynx"` — written before a second provider existed, and out of scope for
 * this story to widen (`docs/stories/H-65.md`: "implement it, do not change
 * it"). This adapter's real `descriptor` names `"chipotle"` honestly at
 * runtime; the cast below only tells the type checker to trust that, the
 * same way it would once `types.ts` is generalized to a real union. See this
 * story's report, "Choices", for why a cast rather than a `types.ts` edit.
 * `ritualId` has no Chipotle equivalent — there is no DKG ritual, only one
 * PKP — and is fixed at `0` rather than repurposed to mean something else.
 */
export function createChipotleKeyReleaseProvider(options: ChipotleProviderOptions = {}): KeyReleaseProvider {
  const config = readChipotleConfig(options.config)
  const client = options.client ?? createHttpChipotleClient(config)
  const descriptor = { provider: "chipotle", domain: "chipotle", ritualId: 0 } as unknown as KeyReleaseProvider["descriptor"]
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
 * The real HTTP client. Speaks the placeholder wire format documented on
 * `ChipotleClient` above — unverified against live Lit docs in this session.
 * `fetch` only, deliberately: no new dependency is pinned in `package.json`
 * for this, since no real package name or version could be confirmed without
 * network access, and guessing one would be worse than depending on the
 * platform's own `fetch`.
 */
export function createHttpChipotleClient(config: ChipotleConfig): ChipotleClient {
  function authHeaders(): HeadersInit {
    return { authorization: `Bearer ${config.usageApiKey}`, "content-type": "application/json" }
  }

  return {
    async ping() {
      // Any HTTP response — even an error status — proves the endpoint is
      // live. Only a transport failure (DNS, connection, TLS, timeout) means
      // "unreachable"; `fetch` throws for those and resolves for the rest.
      await fetch(config.endpoint, { method: "GET" })
    },
    async listAuthorizedActions(pkpPublicKey: string) {
      const res = await fetch(`${config.endpoint}/pkps/${encodeURIComponent(pkpPublicKey)}/actions`, {
        method: "GET",
        headers: authHeaders(),
      })
      if (!res.ok) throw new Error(`Chipotle rejected the authorized-actions lookup: HTTP ${res.status}`)
      const body = (await res.json()) as { actions?: string[] }
      return body.actions ?? []
    },
    async invokeAction({ actionCid, pkpPublicKey, usageApiKey, jsParams }) {
      const res = await fetch(`${config.endpoint}/actions/${encodeURIComponent(actionCid)}/execute`, {
        method: "POST",
        headers: { authorization: `Bearer ${usageApiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ pkpPublicKey, jsParams }),
      })
      if (!res.ok) throw new Error(`Chipotle rejected the action invocation: HTTP ${res.status}`)
      return (await res.json()) as ChipotleActionResponse
    },
  }
}
