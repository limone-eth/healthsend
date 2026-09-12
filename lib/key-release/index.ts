/**
 * The provider-neutral key-release factory.
 *
 * `lib/sends.ts` never imports `./chipotle` or `./taco` directly — every
 * provider it needs comes from here, so the two decisions below are made in
 * exactly one place rather than at each call site:
 *
 *   - Protecting a brand-new share always goes through Chipotle. TACo is
 *     parked (operator decision, 2026-09-12 — see docs/stories/H-69.md) and
 *     this factory never selects it for new shares, regardless of
 *     `NEXT_PUBLIC_TACO_ENABLED`. Whether Chipotle itself is actually
 *     enabled and configured is `createChipotleKeyReleaseProvider`'s own
 *     concern: an unconfigured or disabled Chipotle still fails with its own
 *     named, retryable `ChipotleUnavailableError`, never a silent fallback to
 *     TACo.
 *   - Releasing an existing share is chosen by the grant's own recorded
 *     `payload.release.provider`, never by today's env — a share protected
 *     under one provider must always release through that same provider,
 *     even after the environment that protected it changes. A descriptor
 *     this build does not recognise fails closed with
 *     `UnknownKeyReleaseProviderError`, rather than guessing.
 */

import { createChipotleKeyReleaseProvider, ChipotleUnavailableError, readChipotleConfig, type ChipotleProviderOptions } from "./chipotle"
import { createTacoKeyReleaseProvider, TacoUnavailableError, type TacoProviderOptions } from "./taco"
import type { KeyReleaseProvider, ProtectedKeyShare } from "./types"

export { ChipotleUnavailableError, readChipotleConfig, TacoUnavailableError }

/** A grant names a `release.provider` this build has no adapter for. Fails closed, never guesses. */
export class UnknownKeyReleaseProviderError extends Error {
  readonly provider: string

  constructor(provider: string) {
    super(`No key-release provider is registered for "${provider}" — refusing to release through an unrecognised provider`)
    this.name = "UnknownKeyReleaseProviderError"
    this.provider = provider
  }
}

export type KeyReleaseProviderOptions = {
  chipotle?: ChipotleProviderOptions
  taco?: TacoProviderOptions
}

/**
 * The provider for a brand-new share. Always Chipotle — see the module doc.
 */
export function selectProtectingProvider(options: KeyReleaseProviderOptions = {}): KeyReleaseProvider {
  return createChipotleKeyReleaseProvider(options.chipotle)
}

/**
 * The provider that must release a share already protected under
 * `descriptor` — read from the grant's own payload, never from today's env.
 */
export function selectReleasingProvider(
  descriptor: Pick<ProtectedKeyShare, "provider">,
  options: KeyReleaseProviderOptions = {},
): KeyReleaseProvider {
  switch (descriptor.provider) {
    case "chipotle":
      return createChipotleKeyReleaseProvider(options.chipotle)
    case "taco":
      return createTacoKeyReleaseProvider(options.taco)
    default:
      throw new UnknownKeyReleaseProviderError(String(descriptor.provider))
  }
}
