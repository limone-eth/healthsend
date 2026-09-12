import { openScopedShare, type ScopedShare } from "./archive.ts"
import { blindAttribute } from "./crypto.ts"
import type { StoredMcpCiphertext } from "./mcp-store.ts"

const CAPABILITY_PREFIX = "hsmcp1_"
const CAPABILITY_KEY_BYTES = 32
const IV_BYTES = 12
const ENTITY_KEY_RE = /^0x[0-9a-f]{64}$/
const PSEUDONYM_RE = /^subject_[0-9a-f]{32}$/
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/
const encoder = new TextEncoder()

export type McpCapabilityEnvelope = {
  v: 1
  kind: "healthsend-mcp-capability"
  entityKey: string
  pseudonym: string
  scopedShare: ScopedShare
}

function toBase64Url(value: Uint8Array): string {
  let binary = ""
  for (const byte of value) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

function fromBase64Url(value: string): Uint8Array {
  if (!value || !BASE64URL_RE.test(value)) throw new Error("Invalid base64url")
  const padded = value.replace(/-/g, "+").replace(/_/g, "/")
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="))
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function bytesFromHex(value: string): Uint8Array {
  const hex = value.startsWith("0x") ? value.slice(2) : value
  if (hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) throw new Error("Invalid hex")
  const out = new Uint8Array(hex.length / 2)
  for (let index = 0; index < out.length; index++) {
    out[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  }
  return out
}

async function sha256(input: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", input as BufferSource))
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await sha256(encoder.encode(value))
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")
}

export function createMcpCapabilityToken(
  randomBytes: (length: number) => Uint8Array = (length) =>
    crypto.getRandomValues(new Uint8Array(length)),
): string {
  const key = randomBytes(CAPABILITY_KEY_BYTES)
  if (!(key instanceof Uint8Array) || key.length !== CAPABILITY_KEY_BYTES) {
    throw new Error("Capability randomness must provide 32 bytes")
  }
  return `${CAPABILITY_PREFIX}${toBase64Url(key)}`
}

export function capabilityKeyFromToken(token: string): Uint8Array {
  if (!token.startsWith(CAPABILITY_PREFIX)) throw new Error("Invalid MCP capability")
  const encoded = token.slice(CAPABILITY_PREFIX.length)
  if (encoded.length !== 43) throw new Error("Invalid MCP capability")
  const key = fromBase64Url(encoded)
  if (key.length !== CAPABILITY_KEY_BYTES) throw new Error("Invalid MCP capability")
  return key
}

export async function mcpCapabilityId(token: string): Promise<string> {
  capabilityKeyFromToken(token)
  return sha256Hex(token)
}

export async function mcpMintId(signature: string): Promise<string> {
  return sha256Hex(`healthsend:mcp:mint:${signature.toLowerCase()}`)
}

/**
 * Derive a distinct HMAC key from the bearer key and public grant key, then use
 * the archive's existing blindAttribute primitive over the recovered signer.
 * The stable sender address is never returned or placed in the encrypted row.
 */
export async function deriveMcpPseudonym(
  capabilityKey: Uint8Array,
  entityKey: string,
  sender: string,
): Promise<string> {
  const canonicalEntity = entityKey.toLowerCase()
  if (!ENTITY_KEY_RE.test(canonicalEntity)) throw new Error("Invalid grant entity key")

  const material = await crypto.subtle.importKey(
    "raw",
    capabilityKey as BufferSource,
    "HKDF",
    false,
    ["deriveBits"],
  )
  const pseudonymKey = new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: bytesFromHex(canonicalEntity) as BufferSource,
        info: encoder.encode("healthsend/mcp/pseudonym/v1") as BufferSource,
      },
      material,
      256,
    ),
  )
  const blinded = await blindAttribute(pseudonymKey, `mcp-subject:${sender.toLowerCase()}`)
  return `subject_${blinded}`
}

export function equalMcpPseudonym(left: string, right: string): boolean {
  if (!PSEUDONYM_RE.test(left) || !PSEUDONYM_RE.test(right) || left.length !== right.length) {
    return false
  }
  let difference = 0
  for (let index = 0; index < left.length; index++) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return difference === 0
}

function additionalData(capabilityId: string, entityKey: string): Uint8Array {
  return encoder.encode(
    `healthsend:mcp:ciphertext:v1:${capabilityId}:${entityKey.toLowerCase()}`,
  )
}

export async function encryptMcpEnvelope(
  envelope: McpCapabilityEnvelope,
  token: string,
  capabilityId: string,
): Promise<StoredMcpCiphertext> {
  const rawKey = capabilityKeyFromToken(token)
  const key = await crypto.subtle.importKey(
    "raw",
    rawKey as BufferSource,
    "AES-GCM",
    false,
    ["encrypt"],
  )
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv as BufferSource,
      additionalData: additionalData(capabilityId, envelope.entityKey) as BufferSource,
    },
    key,
    encoder.encode(JSON.stringify(envelope)) as BufferSource,
  )
  return {
    v: 1,
    entityKey: envelope.entityKey,
    iv: toBase64Url(iv),
    ciphertext: toBase64Url(new Uint8Array(ciphertext)),
  }
}

export async function decryptMcpEnvelope(
  stored: StoredMcpCiphertext,
  token: string,
  capabilityId: string,
): Promise<McpCapabilityEnvelope> {
  if (
    !stored ||
    stored.v !== 1 ||
    typeof stored.entityKey !== "string" ||
    !ENTITY_KEY_RE.test(stored.entityKey) ||
    typeof stored.iv !== "string" ||
    typeof stored.ciphertext !== "string"
  ) {
    throw new Error("Invalid encrypted MCP slice")
  }
  const iv = fromBase64Url(stored.iv)
  if (iv.length !== IV_BYTES) throw new Error("Invalid encrypted MCP slice")

  const key = await crypto.subtle.importKey(
    "raw",
    capabilityKeyFromToken(token) as BufferSource,
    "AES-GCM",
    false,
    ["decrypt"],
  )
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: iv as BufferSource,
      additionalData: additionalData(capabilityId, stored.entityKey) as BufferSource,
    },
    key,
    fromBase64Url(stored.ciphertext) as BufferSource,
  )
  const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext))
  const envelope = validateMcpEnvelope(parsed)
  if (envelope.entityKey !== stored.entityKey) throw new Error("MCP grant routing mismatch")
  return envelope
}

function validateMcpEnvelope(value: unknown): McpCapabilityEnvelope {
  if (!isObject(value)) throw new Error("Invalid MCP capability envelope")
  const allowed = new Set(["v", "kind", "entityKey", "pseudonym", "scopedShare"])
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new Error("Invalid MCP capability envelope")
  }
  if (value.v !== 1 || value.kind !== "healthsend-mcp-capability") {
    throw new Error("Invalid MCP capability envelope")
  }
  if (typeof value.entityKey !== "string" || !ENTITY_KEY_RE.test(value.entityKey)) {
    throw new Error("Invalid MCP grant entity key")
  }
  if (typeof value.pseudonym !== "string" || !PSEUDONYM_RE.test(value.pseudonym)) {
    throw new Error("Invalid MCP pseudonym")
  }

  const scopedShare = openScopedShare(encoder.encode(JSON.stringify(value.scopedShare)))
  return {
    v: 1,
    kind: "healthsend-mcp-capability",
    entityKey: value.entityKey,
    pseudonym: value.pseudonym,
    scopedShare,
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
