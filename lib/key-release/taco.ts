/**
 * The TACo `KeyReleaseProvider` — behind an availability gate.
 *
 * TACo has no supported network today (see the repo's TACo PoC plan, "Global
 * Constraints"), so every entry point here treats that as the expected case,
 * not an exceptional one. `protect` and `release` never convert a network
 * failure, a malformed response, or plain uncertainty into a positive answer:
 * anything that is not an unambiguous success throws `TacoUnavailableError`,
 * always classified as retryable unavailability — never as "denied" or
 * "expired". Only `lib/sends.ts` (a later story) has enough context — the
 * Arkiv entity's own state — to ever say "expired", and it decides that
 * *before* calling this provider at all.
 *
 * `@nucypher/taco`'s browser (`dist/es`) build resolves directory-style ESM
 * imports the way Next.js/webpack does, not the way plain Node does — a bare
 * `node --experimental-strip-types` import of it throws
 * `ERR_UNSUPPORTED_DIR_IMPORT`. So the SDK is loaded with a *dynamic*
 * `import()` inside `loadRealSdk`, never a static top-level import: merely
 * importing this module (as a Node proof does, with an injected `sdk`) must
 * never trigger it. `ethers` and `../arkiv` have no such restriction and are
 * imported normally.
 */

import { ethers } from "ethers"
import { buildArkivGrantQuery } from "../arkiv"
import type { GrantBinding, KeyReleaseProvider, ProtectedKeyShare } from "./types"

/** The one domain this PoC supports. `ProtectedKeyShare.domain` is typed to match. */
const REQUIRED_DOMAIN = "lynx" as const

export type TacoStage = "initialize" | "coordination" | "encrypt" | "decrypt" | "porter"

/**
 * Every non-success outcome of this provider, named after the stage that
 * failed. There is deliberately no "denied" variant: Porter aggregates
 * per-node errors into one message that does not reliably distinguish "the
 * condition evaluated false" from "a node was unreachable", so claiming a
 * clean denial here would be a fabricated certainty. Fail closed instead.
 */
export class TacoUnavailableError extends Error {
  readonly stage: TacoStage

  constructor(stage: TacoStage, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = "TacoUnavailableError"
    this.stage = stage
  }
}

export class TacoConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "TacoConfigError"
  }
}

/** The shape of `@nucypher/taco`'s public API that this adapter calls. */
export type TacoSdk = {
  initialize: () => Promise<void>
  domains: { DEVNET: string; TESTNET: string; MAINNET: string }
  getPorterUris: (domain: string) => Promise<string[]>
  encrypt: (
    provider: ethers.providers.Provider,
    domain: string,
    message: Uint8Array,
    condition: unknown,
    ritualId: number,
    authSigner: ethers.Signer,
  ) => Promise<{ toBytes: () => Uint8Array }>
  decrypt: (
    provider: ethers.providers.Provider,
    domain: string,
    messageKit: unknown,
    context: undefined,
    porterUris?: string[],
  ) => Promise<Uint8Array>
  conditions: {
    base: {
      jsonRpc: {
        JsonRpcCondition: new (props: {
          endpoint: string
          method: string
          params: unknown
          query?: string
          returnValueTest: { comparator: "=="; value: string }
        }) => unknown
      }
    }
  }
  ThresholdMessageKit: { fromBytes: (bytes: Uint8Array) => unknown }
}

let realSdkPromise: Promise<TacoSdk> | null = null

/** Dynamic on purpose — see the module doc. Memoized so a page only ever loads it once. */
function loadRealSdk(): Promise<TacoSdk> {
  if (!realSdkPromise) {
    realSdkPromise = import("@nucypher/taco").then((mod) => mod as unknown as TacoSdk)
  }
  return realSdkPromise
}

export type TacoConfig = {
  enabled: boolean
  domain: "lynx"
  ritualId: number
  coordinationRpc: string
  porterUris?: string[]
}

function assertValidUrl(value: string, label: string): string {
  try {
    void new URL(value)
  } catch {
    throw new TacoConfigError(`${label} is not a valid URL: ${value}`)
  }
  return value
}

/** Best-effort parse of `NEXT_PUBLIC_TACO_*` — never throws; may be partial. */
function parseTacoConfigFromEnv(): Partial<TacoConfig> {
  const ritualIdRaw = process.env.NEXT_PUBLIC_TACO_RITUAL_ID
  const porterUrisRaw = process.env.NEXT_PUBLIC_TACO_PORTER_URIS
  const partial: Partial<TacoConfig> = {
    enabled: process.env.NEXT_PUBLIC_TACO_ENABLED === "true",
  }
  if (process.env.NEXT_PUBLIC_TACO_DOMAIN !== undefined) {
    partial.domain = process.env.NEXT_PUBLIC_TACO_DOMAIN as TacoConfig["domain"]
  }
  if (ritualIdRaw !== undefined) partial.ritualId = Number(ritualIdRaw)
  if (process.env.NEXT_PUBLIC_TACO_COORDINATION_RPC !== undefined) {
    partial.coordinationRpc = process.env.NEXT_PUBLIC_TACO_COORDINATION_RPC
  }
  if (porterUrisRaw) {
    partial.porterUris = porterUrisRaw
      .split(",")
      .map((uri) => uri.trim())
      .filter((uri) => uri.length > 0)
  }
  return partial
}

/**
 * Resolve and validate PoC configuration: `NEXT_PUBLIC_TACO_*`, overridden by
 * `overrides` (tests only — app code always calls this with no arguments).
 */
export function readTacoConfig(overrides: Partial<TacoConfig> = {}): TacoConfig {
  const merged = { ...parseTacoConfigFromEnv(), ...overrides }
  const domain = merged.domain ?? REQUIRED_DOMAIN
  if (domain !== REQUIRED_DOMAIN) {
    throw new TacoConfigError(`Unsupported NEXT_PUBLIC_TACO_DOMAIN "${domain}" — only "${REQUIRED_DOMAIN}" is supported`)
  }

  if (typeof merged.ritualId !== "number" || !Number.isInteger(merged.ritualId) || merged.ritualId < 0) {
    throw new TacoConfigError("NEXT_PUBLIC_TACO_RITUAL_ID must be set to a non-negative integer")
  }

  if (!merged.coordinationRpc) {
    throw new TacoConfigError("NEXT_PUBLIC_TACO_COORDINATION_RPC is required")
  }
  assertValidUrl(merged.coordinationRpc, "NEXT_PUBLIC_TACO_COORDINATION_RPC")

  return {
    enabled: merged.enabled ?? false,
    domain: REQUIRED_DOMAIN,
    ritualId: merged.ritualId,
    coordinationRpc: merged.coordinationRpc,
    porterUris: merged.porterUris,
  }
}

export type TacoProviderOptions = {
  /**
   * The sender's own signing key, used only to authorize an `encrypt` call —
   * never persisted, never part of `ProtectedKeyShare`. Required for
   * `protect`; `release` never needs a signer.
   */
  signerPrivateKey?: `0x${string}`
  /** Test-only: replaces the dynamically-loaded real SDK. Never set by app code. */
  sdk?: TacoSdk
  /** Test-only: overrides config normally read from `NEXT_PUBLIC_TACO_*`. */
  config?: Partial<TacoConfig>
}

/**
 * One promise for the process, shared by every provider instance — not one
 * per instance. TACo's own `initialize()` sets up its WASM module once;
 * calling it again per provider would be wasted work at best.
 */
let sharedInitPromise: Promise<void> | null = null

async function ensureInitialized(sdk: TacoSdk): Promise<void> {
  if (!sharedInitPromise) {
    sharedInitPromise = sdk.initialize().catch((error: unknown) => {
      sharedInitPromise = null
      throw new TacoUnavailableError("initialize", describeError(error), { cause: error })
    })
  }
  return sharedInitPromise
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Test-only: clears memoized SDK/init state between proof scenarios. Never call from app code. */
export function __resetTacoAdapterStateForTests(): void {
  realSdkPromise = null
  sharedInitPromise = null
}

async function protectShare(
  heldShare: Uint8Array,
  binding: GrantBinding,
  config: TacoConfig,
  options: TacoProviderOptions,
): Promise<Uint8Array> {
  if (!config.enabled) {
    throw new TacoUnavailableError("initialize", "TACo is disabled (NEXT_PUBLIC_TACO_ENABLED is not \"true\")")
  }
  if (!options.signerPrivateKey) {
    throw new TacoUnavailableError("initialize", "TACo protect requires a signer private key")
  }

  const sdk = options.sdk ?? (await loadRealSdk().catch((error: unknown) => {
    throw new TacoUnavailableError("initialize", describeError(error), { cause: error })
  }))
  await ensureInitialized(sdk)

  const request = buildArkivGrantQuery(binding)
  const condition = new sdk.conditions.base.jsonRpc.JsonRpcCondition({
    endpoint: request.endpoint,
    method: request.method,
    params: request.params,
    query: request.query,
    returnValueTest: { comparator: "==", value: request.expected },
  })

  const rpcProvider = new ethers.providers.JsonRpcProvider(config.coordinationRpc)
  const signer = new ethers.Wallet(options.signerPrivateKey, rpcProvider)

  try {
    const messageKit = await sdk.encrypt(rpcProvider, sdk.domains.DEVNET, heldShare, condition, config.ritualId, signer)
    return messageKit.toBytes()
  } catch (error) {
    throw new TacoUnavailableError("encrypt", describeError(error), { cause: error })
  }
}

async function releaseShare(
  protectedShare: Uint8Array,
  config: TacoConfig,
  options: TacoProviderOptions,
): Promise<Uint8Array> {
  if (!config.enabled) {
    throw new TacoUnavailableError("initialize", "TACo is disabled (NEXT_PUBLIC_TACO_ENABLED is not \"true\")")
  }

  const sdk = options.sdk ?? (await loadRealSdk().catch((error: unknown) => {
    throw new TacoUnavailableError("initialize", describeError(error), { cause: error })
  }))
  await ensureInitialized(sdk)

  let restored: unknown
  try {
    restored = sdk.ThresholdMessageKit.fromBytes(protectedShare)
  } catch (error) {
    throw new TacoUnavailableError("decrypt", describeError(error), { cause: error })
  }

  const rpcProvider = new ethers.providers.JsonRpcProvider(config.coordinationRpc)

  try {
    // No caller-selected condition and no historical block: the condition
    // that gates this release is the one baked into `restored` at encrypt
    // time, evaluated against Arkiv's *current* state by each node itself.
    return await sdk.decrypt(rpcProvider, sdk.domains.DEVNET, restored, undefined, config.porterUris)
  } catch (error) {
    throw new TacoUnavailableError("decrypt", describeError(error), { cause: error })
  }
}

/**
 * Build a `KeyReleaseProvider` backed by TACo.
 *
 * `release` never reads its `binding` argument — see `releaseShare` — so this
 * implementation omits the parameter; TypeScript still accepts it as a
 * `KeyReleaseProvider.release`, which callers may invoke with one.
 */
export function createTacoKeyReleaseProvider(options: TacoProviderOptions = {}): KeyReleaseProvider {
  const config: TacoConfig = readTacoConfig(options.config)
  const descriptor: Pick<ProtectedKeyShare, "provider" | "domain" | "ritualId"> = {
    provider: "taco",
    domain: config.domain,
    ritualId: config.ritualId,
  }
  return {
    descriptor,
    protect(heldShare: Uint8Array, binding: GrantBinding) {
      return protectShare(heldShare, binding, config, options)
    },
    release(protectedShare: Uint8Array) {
      return releaseShare(protectedShare, config, options)
    },
  }
}

export type TacoProbeResult =
  | { status: "available"; domain: "lynx"; ritualId: number }
  | { status: "unavailable"; stage: "initialize" | "coordination" | "encrypt" | "porter"; message: string }

/**
 * A non-secret, non-destructive check of whether TACo infrastructure is
 * reachable right now. It never releases anything and never touches a real
 * grant: the held share, signer, and condition it uses are all disposable,
 * generated fresh for this call and discarded after.
 *
 * A pass here proves the DKG ritual is retrievable and the Porter cohort's
 * URIs resolve — the two things a real `protect`/`release` call needs. It
 * does not prove a full threshold release: that additionally needs a live
 * grant bound to real Arkiv state, which this function deliberately does not
 * create.
 */
export async function probeTacoInfrastructure(
  options: Pick<TacoProviderOptions, "sdk" | "config"> = {},
): Promise<TacoProbeResult> {
  let config: TacoConfig
  try {
    config = readTacoConfig(options.config)
  } catch (error) {
    return { status: "unavailable", stage: "initialize", message: describeError(error) }
  }

  if (!config.enabled) {
    return {
      status: "unavailable",
      stage: "initialize",
      message: "TACo is disabled (NEXT_PUBLIC_TACO_ENABLED is not \"true\")",
    }
  }

  let sdk: TacoSdk
  try {
    sdk = options.sdk ?? (await loadRealSdk())
  } catch (error) {
    return { status: "unavailable", stage: "initialize", message: describeError(error) }
  }

  try {
    await ensureInitialized(sdk)
  } catch (error) {
    return { status: "unavailable", stage: "initialize", message: describeError(error) }
  }

  const rpcProvider = new ethers.providers.JsonRpcProvider(config.coordinationRpc)
  try {
    await rpcProvider.getNetwork()
  } catch (error) {
    return { status: "unavailable", stage: "coordination", message: describeError(error) }
  }

  const disposableShare = new Uint8Array(32)
  crypto.getRandomValues(disposableShare)
  const disposableSigner = ethers.Wallet.createRandom().connect(rpcProvider)
  const disposableCondition = new sdk.conditions.base.jsonRpc.JsonRpcCondition({
    endpoint: config.coordinationRpc,
    method: "eth_blockNumber",
    params: [],
    returnValueTest: { comparator: "==", value: "0x0" },
  })
  try {
    await sdk.encrypt(rpcProvider, sdk.domains.DEVNET, disposableShare, disposableCondition, config.ritualId, disposableSigner)
  } catch (error) {
    return { status: "unavailable", stage: "encrypt", message: describeError(error) }
  }

  try {
    await sdk.getPorterUris(config.domain)
  } catch (error) {
    return { status: "unavailable", stage: "porter", message: describeError(error) }
  }

  return { status: "available", domain: config.domain, ritualId: config.ritualId }
}
