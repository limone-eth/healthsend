/**
 * The key-release boundary.
 *
 * A `KeyReleaseProvider` is the only thing above it that ever changes. TACo
 * has no supported network today, so nothing in this file may name it, or
 * anything else about it, beyond the string literal `"taco"` that a real
 * implementation will one day supply as its `descriptor.provider`. Swapping
 * the mechanism means writing a new provider, not touching a caller.
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
  provider: "taco"
  domain: "lynx"
  ritualId: number
  iv: string
  ciphertext: string
}

export interface KeyReleaseProvider {
  readonly descriptor: Pick<ProtectedKeyShare, "provider" | "domain" | "ritualId">
  protect(heldShare: Uint8Array, binding: GrantBinding): Promise<Uint8Array>
  release(protectedShare: Uint8Array, binding: GrantBinding): Promise<Uint8Array>
}
