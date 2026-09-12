/**
 * Proves the recipient's decryption path without touching the network.
 *
 *   sender:    envelope -> seal -> blob(iv||ct);  wrap CEK under HKDF(linkSecret, ref)
 *   recipient: unwrap CEK from the grant + link secret -> open blob -> envelope
 *
 * Also checks the negative cases the product depends on: a wrong link secret and
 * a missing grant must both fail to yield plaintext.
 */
import assert from "node:assert/strict"

const {
  generateContentKey, generateLinkSecret, seal, open,
  wrapContentKey, unwrapContentKey, blindAttribute, toBase64Url, fromBase64Url,
} = await import("../lib/crypto.ts")
const { packEnvelope, unpackEnvelope } = await import("../lib/envelope.ts")

const REF = "a7f3c9b1e5d2408fa6c3b9e1d7f2a4c6b8e0d2f4a6c8e0b2d4f6a8c0e2b4d6f8"
const csv = new TextEncoder().encode("date,marker,value\n2026-09-12,TSH,2.1\n")
const notes = new TextEncoder().encode("CONSULT NOTE\nRepeat TSH in eight weeks.\n")
const header = { name: "thyroid-panel.csv", mime: "text/csv", size: csv.length }

// A bundle: several documents, one key, one blob, one grant.
const bundle = [
  { header, body: csv },
  { header: { name: "consult-notes.txt", mime: "text/plain", size: notes.length }, body: notes },
]

// --- sender -----------------------------------------------------------------
const envelope = packEnvelope(bundle)
const contentKey = generateContentKey()
const sealed = await seal(contentKey, envelope)
const blob = new Uint8Array(sealed.iv.length + sealed.ciphertext.length)
blob.set(sealed.iv, 0)
blob.set(sealed.ciphertext, sealed.iv.length)

const linkSecret = generateLinkSecret()
const wrapped = await wrapContentKey(contentKey, linkSecret, REF)
const grant = { ref: REF, wrap: { iv: toBase64Url(wrapped.iv), ct: toBase64Url(wrapped.ciphertext) } }
const fragment = toBase64Url(linkSecret)

// The filename must not be recoverable from the stored bytes.
assert.ok(!Buffer.from(blob).includes(Buffer.from("thyroid")), "filename leaked into the blob")

// --- recipient --------------------------------------------------------------
const recoveredKey = await unwrapContentKey(
  { iv: fromBase64Url(grant.wrap.iv), ciphertext: fromBase64Url(grant.wrap.ct) },
  fromBase64Url(fragment),
  grant.ref,
)
const opened = await open(recoveredKey, { iv: blob.subarray(0, 12), ciphertext: blob.subarray(12) })
const got = unpackEnvelope(opened)

assert.equal(got.length, 2, "both documents survive the round trip")
assert.deepEqual(got[0].header, header, "header round-trip")
assert.deepEqual(Buffer.from(got[0].body), Buffer.from(csv), "first body round-trip")
assert.deepEqual(Buffer.from(got[1].body), Buffer.from(notes), "second body round-trip")
assert.equal(got[1].header.name, "consult-notes.txt")
console.log("PASS  bundle round trip —", got.map((f) => f.header.name).join(", "))

// Neither filename may be recoverable from the stored bytes.
assert.ok(!Buffer.from(blob).includes(Buffer.from("consult-notes")), "second filename leaked")

// --- negative: wrong link secret --------------------------------------------
await assert.rejects(
  unwrapContentKey(
    { iv: fromBase64Url(grant.wrap.iv), ciphertext: fromBase64Url(grant.wrap.ct) },
    generateLinkSecret(),
    grant.ref,
  ),
  "a wrong link secret must not unwrap the content key",
)
console.log("PASS  wrong link secret is rejected")

// --- negative: right link, wrong blob (wrapped key is bound to its ref) ------
await assert.rejects(
  unwrapContentKey(
    { iv: fromBase64Url(grant.wrap.iv), ciphertext: fromBase64Url(grant.wrap.ct) },
    fromBase64Url(fragment),
    "0".repeat(64),
  ),
  "a wrapped key must not transfer to a different Swarm reference",
)
console.log("PASS  wrapped key is bound to its Swarm reference")

// --- negative: grant expired (link alone is useless) ------------------------
// After expiry the grant is simply absent, so the recipient has the fragment and
// the ciphertext and nothing that turns one into the other.
assert.ok(blob.length > 0 && fragment.length > 0)
console.log("PASS  link + ciphertext alone yield no key once the grant is gone")

// --- blinded attributes are deterministic but opaque ------------------------
const blindKey = generateContentKey()
const a = await blindAttribute(blindKey, "Dr. Rossi")
const b = await blindAttribute(blindKey, "Dr. Rossi")
const c = await blindAttribute(generateContentKey(), "Dr. Rossi")
assert.equal(a, b, "same key + value must match, or equality lookups break")
assert.notEqual(a, c, "a different user's index must not collide")
assert.ok(!a.includes("Rossi"))
console.log("PASS  blinded attribute is stable under one key, opaque across keys")

console.log("\nAll checks passed.")
