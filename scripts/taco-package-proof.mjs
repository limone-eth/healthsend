/**
 * Proves the grant-package boundary without any network or TACo import.
 *
 * A fake provider stands in for TACo: it records exactly what binding it was
 * given, and a `live` flag lets the test flip its release condition from
 * "grants" to "refuses" the way an expired Arkiv grant would. This proves
 * four things: the binding recorded by the provider is the one that was
 * passed in; a package built for one grant cannot be opened against another;
 * an expired (refused) release yields nothing; and none of this touches
 * localStorage, sessionStorage, IndexedDB, or any cache — there is none of
 * that available in this Node script, which is itself the point: the whole
 * path runs on plain Uint8Arrays in process memory.
 */
import assert from "node:assert/strict"
import { registerHooks } from "node:module"

// Next resolves extensionless TypeScript imports. Node's strip-types runner does
// not, so this proof gives it the one resolution rule the application uses.
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (error) {
      if (!specifier.startsWith(".") || /\.[cm]?[jt]sx?$/.test(specifier)) throw error
      return nextResolve(`${specifier}.ts`, context)
    }
  },
})

const { generateContentKey, generateLinkSecret, splitContentKey, joinContentKey } =
  await import("../lib/crypto.ts")
const { protectGrantShare, releaseGrantShare } = await import("../lib/grant-package.ts")

const ref = "ab".repeat(32)
const owner = `0x${"12".repeat(20)}`
const grantId = `0x${"34".repeat(32)}`
const binding = { grantId, owner, expiresBlock: 900n, ref }
const cek = generateContentKey()
const secret = generateLinkSecret()
const { heldShare } = await splitContentKey(cek, secret)

let live = true
let recordedProtectBinding
let recordedReleaseBinding
const provider = {
  descriptor: { provider: "taco", domain: "lynx", ritualId: 27 },
  async protect(share, received) {
    recordedProtectBinding = received
    return Uint8Array.from(share, (byte) => byte ^ 0xa5)
  },
  async release(ciphertext, received) {
    recordedReleaseBinding = received
    if (!live) throw new Error("grant condition failed")
    return Uint8Array.from(ciphertext, (byte) => byte ^ 0xa5)
  },
}

const protectedShare = await protectGrantShare(heldShare, secret, binding, provider)
assert.deepEqual(recordedProtectBinding, binding, "the provider must see exactly the binding it was given")
console.log("PASS  provider.protect is called with the recorded binding")

assert.ok(
  !Buffer.from(protectedShare.ciphertext, "base64url").includes(Buffer.from(heldShare)),
  "the held share must not appear in the outer ciphertext",
)
console.log("PASS  the held share does not appear in the protected package")

const releasedShare = await releaseGrantShare(protectedShare, secret, binding, provider)
assert.deepEqual(recordedReleaseBinding, binding, "release must present the same binding to the provider")
assert.deepEqual(
  Buffer.from(await joinContentKey(releasedShare, secret)),
  Buffer.from(cek),
  "a live release must reconstruct the exact content key",
)
console.log("PASS  a live release round-trips to the original content key")

const otherGrantBinding = { ...binding, grantId: `0x${"56".repeat(32)}` }
await assert.rejects(
  releaseGrantShare(protectedShare, secret, otherGrantBinding, provider),
  "a package built for one grant must not open against a different grant",
)
console.log("PASS  a package cannot be opened against a different grant")

live = false
await assert.rejects(
  releaseGrantShare(protectedShare, secret, binding, provider),
  /condition failed/,
  "an expired grant's release must yield nothing, even with the correct binding",
)
console.log("PASS  an expired release is refused")

// No persistence surface exists in this Node script to begin with — the
// held share, protected package, and released share above lived only as
// local Uint8Array/string values. Assert that explicitly, so a future
// change to this proof (or to a browser caller copying its shape) cannot
// silently start writing to one without the assertion catching it.
for (const api of ["localStorage", "sessionStorage", "indexedDB", "caches"]) {
  assert.equal(typeof globalThis[api], "undefined", `${api} must not be touched by this path`)
}
console.log("PASS  no browser persistence API was available or used")

console.log("\nAll checks passed.")
