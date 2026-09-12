import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { registerHooks } from "node:module"
import { fileURLToPath } from "node:url"
import path from "node:path"

// `lib/sends.ts` imports its siblings the way Next resolves them — extensionless,
// under bundler resolution. Node's strip-types runner does neither on its own; this
// gives it the one resolution rule this file's imports actually need. Same hook as
// `scripts/confirm-end-proof.mjs`.
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

/**
 * H-36's required evidence: not another unit proof against `importDocument`
 * directly (that is `verify:deident`, and it already passed while the send
 * path ignored it entirely) but the real `createSend` — the same function
 * `app/(sender)/new/page.tsx` calls — carrying a fixture through import,
 * scoping, encryption and a Swarm upload, then decrypted back exactly as a
 * recipient would.
 *
 * `createSend` talks to three things this script cannot reach headlessly:
 * Swarm ID (browser-only WebAuthn), Arkiv (a funded chain write) and Swarm
 * itself. Those three are stubbed at the same seam the Playwright recipient
 * tests stub them at (`e2e/helpers/network.ts`) — network and identity, never
 * the crypto or the import/scope logic under test, which all run for real.
 */

process.env.NODE_ENV ??= "test"

// `createSend` reads `window.location.origin` to build the share URL — the
// one browser global it touches that a Node process does not have.
globalThis.window = { location: { origin: "http://localhost:3100" } }

let capturedBlob = null
let capturedShare = null

globalThis.fetch = async (url, init) => {
  const requestPath = String(url)
  const body = init?.body ? JSON.parse(init.body) : {}

  if (requestPath === "/api/fund") {
    return new Response(JSON.stringify({ funded: true }), { status: 200 })
  }
  if (requestPath === "/api/holder/share") {
    // `preflightHolder` probes with an empty body first and expects 400 —
    // see lib/sends.ts.
    if (!body.entityKey) return new Response(JSON.stringify({ error: "empty" }), { status: 400 })
    capturedShare = body
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  }
  throw new Error(`send-path-proof does not stub fetch for ${requestPath}`)
}

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
  capturedBlob = bytes
  return { reference: "fake-swarm-reference" }
}
async function createGrant() {
  return {
    entityKey: "0x" + "11".repeat(32),
    txHash: "0x" + "22".repeat(32),
    expiresBlock: 1_000_500,
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  }
}

// Imported only after the stubs above are in place, so `createSend`'s module-
// level `fetch` default binds to the mock rather than a real network call.
const { createSend } = await import("../lib/sends.ts")
const { fromBase64Url, joinContentKey, open } = await import("../lib/crypto.ts")
const { unpackEnvelope } = await import("../lib/envelope.ts")
const { openScopedShare } = await import("../lib/archive.ts")

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures")
function loadFixture(name, type) {
  const bytes = readFileSync(path.join(fixturesDir, name))
  return new File([bytes], name, { type })
}

// Two files picked for this send. `thyroid-panel.csv` is deliberately never
// included — its markers (Free T3, TPO antibodies, …) stand in for "a file
// the sender did not select", and none of them may appear anywhere in what
// the recipient receives.
const patientPanel = loadFixture("patient-panel.csv", "text/csv")
const letterheadReport = loadFixture("letterhead-report.txt", "text/plain")

const result = await createSend(
  {
    files: [patientPanel, letterheadReport],
    recipientLabel: "recipient",
    ttlSeconds: 3600,
    accountName: "Jordan Vance",
  },
  { getIdentity, uploadEncryptedBlob, createGrant },
)

assert.ok(capturedBlob, "createSend must upload a blob")
assert.ok(capturedShare, "createSend must hand a key share to the holder")

// Decrypt exactly as a recipient would: `openSend` (lib/sends.ts) joins the
// link secret from the URL fragment with the holder's share, then opens the
// blob that was actually uploaded to (mock) Swarm.
const fragment = result.url.split("#")[1]
const linkSecret = fromBase64Url(fragment)
const heldShare = fromBase64Url(capturedShare.share)
const contentKey = await joinContentKey(heldShare, linkSecret)
const IV_BYTES = 12
const envelope = await open(contentKey, {
  iv: capturedBlob.subarray(0, IV_BYTES),
  ciphertext: capturedBlob.subarray(IV_BYTES),
})
const files = unpackEnvelope(envelope)

assert.equal(files.length, 2, "the bundle must carry both included files, and only them")

const recipientText = files.map((f) => Buffer.from(f.body).toString("latin1")).join("\n")

// R2-001 / the operator's model: the recipient must never see the original
// file. A blood panel arrives as a scoped share of its readings.
const panelFile = files.find((f) => f.header.name === "patient-panel.json")
assert.ok(panelFile, "a recognized blood panel must be packed as a scoped share, not the original CSV")
assert.equal(panelFile.header.mime, "application/json")
const share = openScopedShare(panelFile.body)
assert.equal(share.records.length, 1)
assert.equal(share.records[0].kind, "blood-panel")
assert.equal(share.records[0].markers.length, 5, "every marker in the selected file must survive scoping")
assert.ok(!("provenance" in share.records[0]), "a scoped share must drop provenance entirely")

const reportFile = files.find((f) => f.header.name === "letterhead-report.txt")
assert.ok(reportFile, "a plain document must survive as cleaned text")
assert.equal(reportFile.header.mime, "text/plain")

// The identifiers R2-001 named, scanned across every byte that reached
// Swarm — not just the file each one came from, so a leak into the *other*
// packed file would still be caught.
for (const identifier of ["Priya", "Anand", "1991-11-02", "883217", "Cedar Court", "Leyton"]) {
  assert.ok(!recipientText.includes(identifier), `identifier leaked into recipient bytes: ${identifier}`)
}
// The account name, caught only because it was threaded through as
// `accountName` (H-28's field, given its first caller here).
assert.ok(!recipientText.includes("Jordan Vance"), "the sender's account name leaked into recipient bytes")

// The file never included in this send. If any of its markers show up, the
// whole file leaked in regardless of what the sender ticked.
for (const unselected of ["TPO antibodies", "Free T3", "Homocysteine"]) {
  assert.ok(
    !recipientText.includes(unselected),
    `a marker from an unselected file leaked into recipient bytes: ${unselected}`,
  )
}

// What the sender is shown: enough to know something was set aside, and
// what — never sent, but returned so a caller can surface it (DESIGN.md
// "Your name and date of birth stay with you").
assert.equal(result.setAside.length, 2, "both files had something to set aside")
const panelSetAside = result.setAside.find((entry) => entry.fileName === "patient-panel.csv")
assert.equal(panelSetAside.setAside.name, "Priya Anand")
assert.equal(panelSetAside.setAside.dateOfBirth, "1991-11-02")
const reportSetAside = result.setAside.find((entry) => entry.fileName === "letterhead-report.txt")
assert.equal(reportSetAside.setAside.name, "Jordan Vance")

console.log("PASS  createSend routes uploads through importDocument and scopeArchive")
console.log("PASS  identifiers and an unselected file's markers are absent from the uploaded blob")
console.log("PASS  what was set aside is returned for the sender to see")
console.log("\nSend-path proof passed.")
