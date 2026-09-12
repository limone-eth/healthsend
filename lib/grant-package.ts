/**
 * A protected grant share is two locks, not one.
 *
 * The provider's own release rule is one lock — but a grant payload is
 * public, so a capsule protected by the release rule alone lets anyone
 * collect it and wait for a release condition to relax, or for a future
 * flaw in the provider to be found. The link secret is the second lock:
 * without it, the provider's ciphertext is unreachable in the first place,
 * no matter what the release rule ever does.
 *
 * `protectGrantShare` asks the provider first, then wraps its answer under a
 * key derived from the link secret AND the grant binding (see
 * `deriveGrantPackageKey` in `lib/crypto.ts`). `releaseGrantShare` reverses
 * that order: unwrap and authenticate the binding first, then ask the
 * provider. A binding that does not match — a different grant id, owner, or
 * expiry than the one a share was protected for — fails the outer
 * authentication tag before the provider is ever called.
 */

import {
  deriveGrantPackageKey,
  encodeGrantBinding,
  fromBase64Url,
  openBound,
  sealBound,
  toBase64Url,
  IV_BYTES,
} from "./crypto"
import type { GrantBinding, KeyReleaseProvider, ProtectedKeyShare } from "./key-release/types"

const GRANT_ID_PATTERN = /^0x[0-9a-fA-F]{64}$/
const OWNER_PATTERN = /^0x[0-9a-fA-F]{40}$/
const REF_PATTERN = /^[0-9a-fA-F]{64}$/

function validateBinding(binding: GrantBinding): void {
  if (!GRANT_ID_PATTERN.test(binding.grantId)) {
    throw new Error("Invalid grant binding: grantId must be a 32-byte 0x-prefixed hex string")
  }
  if (!OWNER_PATTERN.test(binding.owner)) {
    throw new Error("Invalid grant binding: owner must be a 20-byte 0x-prefixed hex string")
  }
  if (!(binding.expiresBlock > BigInt(0))) {
    throw new Error("Invalid grant binding: expiresBlock must be a positive block number")
  }
  if (!REF_PATTERN.test(binding.ref)) {
    throw new Error("Invalid grant binding: ref must be a 32-byte hex string")
  }
}

function validateProtectedShare(
  protectedShare: ProtectedKeyShare,
  provider: KeyReleaseProvider,
): { iv: Uint8Array; ciphertext: Uint8Array } {
  if (protectedShare.provider !== provider.descriptor.provider) {
    throw new Error("Protected share names a different provider")
  }
  if (protectedShare.domain !== provider.descriptor.domain) {
    throw new Error("Protected share names a different domain")
  }
  if (protectedShare.ritualId !== provider.descriptor.ritualId) {
    throw new Error("Protected share names a different ritual")
  }
  const iv = fromBase64Url(protectedShare.iv)
  if (iv.length !== IV_BYTES) {
    throw new Error("Protected share has an invalid IV length")
  }
  const ciphertext = fromBase64Url(protectedShare.ciphertext)
  if (ciphertext.length === 0) {
    throw new Error("Protected share has empty ciphertext")
  }
  return { iv, ciphertext }
}

export async function protectGrantShare(
  heldShare: Uint8Array,
  linkSecret: Uint8Array,
  binding: GrantBinding,
  provider: KeyReleaseProvider,
): Promise<ProtectedKeyShare> {
  validateBinding(binding)
  const bindingBytes = encodeGrantBinding(binding)
  const providerBytes = await provider.protect(heldShare, binding)
  const key = await deriveGrantPackageKey(linkSecret, bindingBytes)
  const sealed = await sealBound(key, providerBytes, bindingBytes)
  return {
    ...provider.descriptor,
    iv: toBase64Url(sealed.iv),
    ciphertext: toBase64Url(sealed.ciphertext),
  }
}

export async function releaseGrantShare(
  protectedShare: ProtectedKeyShare,
  linkSecret: Uint8Array,
  binding: GrantBinding,
  provider: KeyReleaseProvider,
): Promise<Uint8Array> {
  validateBinding(binding)
  const { iv, ciphertext } = validateProtectedShare(protectedShare, provider)
  const bindingBytes = encodeGrantBinding(binding)
  const key = await deriveGrantPackageKey(linkSecret, bindingBytes)
  const providerBytes = await openBound(key, { iv, ciphertext }, bindingBytes)
  return provider.release(providerBytes, binding)
}
