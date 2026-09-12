import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { registerHooks } from "node:module"
import { fileURLToPath } from "node:url"
import path from "node:path"

/**
 * H-64's required evidence, run offline: the same real `createSendFromArchive`
 * `app/(sender)/new/page.tsx` calls, carrying two already-archived PDF
 * fixtures through packing, a fresh content key, encryption and a Swarm
 * upload, then decrypted back exactly as a recipient would — the same shape
 * `scripts/send-path-proof.mjs` already proves for `createSend`.
 *
 * `createSendFromArchive` talks to the same three things that script cannot
 * reach headlessly (Swarm ID, Arkiv, Swarm) and is stubbed at the same seam.
 * Nothing about packing, sealing or splitting the key is stubbed.
 */

process.env.NODE_ENV ??= "test"

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (error) {
      const extensionless = specifier.startsWith(".")
      if (!extensionless || /\.[cm]?[jt]sx?$/.test(specifier)) throw error
      return nextResolve(`${specifier}.ts`, context)
    }
  },
})

// `createSendFromArchive` reads `window.location.origin` to build the share URL.
globalThis.window = { location: { origin: "http://localhost:3100" } }

let uploadCount = 0
const uploadedBlobs = []
let capturedShare = null

const { generatePrivateKey, privateKeyToAccount } = await import("viem/accounts")
const privateKey = generatePrivateKey()
const identity = {
  privateKey,
  address: privateKeyToAccount(privateKey).address,
  blindKey: crypto.getRandomValues(new Uint8Array(32)),
  archiveKey: crypto.getRandomValues(new Uint8Array(32)),
  archiveTopic: crypto.getRandomValues(new Uint8Array(32)),
}
async function getIdentity() {
  return identity
}
async function uploadEncryptedBlob(bytes) {
  uploadCount += 1
  uploadedBlobs.push(bytes)
  return { reference: `fake-swarm-reference-${uploadCount}` }
}
async function createGrant(params) {
  return {
    entityKey: "0x" + String(uploadCount).padStart(2, "0").repeat(32).slice(0, 64),
    txHash: "0x" + "22".repeat(32),
    expiresBlock: 1_000_500,
    expiresAt: Math.floor(Date.now() / 1000) + params.ttlSeconds,
  }
}
// `ensureFunded` (lib/identity.ts) calls the module-global `fetch` directly
// rather than through `createSendFromArchive`'s dependency overrides, so the
// stub is installed on `globalThis` — the same seam `send-path-proof.mjs` uses.
globalThis.fetch = async (url, init) => {
  const requestPath = String(url)
  if (requestPath === "/api/fund") {
    return new Response(JSON.stringify({ funded: true }), { status: 200 })
  }
  if (requestPath === "/api/holder/share") {
    if ((init?.method ?? "GET") === "GET") {
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }
    capturedShare = JSON.parse(init.body)
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  }
  throw new Error(`archive-send-proof does not stub fetch for ${requestPath}`)
}

const { createSendFromArchive } = await import("../lib/sends.ts")
const { fromBase64Url, joinContentKey, open, toBase64Url } = await import("../lib/crypto.ts")
const { unpackEnvelope } = await import("../lib/envelope.ts")

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures")
function loadPdfDocument(name) {
  const bytes = new Uint8Array(readFileSync(path.join(fixturesDir, name)))
  return {
    record: {
      id: `record:${name}`,
      kind: "document",
      name,
      size: bytes.length,
      provenance: { sourceId: `source:${name}`, importedAt: new Date().toISOString() },
      bytes: toBase64Url(bytes),
    },
    rawBytes: bytes,
  }
}

// Two PDFs already sitting in the sender's archive (H-63) — one with a
// clinical identifier printed on it, so the proof below can show that
// identifier surviving intact rather than being set aside.
const patientSummary = loadPdfDocument("patient-summary.pdf")
const thyroidPanel = loadPdfDocument("thyroid-panel.pdf")

async function shareAndDecrypt(document, rawBytes) {
  const uploadsBefore = uploadCount
  const result = await createSendFromArchive(
    { documents: [document], recipientLabel: "recipient", ttlSeconds: 3600 },
    { getIdentity, uploadEncryptedBlob, createGrant },
  )

  assert.equal(uploadCount, uploadsBefore + 1, "sharing one archived document must upload exactly once")
  assert.ok(capturedShare, "createSendFromArchive must hand a key share to the holder")

  const fragment = result.url.split("#")[1]
  const linkSecret = fromBase64Url(fragment)
  const heldShare = fromBase64Url(capturedShare.share)
  const contentKey = await joinContentKey(heldShare, linkSecret)

  // The operator's model: a brand-new share key seals the bundle, never the
  // archive key that opened the documents.
  assert.notEqual(
    Buffer.from(contentKey).toString("hex"),
    Buffer.from(identity.archiveKey).toString("hex"),
    "the content key sealing this send must not be the archive key",
  )
  assert.ok(
    !JSON.stringify(capturedShare).includes(toBase64Url(identity.archiveKey)),
    "the archive key must never reach the holder handoff",
  )

  const blob = uploadedBlobs.at(-1)
  const IV_BYTES = 12
  const envelope = await open(contentKey, { iv: blob.subarray(0, IV_BYTES), ciphertext: blob.subarray(IV_BYTES) })
  const files = unpackEnvelope(envelope)

  assert.equal(files.length, 1, "a one-document share must carry exactly one file")
  const [file] = files
  assert.equal(file.header.name, document.name)
  assert.equal(file.header.mime, "application/pdf", "an archived document must travel as application/pdf")
  assert.equal(
    Buffer.from(file.body).toString("hex"),
    Buffer.from(rawBytes).toString("hex"),
    "the recipient must receive the exact PDF bytes, not a cleaned or converted copy",
  )
  assert.deepEqual(result.setAside, [], "a document send has nothing set aside to report")

  return { result, decryptedText: Buffer.from(file.body).toString("latin1") }
}

const first = await shareAndDecrypt(patientSummary.record, patientSummary.rawBytes)

// H-62's consequence, made concrete: identifiers printed on the PDF are not
// stripped — they reach the recipient's bytes exactly as issued.
for (const identifier of ["Jane Rivera", "1988-03-14", "44 Birch Lane", "552391"]) {
  assert.ok(
    first.decryptedText.includes(identifier),
    `an identifier printed on the PDF must survive into the recipient bytes: ${identifier}`,
  )
}

const uploadsBeforeSecond = uploadCount
const second = await shareAndDecrypt(thyroidPanel.record, thyroidPanel.rawBytes)

// The story's own evidence: sharing the *other* archived PDF to a second
// link costs exactly one more upload — the sealed bundle — never a second
// upload of the first document, and never a re-upload of the archive itself.
assert.equal(uploadCount, uploadsBeforeSecond + 1)
assert.equal(uploadCount, 2, "two one-document shares must cost exactly two uploads total, never more")
assert.notEqual(first.result.url, second.result.url, "each share gets its own link")
assert.notEqual(first.result.entityKey, second.result.entityKey, "each share gets its own grant")

console.log("PASS  createSendFromArchive uploads exactly once per share, the sealed bundle only")
console.log("PASS  a document travels as application/pdf with its bytes byte-for-byte unchanged")
console.log("PASS  identifiers printed on the PDF reach the recipient — the H-62 consequence, made true")
console.log("PASS  the content key is fresh per share and the archive key never reaches the holder")
console.log("\nArchive send-path proof passed.")
