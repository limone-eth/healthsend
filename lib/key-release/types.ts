/**
 * The key-release boundary.
 *
 * A `KeyReleaseProvider` is the only thing above it that ever changes. H-69
 * added Chipotle as a second, real implementation alongside the parked TACo
 * one, so `ProtectedKeyShare.provider`/`.domain` now name both literally
 * rather than casting a second provider's descriptor through `unknown` to
 * fit a union of one (H-67's stopgap — see `docs/stories/H-67.md`, "Choices").
 * Swapping the mechanism still means writing a new provider, not touching a
 * caller; adding one means widening this union, not the caller either.
 *
 * `GrantBinding` is what a release is gated on: a specific grant, not a
 * general permission. `ProtectedKeyShare` is what a provider hands back —
 * opaque to every caller except that same provider.
 */

export type GrantBinding = {
  grantId: `0x${string}`
  owner: `0x${string}`
  expiresBlock: bigint
  ref: string
}

export type ProtectedKeyShare = {
  provider: "taco" | "chipotle"
  domain: "lynx" | "chipotle"
  ritualId: number
  iv: string
  ciphertext: string
}

export interface KeyReleaseProvider {
  readonly descriptor: Pick<ProtectedKeyShare, "provider" | "domain" | "ritualId">
  protect(heldShare: Uint8Array, binding: GrantBinding): Promise<Uint8Array>
  release(protectedShare: Uint8Array, binding: GrantBinding): Promise<Uint8Array>
}
