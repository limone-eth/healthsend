/**
 * Client-side crypto for HealthSend.
 *
 * The whole expiry guarantee lives here, so it is worth stating the shape plainly:
 *
 *   1. Each upload gets a fresh random Content Encryption Key (CEK). The file is
 *      encrypted under it with AES-256-GCM and only the ciphertext goes to Swarm.
 *   2. Each share gets a fresh random Link Secret (S). S never leaves the browser
 *      except inside the URL fragment, which is not sent to any server.
 *   3. The CEK is wrapped under a key derived from S and written into the Arkiv
 *      grant entity, which carries an expiry.
 *
 * Reading therefore needs BOTH halves: S (from the link) and the wrapped CEK
 * (from Arkiv). Neither half is useful alone, and that much is true.
 *
 * What is NOT true — and was asserted here until we tested it — is that expiry
 * destroys the key. Arkiv entities are created by transactions and the payload
 * rides in the calldata, so pruning removes the entity from the live query
 * surface and nothing else. The wrapped CEK stays public and permanent, and
 * whoever holds S can decrypt for as long as the Swarm blob survives.
 *
 * So the honest statement of this scheme: it makes the ciphertext useless to
 * anyone without the fragment, and it ends availability for every ordinary
 * reader at T. It is not erasure. See README, "What expiry does and does not
 * do", and scripts/payload-survives.mjs, which demonstrates the recovery.
 */

const KEY_BYTES = 32
export const IV_BYTES = 12

/**
 * Entropy in the link secret, in bytes.
 *
 * 16 bytes — 128 bits — and this is a floor rather than a preference. The auth
 * commitment is written to a public chain, so anyone can grind candidate link
 * secrets offline and compare hashes. At 128 bits that is infeasible forever; at
 * 64 it would be a weekend. The derived shares stay a full 32 bytes either way,
 * because HKDF expands — what is bounded here is the guessing space, not the key.
 */
const LINK_SECRET_BYTES = 16
const HKDF_INFO = "healthsend/grant/v1"
const INFO_SHARE = "healthsend/share/v1"
const INFO_AUTH = "healthsend/auth/v1"

export function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length)
  crypto.getRandomValues(out)
  return out
}

/** URL-safe base64, no padding — this travels in a URL fragment. */
export function toBase64Url(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

export function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/")
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="))
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
}

/** A fresh content key. One per uploaded file; never reused across shares. */
export function generateContentKey(): Uint8Array {
  return randomBytes(KEY_BYTES)
}

/** A fresh link secret. This is the half that travels in the URL fragment. */
export function generateLinkSecret(): Uint8Array {
  return randomBytes(LINK_SECRET_BYTES)
}

async function importAesKey(raw: Uint8Array, usages: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, usages)
}

export type Sealed = {
  /** AES-GCM nonce, 12 bytes. */
  iv: Uint8Array
  /** Ciphertext with the GCM tag appended, as WebCrypto returns it. */
  ciphertext: Uint8Array
}

export async function seal(keyRaw: Uint8Array, plaintext: Uint8Array): Promise<Sealed> {
  const iv = randomBytes(IV_BYTES)
  const key = await importAesKey(keyRaw, ["encrypt"])
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    plaintext as BufferSource,
  )
  return { iv, ciphertext: new Uint8Array(ciphertext) }
}

export async function open(keyRaw: Uint8Array, sealed: Sealed): Promise<Uint8Array> {
  const key = await importAesKey(keyRaw, ["decrypt"])
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: sealed.iv as BufferSource },
    key,
    sealed.ciphertext as BufferSource,
  )
  return new Uint8Array(plaintext)
}

/**
 * Derive the key-wrapping key from the link secret.
 *
 * The Swarm reference is used as the HKDF salt so a wrapped CEK is bound to the
 * exact blob it belongs to — a wrapped key lifted from one grant cannot be
 * replayed against another blob.
 */
export async function deriveWrappingKey(
  linkSecret: Uint8Array,
  swarmReference: string,
): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey("raw", linkSecret as BufferSource, "HKDF", false, [
    "deriveBits",
  ])
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new TextEncoder().encode(swarmReference) as BufferSource,
      info: new TextEncoder().encode(HKDF_INFO) as BufferSource,
    },
    material,
    KEY_BYTES * 8,
  )
  return new Uint8Array(bits)
}

/** Wrap the content key for storage in the (public) Arkiv grant. */
export async function wrapContentKey(
  contentKey: Uint8Array,
  linkSecret: Uint8Array,
  swarmReference: string,
): Promise<Sealed> {
  return seal(await deriveWrappingKey(linkSecret, swarmReference), contentKey)
}

export async function unwrapContentKey(
  wrapped: Sealed,
  linkSecret: Uint8Array,
  swarmReference: string,
): Promise<Uint8Array> {
  return open(await deriveWrappingKey(linkSecret, swarmReference), wrapped)
}

/**
 * Keyed, opaque attribute value.
 *
 * Arkiv attributes are publicly queryable, so nothing semantic goes in them in
 * the clear. HMAC preserves equality lookups (we only ever query our own data)
 * while leaving the index meaningless to everyone else.
 */
export async function blindAttribute(secret: Uint8Array, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    secret as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value) as BufferSource)
  return toHex(new Uint8Array(mac).slice(0, 16))
}


/* ------------------------------------------------------------------------- *
 * Split keys — the design that actually expires
 *
 * The scheme above publishes the wrapped content key, and a public chain never
 * forgets, so it cannot expire. This one never publishes key material at all.
 *
 *   contentKey = shareLink XOR shareHeld
 *
 * `shareLink` is derived from the link secret in the URL fragment. `shareHeld`
 * is given to a holder that deletes it, and hands it back only while Arkiv says
 * the grant is still live. Neither half is anywhere public, so there is nothing
 * for calldata to preserve.
 *
 * The Arkiv entity carries a *commitment* — a hash of the auth key — which is
 * exactly the role Arkiv's own documentation describes for an index: the thing
 * that lets you check a claim without storing the secret behind it.
 * ------------------------------------------------------------------------- */

async function deriveFromLinkSecret(linkSecret: Uint8Array, info: string): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey("raw", linkSecret as BufferSource, "HKDF", false, [
    "deriveBits",
  ])
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0) as BufferSource,
      info: new TextEncoder().encode(info) as BufferSource,
    },
    material,
    KEY_BYTES * 8,
  )
  return new Uint8Array(bits)
}

function xor(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length !== b.length) throw new Error("Shares must be the same length")
  const out = new Uint8Array(a.length)
  for (let i = 0; i < a.length; i++) out[i] = a[i] ^ b[i]
  return out
}

/** The recipient's half, derived from the fragment. Never transmitted. */
export function deriveLinkShare(linkSecret: Uint8Array): Promise<Uint8Array> {
  return deriveFromLinkSecret(linkSecret, INFO_SHARE)
}

/**
 * The key that proves the caller holds the link.
 *
 * Sent to the holder, which compares its hash against the commitment in the
 * Arkiv entity. Deliberately a *different* derivation from the share: the holder
 * learns this value and must still be unable to decrypt anything.
 */
export function deriveAuthKey(linkSecret: Uint8Array): Promise<Uint8Array> {
  return deriveFromLinkSecret(linkSecret, INFO_AUTH)
}

/** What goes in the Arkiv entity. Public, permanent, and reveals nothing. */
export async function authCommitment(authKey: Uint8Array): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", authKey as BufferSource)))
}

/** Split a content key so that neither half is ever published. */
export async function splitContentKey(
  contentKey: Uint8Array,
  linkSecret: Uint8Array,
): Promise<{ heldShare: Uint8Array; authKey: Uint8Array; commitment: string }> {
  const linkShare = await deriveLinkShare(linkSecret)
  const authKey = await deriveAuthKey(linkSecret)
  return {
    heldShare: xor(contentKey, linkShare),
    authKey,
    commitment: await authCommitment(authKey),
  }
}

/** Put it back together. Needs the fragment AND the holder's half. */
export async function joinContentKey(
  heldShare: Uint8Array,
  linkSecret: Uint8Array,
): Promise<Uint8Array> {
  return xor(heldShare, await deriveLinkShare(linkSecret))
}


/* ------------------------------------------------------------------------- *
 * Entity keys in URLs
 *
 * An Arkiv entity key is 32 bytes. Written as hex it costs 66 characters; the
 * same bytes in base64url cost 43. Nothing is lost — it is the same value in a
 * denser alphabet — and a link people paste into WhatsApp is shorter for it.
 * ------------------------------------------------------------------------- */

/* ------------------------------------------------------------------------- *
 * Grant packages — binding a held share to one grant, not just one link
 *
 * `splitContentKey` above binds a share to the link secret. A threshold
 * release adds a second, independent thing to bind to: the grant itself —
 * its random id, its native Arkiv owner, its original native expiry block.
 * `encodeGrantBinding` is that binding's canonical byte form.
 *
 * It is used twice, for two different reasons. As the HKDF salt in
 * `deriveGrantPackageKey`, it makes the outer wrapping key itself specific to
 * this grant, so the same link secret produces unrelated keys for two
 * different grants. As the AEAD additional data in `sealBound`/`openBound`,
 * it makes the ciphertext's authentication tag depend on the binding, so a
 * caller cannot present the ciphertext of a live grant alongside a different
 * grant's id, owner, or expiry and have it verify — that substitution fails
 * at the tag check, before any release logic runs.
 * ------------------------------------------------------------------------- */

const INFO_GRANT_PACKAGE = "healthsend/grant-package/v1"

/** Canonical bytes for a grant binding — never serialize the object directly. */
export function encodeGrantBinding(binding: {
  grantId: string
  owner: string
  expiresBlock: bigint
  ref: string
}): Uint8Array {
  return new TextEncoder().encode(
    [
      "healthsend",
      "grant-binding",
      "v1",
      binding.grantId.toLowerCase(),
      binding.owner.toLowerCase(),
      binding.expiresBlock.toString(10),
      binding.ref.toLowerCase(),
    ].join("\n"),
  )
}

/** The outer wrapping key for a grant package, specific to link secret AND binding. */
export async function deriveGrantPackageKey(
  secret: Uint8Array,
  bindingBytes: Uint8Array,
): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey("raw", secret as BufferSource, "HKDF", false, [
    "deriveBits",
  ])
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: bindingBytes as BufferSource,
      info: new TextEncoder().encode(INFO_GRANT_PACKAGE) as BufferSource,
    },
    material,
    KEY_BYTES * 8,
  )
  return new Uint8Array(bits)
}

/** Like `seal`, but authenticates `additionalData` without encrypting it. */
export async function sealBound(
  keyRaw: Uint8Array,
  plaintext: Uint8Array,
  additionalData: Uint8Array,
): Promise<Sealed> {
  const iv = randomBytes(IV_BYTES)
  const key = await importAesKey(keyRaw, ["encrypt"])
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource, additionalData: additionalData as BufferSource },
    key,
    plaintext as BufferSource,
  )
  return { iv, ciphertext: new Uint8Array(ciphertext) }
}

/** Like `open`, but rejects unless `additionalData` matches what was sealed. */
export async function openBound(
  keyRaw: Uint8Array,
  sealed: Sealed,
  additionalData: Uint8Array,
): Promise<Uint8Array> {
  const key = await importAesKey(keyRaw, ["decrypt"])
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: sealed.iv as BufferSource, additionalData: additionalData as BufferSource },
    key,
    sealed.ciphertext as BufferSource,
  )
  return new Uint8Array(plaintext)
}

/** `0x…` hex to the short form used in share links. */
export function packEntityKey(entityKeyHex: string): string {
  const hex = entityKeyHex.startsWith("0x") ? entityKeyHex.slice(2) : entityKeyHex
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return toBase64Url(bytes)
}

/**
 * Back to `0x…` hex.
 *
 * Accepts the hex form too, so links created before the short form still open.
 */
export function unpackEntityKey(value: string): string {
  if (/^0x[0-9a-fA-F]{64}$/.test(value)) return value.toLowerCase()
  const bytes = fromBase64Url(value)
  if (bytes.length !== 32) throw new Error("Not an entity key")
  return `0x${toHex(bytes)}`
}
