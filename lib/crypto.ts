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
 * (from Arkiv). When the grant expires, Arkiv stops serving it, the wrapped CEK
 * is gone from the query surface, and the ciphertext sitting on Swarm is noise
 * even to someone who kept the link. Expiry is key destruction, not a policy
 * check we are trusted to run.
 *
 * Arkiv entities are public, which is exactly why the wrapped CEK is safe to put
 * there: without S it is undistinguishable from random.
 */

const KEY_BYTES = 32
const IV_BYTES = 12
const HKDF_INFO = "healthsend/grant/v1"

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
  return randomBytes(KEY_BYTES)
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
