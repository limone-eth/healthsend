/**
 * A working share, built with the real split-key primitives.
 *
 * This does the same three steps `createSend` does (lib/sends.ts), by hand: seal
 * an envelope under a fresh content key, split the key between a link secret and
 * a held share, and keep the pieces the test needs to play sender, Arkiv, the
 * holder and the Swarm gateway. If the split-key scheme in lib/crypto.ts changes
 * shape, this breaks instead of quietly testing a stale format.
 */
import {
  generateContentKey,
  generateLinkSecret,
  seal,
  splitContentKey,
  toBase64Url,
  packEntityKey,
} from "@/lib/crypto"
import { packEnvelope, type PackedFile } from "@/lib/envelope"

export type ShareFile = { name: string; text: string }

export type ShareFixture = {
  /** The `0x`-prefixed 32-byte Arkiv entity key, as the app's own format expects. */
  entityKeyHex: string
  /** The short base64url form that goes in the URL path, as `createSend` builds it. */
  packedKey: string
  /** The link secret, base64url, as it travels in the URL fragment. */
  fragment: string
  /** The Swarm content hash the (fake) grant points at. */
  reference: string
  /** `iv || ciphertext`, exactly what the Swarm gateway would serve. */
  blob: Uint8Array
  /** The holder's half of the content key, base64url, as `/api/holder/unlock` would answer. */
  heldShare: string
  /** SHA-256 of the auth key — what the grant's `authCommitment` carries. */
  commitment: string
  currentBlock: number
  expiresBlock: number
  files: ShareFile[]
}

const CSV = "marker,value,unit\nTSH,4.82,mIU/L\nFree T4,0.91,ng/dL\n"
const NOTES = "CONSULT NOTE\nRepeat TSH in eight weeks.\n"

export async function buildShareFixture(): Promise<ShareFixture> {
  const encoder = new TextEncoder()
  const files: ShareFile[] = [
    { name: "thyroid-panel.csv", text: CSV },
    { name: "consult-notes.txt", text: NOTES },
  ]
  const packed: PackedFile[] = files.map((f) => ({
    header: { name: f.name, mime: f.name.endsWith(".csv") ? "text/csv" : "text/plain", size: encoder.encode(f.text).length },
    body: encoder.encode(f.text),
  }))

  const envelope = packEnvelope(packed)
  const contentKey = generateContentKey()
  const sealed = await seal(contentKey, envelope)
  const blob = new Uint8Array(sealed.iv.length + sealed.ciphertext.length)
  blob.set(sealed.iv, 0)
  blob.set(sealed.ciphertext, sealed.iv.length)

  const linkSecret = generateLinkSecret()
  const { heldShare, commitment } = await splitContentKey(contentKey, linkSecret)

  const entityKeyHex = "0x" + "7a".repeat(32)
  const currentBlock = 1_000_000

  return {
    entityKeyHex,
    packedKey: packEntityKey(entityKeyHex),
    fragment: toBase64Url(linkSecret),
    reference: "5c".repeat(32),
    blob,
    heldShare: toBase64Url(heldShare),
    commitment,
    currentBlock,
    expiresBlock: currentBlock + 500, // ~1000s out at the nominal 2s block time
    files,
  }
}
