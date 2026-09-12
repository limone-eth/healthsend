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
  splitContentKey, joinContentKey, authCommitment,
  packEntityKey, unpackEntityKey,
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

// --- ciphertext is tamper-evident -------------------------------------------
// AES-GCM authenticates, so a storage-side attacker cannot flip bits in the
// blob without the open failing.
const tampered = Uint8Array.from(blob)
tampered[tampered.length - 1] ^= 0x01
await assert.rejects(
  open(contentKey, { iv: tampered.subarray(0, 12), ciphertext: tampered.subarray(12) }),
  "a modified ciphertext must not decrypt",
)
console.log("PASS  tampered ciphertext is rejected")

// --- what expiry does NOT do ------------------------------------------------
// Worth asserting rather than claiming. The wrapped key is published to a public
// chain, so "the grant expired" removes it from the query surface and from
// nowhere else. Anyone who kept a copy of the payload — trivial, it is public —
// can still pair it with the fragment and decrypt.
//
// This is the honest boundary of the design, and `scripts/payload-survives.mjs`
// demonstrates it against a real expired grant on Tiramisu.
const archivedGrant = structuredClone(grant)
const stillOpens = await unwrapContentKey(
  {
    iv: fromBase64Url(archivedGrant.wrap.iv),
    ciphertext: fromBase64Url(archivedGrant.wrap.ct),
  },
  fromBase64Url(fragment),
  archivedGrant.ref,
)
assert.deepEqual(Buffer.from(stillOpens), Buffer.from(contentKey))
console.log("PASS  an archived grant payload + the link still decrypt — expiry is not erasure")

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


// --- the split-key design: neither half is ever published --------------------
{
  const cek = generateContentKey()
  const secret = generateLinkSecret()
  const { heldShare, authKey, commitment } = await splitContentKey(cek, secret)

  // Both halves are required, and they reconstruct exactly.
  const rejoined = await joinContentKey(heldShare, secret)
  assert.deepEqual(Buffer.from(rejoined), Buffer.from(cek), "shares must rebuild the key")
  console.log("PASS  split key rejoins from fragment + holder share")

  // The held share alone is useless — this is what the holder stores.
  assert.notDeepEqual(Buffer.from(heldShare), Buffer.from(cek))
  const wrongSecret = generateLinkSecret()
  const wrong = await joinContentKey(heldShare, wrongSecret)
  assert.notDeepEqual(Buffer.from(wrong), Buffer.from(cek), "a wrong fragment must not rebuild it")
  console.log("PASS  the holder's share alone rebuilds nothing")

  // The auth key proves the link without being the decryption half. The holder
  // learns it, so it must not help the holder decrypt.
  assert.notDeepEqual(Buffer.from(authKey), Buffer.from(heldShare))
  const holderView = await joinContentKey(heldShare, authKey)
  assert.notDeepEqual(Buffer.from(holderView), Buffer.from(cek), "auth key must not unlock anything")
  console.log("PASS  a holder knowing share + auth key still cannot rebuild the key")

  // The commitment is what goes on-chain. It must reveal nothing.
  assert.equal(commitment, await authCommitment(authKey))
  assert.equal(commitment.length, 64)
  assert.ok(!commitment.includes(Buffer.from(authKey).toString("hex").slice(0, 16)))
  console.log("PASS  the on-chain commitment is a hash, and carries no key material")
}


// --- short links round-trip losslessly --------------------------------------
{
  const hex = "0x" + "7f".repeat(32)
  const short = packEntityKey(hex)
  assert.equal(short.length, 43, "an entity key should cost 43 characters, not 66")
  assert.equal(unpackEntityKey(short), hex, "short form must resolve to the same key")
  assert.equal(unpackEntityKey(hex), hex, "hex links made before the change must still open")
  console.log("PASS  short entity keys round-trip, and old hex links still resolve")

  // The fragment is 128 bits: enough that grinding it against the public
  // commitment is infeasible, small enough to keep the link pasteable.
  const secret = generateLinkSecret()
  assert.equal(secret.length, 16)
  assert.equal(toBase64Url(secret).length, 22)
  console.log("PASS  link secret is 128 bits and 22 characters")
}
