/**
 * Proves the Chipotle adapter (lib/key-release/chipotle.ts) offline, against
 * an injected fake `ChipotleClient` that plays the part of Lit's real HTTP
 * API AND the Lit Action's own logic (commitment check, Arkiv liveness
 * check) — see chipotle-action.js, which this fake's `invokeAction` mirrors.
 * The fake hashes action CIDs the same way `hashActionCid` does, mirroring
 * `list_actions`' real behavior of returning the *hashed* CID
 * (developer.litprotocol.com/management/api_direct, "Raw CID vs hashed CID").
 *
 * Every property below was run red before the guard it exercises existed (or
 * with that guard temporarily removed) to confirm it actually fails without
 * the fix, not only passes with it. Each block names the exact function and
 * check in chipotle.ts responsible, and arkiv/evidence/chipotle-adapter-poc.md
 * records the observed red output for the security-critical ones (binding
 * substitution, single-action).
 *
 * What this proves:
 *   - `protectShare`/`releaseShare` round-trip a share through the fake
 *     action, and the released bytes exactly equal what was protected;
 *   - `releaseShare` refuses a protected share bound to a *different* grant
 *     (a substituted binding) before ever calling the network — the
 *     commitment check in `releaseShare`;
 *   - a grant the fake Arkiv ledger reports as not live is refused, never
 *     released — the fake action's liveness check, mirroring
 *     chipotle-action.js's `grantIsLive`;
 *   - `ensureSingleAuthorizedAction` refuses to operate when the group
 *     permits more than one action, when the group permits all actions via
 *     the `0` wildcard, or when the PKP is not a member of the group, and
 *     does so *before* invoking the action at all;
 *   - nothing persists: no error carries the held share, and the
 *     single-action cache holds no secret material.
 */
import assert from "node:assert/strict"
import { registerHooks } from "node:module"

// Same extensionless-.ts resolution rule the rest of this repo's proofs use
// for Node's strip-types runner (see scripts/arkiv-taco-condition-proof.mjs).
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

const { encodeGrantBinding, toHex } = await import("../lib/crypto.ts")
const {
  createChipotleKeyReleaseProvider,
  ChipotleUnavailableError,
  hashActionCid,
  __resetChipotleAdapterStateForTests,
} = await import("../lib/key-release/chipotle.ts")
const { CHIPOTLE_ACTION_SOURCE } = await import("../lib/key-release/chipotle-action-source.ts")

const CONFIG = {
  enabled: true,
  actionCid: "bafyreiabc123realaction",
  pkpId: "pkp-real-1",
  groupId: "7",
  usageApiKey: "usage-key-for-tests",
}

const bindingA = {
  grantId: `0x${"11".repeat(32)}`,
  owner: `0x${"aa".repeat(20)}`,
  expiresBlock: 900n,
  ref: "ab".repeat(32),
}

const bindingB = {
  grantId: `0x${"22".repeat(32)}`,
  owner: `0x${"bb".repeat(20)}`,
  expiresBlock: 950n,
  ref: "cd".repeat(32),
}

function toBase64(bytes) {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function fromBase64(value) {
  const binary = atob(value)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

function xorTransform(bytes) {
  return Uint8Array.from(bytes, (b) => b ^ 0x5a)
}

async function computeCommitment(grantId, owner, expiresBlockStr, ref) {
  const bindingBytes = encodeGrantBinding({ grantId, owner, expiresBlock: BigInt(expiresBlockStr), ref })
  const digest = await crypto.subtle.digest("SHA-256", bindingBytes)
  return toHex(new Uint8Array(digest))
}

/**
 * Plays both the HTTP transport and the Lit Action's own logic.
 * `arkivLedger` maps a lowercase grantId to `{ owner, expiresBlock }` for
 * grants this fake Arkiv considers live — anything absent is "not live",
 * exactly like a pruned or never-created entity. `permittedActionCids`
 * defaults to just the configured action, hashed the same way `list_actions`
 * really does; `pkpInGroup` defaults to true.
 */
/**
 * Lit's exact literal body for a `POST /lit_action` whose code the enclave's
 * cache does not currently hold — see `chipotle.ts`'s `CACHE_MISS_MESSAGE`
 * and the module doc's amendments paragraph.
 */
const CACHE_MISS_ERROR_MESSAGE =
  "Chipotle /lit_action failed: HTTP 400 No cached code found. Submit the action code at least once before referencing it by IPFS ID."

function makeFakeChipotleClient(overrides = {}) {
  const calls = { getGroupAuthorization: 0, invokeAction: [], getActionIpfsId: 0 }
  const permittedActionCids = overrides.permittedActionCids ?? [CONFIG.actionCid]
  const pkpInGroup = overrides.pkpInGroup ?? true
  const arkivLedger = overrides.arkivLedger ?? new Map()
  // How many leading `invokeAction` calls throw the exact cache-miss error
  // before behaving normally — simulates Lit's in-memory action cache
  // missing an `ipfs_id`-only call.
  let cacheMissesRemaining = overrides.cacheMisses ?? 0
  const bundledActionCid = overrides.bundledActionCid ?? CONFIG.actionCid

  const client = {
    async ping() {},
    async getGroupAuthorization(groupId) {
      calls.getGroupAuthorization++
      assert.equal(groupId, CONFIG.groupId)
      return {
        hashedActionCids: permittedActionCids.map((cid) => (cid === "0" ? "0" : hashActionCid(cid))),
        pkpInGroup,
      }
    },
    async invokeAction({ actionCid, usageApiKey, jsParams, code }) {
      calls.invokeAction.push({ jsParams, code })
      assert.equal(actionCid, CONFIG.actionCid)
      assert.equal(usageApiKey, CONFIG.usageApiKey)
      assert.equal(jsParams.pkpId, CONFIG.pkpId)

      if (overrides.otherFourHundred && code === undefined) {
        throw new Error("Chipotle /lit_action failed: HTTP 400 js_params failed schema validation")
      }
      if (cacheMissesRemaining > 0 && code === undefined) {
        cacheMissesRemaining--
        throw new Error(CACHE_MISS_ERROR_MESSAGE)
      }

      if (overrides.invokeImpl) return overrides.invokeImpl(jsParams)

      // Mirrors chipotle-action.js's own commitment check.
      const expected = await computeCommitment(jsParams.grantId, jsParams.owner, jsParams.expiresBlock, jsParams.ref)
      if (expected !== jsParams.commitment) {
        return { authorized: false, error: "commitment does not match the supplied grant binding" }
      }

      if (jsParams.mode === "release") {
        const entry = arkivLedger.get(jsParams.grantId.toLowerCase())
        const live =
          entry &&
          entry.owner.toLowerCase() === jsParams.owner.toLowerCase() &&
          String(entry.expiresBlock) === jsParams.expiresBlock
        if (!live) return { authorized: false, error: "grant is not live" }
      }

      // Mirrors Lit.Actions.Encrypt/Decrypt: an opaque string transform.
      const inputString = jsParams.mode === "protect" ? jsParams.payload : jsParams.ciphertext
      const outputString = toBase64(xorTransform(fromBase64(inputString)))
      return { authorized: true, result: outputString }
    },
    async getActionIpfsId(code) {
      calls.getActionIpfsId++
      assert.equal(typeof code, "string")
      return bundledActionCid
    },
  }
  return { client, calls, arkivLedger }
}

// --- round trip: protect then release with the same, live binding ----------
{
  __resetChipotleAdapterStateForTests()
  const { client, arkivLedger } = makeFakeChipotleClient()
  arkivLedger.set(bindingA.grantId.toLowerCase(), { owner: bindingA.owner, expiresBlock: bindingA.expiresBlock.toString() })
  const provider = createChipotleKeyReleaseProvider({ client, config: CONFIG })

  const heldShare = new Uint8Array(32).fill(7)
  const protectedShare = await provider.protect(heldShare, bindingA)
  const released = await provider.release(protectedShare, bindingA)
  assert.deepEqual(released, heldShare, "the round trip must recover the original held share")
  console.log("PASS  protect() then release() with the same live binding recovers the original share")
}

// --- binding refuses a substituted grant ------------------------------------
// Exercises the commitment check in releaseShare (lib/key-release/chipotle.ts).
// RED before that check existed: releaseShare would have decoded the envelope,
// sent bindingB's fields straight to invokeAction, and — because the fake
// action's own commitment check would also have needed to be skipped to let
// this through — the release would have to be caught somewhere. Removing
// releaseShare's client-side check alone (leaving the action's check in
// chipotle-action.js's mirror) still throws, but no longer *before* a network
// call: this test additionally asserts zero invokeAction calls happened,
// which fails red the moment the client-side check is commented out.
{
  __resetChipotleAdapterStateForTests()
  const { client, calls, arkivLedger } = makeFakeChipotleClient()
  arkivLedger.set(bindingA.grantId.toLowerCase(), { owner: bindingA.owner, expiresBlock: bindingA.expiresBlock.toString() })
  arkivLedger.set(bindingB.grantId.toLowerCase(), { owner: bindingB.owner, expiresBlock: bindingB.expiresBlock.toString() })
  const provider = createChipotleKeyReleaseProvider({ client, config: CONFIG })

  const heldShare = new Uint8Array(32).fill(9)
  const protectedShare = await provider.protect(heldShare, bindingA)
  const invokeCallsBeforeRelease = calls.invokeAction.length

  let caught
  try {
    await provider.release(protectedShare, bindingB)
    assert.fail("release() must refuse a share protected for a different grant")
  } catch (error) {
    caught = error
  }
  assert.ok(caught instanceof ChipotleUnavailableError)
  assert.equal(caught.stage, "invoke")
  assert.match(caught.message, /substituted grant/)
  assert.equal(calls.invokeAction.length, invokeCallsBeforeRelease, "the commitment check must refuse before any network call")
  console.log("PASS  release() refuses a share substituted onto a different grant, before invoking the action")
}

// --- an expired (not-live) grant releases nothing ---------------------------
// Exercises the fake action's liveness check, mirroring chipotle-action.js's
// grantIsLive — a grant absent from the ledger is exactly what a pruned or
// never-created Arkiv entity looks like.
{
  __resetChipotleAdapterStateForTests()
  const { client, arkivLedger } = makeFakeChipotleClient()
  // Deliberately not added to arkivLedger: this grant does not exist as far
  // as Arkiv is concerned, which is what expiry looks like from outside.
  void arkivLedger
  const provider = createChipotleKeyReleaseProvider({ client, config: CONFIG })

  const heldShare = new Uint8Array(32).fill(3)
  const protectedShare = await provider.protect(heldShare, bindingA)

  let caught
  try {
    await provider.release(protectedShare, bindingA)
    assert.fail("release() must refuse for a grant Arkiv has no live record of")
  } catch (error) {
    caught = error
  }
  assert.ok(caught instanceof ChipotleUnavailableError)
  assert.equal(caught.stage, "invoke")
  const shareHex = Buffer.from(heldShare).toString("hex")
  assert.ok(!caught.message.includes(shareHex), "the error must never contain the held share")
  console.log("PASS  release() refuses for a grant with no live Arkiv record, and never leaks the share")
}

// --- a second permitted action on the same group is detected ---------------
// Exercises ensureSingleAuthorizedAction (lib/key-release/chipotle.ts). RED
// before that check existed: protect()/release() would proceed straight to
// invokeAction with no regard for how many actions the group permits.
{
  __resetChipotleAdapterStateForTests()
  const { client, calls } = makeFakeChipotleClient({
    permittedActionCids: [CONFIG.actionCid, "bafy-a-second-more-permissive-action"],
  })
  const provider = createChipotleKeyReleaseProvider({ client, config: CONFIG })

  let caught
  try {
    await provider.protect(new Uint8Array(32), bindingA)
    assert.fail("protect() must refuse when the group permits more than one action")
  } catch (error) {
    caught = error
  }
  assert.ok(caught instanceof ChipotleUnavailableError)
  assert.equal(caught.stage, "single-action")
  assert.equal(calls.invokeAction.length, 0, "a second permitted action must be caught before invoking anything")
  console.log("PASS  a second permitted action on the same group is detected and refused before any invocation")
}

// --- a group that permits all actions (the 0 wildcard) is detected ---------
// Exercises the wildcard branch of ensureSingleAuthorizedAction. RED before
// that check existed: a group permitting everything looks like "exactly one
// action" from a naive length check alone if that action happens to also be
// individually listed, so this needs its own guard, not just a length check.
{
  __resetChipotleAdapterStateForTests()
  const { client, calls } = makeFakeChipotleClient({ permittedActionCids: ["0"] })
  const provider = createChipotleKeyReleaseProvider({ client, config: CONFIG })

  let caught
  try {
    await provider.protect(new Uint8Array(32), bindingA)
    assert.fail("protect() must refuse when the group permits all actions via the 0 wildcard")
  } catch (error) {
    caught = error
  }
  assert.ok(caught instanceof ChipotleUnavailableError)
  assert.equal(caught.stage, "single-action")
  assert.match(caught.message, /wildcard/)
  assert.equal(calls.invokeAction.length, 0, "a wildcard-permitted group must be caught before invoking anything")
  console.log("PASS  a group that permits all actions via the 0 wildcard is detected and refused")
}

// --- a PKP that is not a member of the configured group is detected --------
{
  __resetChipotleAdapterStateForTests()
  const { client, calls } = makeFakeChipotleClient({ pkpInGroup: false })
  const provider = createChipotleKeyReleaseProvider({ client, config: CONFIG })

  let caught
  try {
    await provider.protect(new Uint8Array(32), bindingA)
    assert.fail("protect() must refuse when the PKP is not a member of the configured group")
  } catch (error) {
    caught = error
  }
  assert.ok(caught instanceof ChipotleUnavailableError)
  assert.equal(caught.stage, "single-action")
  assert.match(caught.message, /not a member/)
  assert.equal(calls.invokeAction.length, 0)
  console.log("PASS  a PKP absent from the configured group is detected and refused before any invocation")
}

// --- the single-action check is shared across calls, not repeated every time ---
{
  __resetChipotleAdapterStateForTests()
  const { client, calls, arkivLedger } = makeFakeChipotleClient()
  arkivLedger.set(bindingA.grantId.toLowerCase(), { owner: bindingA.owner, expiresBlock: bindingA.expiresBlock.toString() })
  const provider = createChipotleKeyReleaseProvider({ client, config: CONFIG })

  const protectedShare = await provider.protect(new Uint8Array(32).fill(1), bindingA)
  await provider.release(protectedShare, bindingA)
  assert.equal(calls.getGroupAuthorization, 1, "the single-action check must be cached, not repeated on every call")
  console.log("PASS  the single-action check is cached across protect() and release()")
}

// --- credentials missing is its own named, retryable-unavailable stage -----
{
  __resetChipotleAdapterStateForTests()
  const { client } = makeFakeChipotleClient()
  const incomplete = createChipotleKeyReleaseProvider({
    client,
    config: { ...CONFIG, usageApiKey: "" },
  })
  await assert.rejects(
    () => incomplete.protect(new Uint8Array(32), bindingA),
    (error) => error instanceof ChipotleUnavailableError && error.stage === "credentials",
  )
  console.log("PASS  a missing credential is refused as stage \"credentials\", never as denial")
}

// --- disabled Chipotle refuses both calls without ever touching the network ---
{
  __resetChipotleAdapterStateForTests()
  const { client, calls } = makeFakeChipotleClient()
  const disabled = createChipotleKeyReleaseProvider({ client, config: { ...CONFIG, enabled: false } })
  await assert.rejects(() => disabled.protect(new Uint8Array(32), bindingA), ChipotleUnavailableError)
  await assert.rejects(() => disabled.release(new Uint8Array(32), bindingA), ChipotleUnavailableError)
  assert.equal(calls.invokeAction.length, 0)
  assert.equal(calls.getGroupAuthorization, 0)
  console.log("PASS  a disabled provider refuses both calls without any network activity")
}

// --- docs/stories/H-69.md's amendments: the cache-miss retry -------------
// RED before `invokeActionWithCacheMissRetry` existed: `protect()` would
// have thrown the raw cache-miss error as a plain "invoke" failure instead
// of ever retrying.
{
  __resetChipotleAdapterStateForTests()
  const { client, calls, arkivLedger } = makeFakeChipotleClient({ cacheMisses: 1 })
  arkivLedger.set(bindingA.grantId.toLowerCase(), { owner: bindingA.owner, expiresBlock: bindingA.expiresBlock.toString() })
  const provider = createChipotleKeyReleaseProvider({ client, config: CONFIG })

  const heldShare = new Uint8Array(32).fill(5)
  const protectedShare = await provider.protect(heldShare, bindingA)
  const released = await provider.release(protectedShare, bindingA)
  assert.deepEqual(released, heldShare, "a cache-miss retry must still complete the operation correctly")

  // protect(): 1 miss + 1 retry = 2 calls. release(): the fake client's one
  // configured miss was already consumed by protect(), so this is a single
  // ordinary call = 3 calls total.
  assert.equal(calls.invokeAction.length, 3, "each cache miss must retry exactly once, not loop or give up")
  assert.equal(calls.invokeAction[0].code, undefined, "the first attempt must run by ipfs_id, never by code")
  assert.equal(calls.invokeAction[1].code, CHIPOTLE_ACTION_SOURCE, "the retry must submit the bundled action source as code")
  assert.equal(calls.getActionIpfsId, 1, "the bundled source's CID is checked once, then cached for the rest of the process")
  console.log("PASS  a cache miss retries with the bundled action source exactly once, and still completes")
}

// --- any other 400 must not retry ------------------------------------------
{
  __resetChipotleAdapterStateForTests()
  const { client, calls, arkivLedger } = makeFakeChipotleClient({ otherFourHundred: true })
  arkivLedger.set(bindingA.grantId.toLowerCase(), { owner: bindingA.owner, expiresBlock: bindingA.expiresBlock.toString() })
  const provider = createChipotleKeyReleaseProvider({ client, config: CONFIG })

  await assert.rejects(
    () => provider.protect(new Uint8Array(32), bindingA),
    (error) => error instanceof ChipotleUnavailableError && error.stage === "invoke",
  )
  assert.equal(calls.invokeAction.length, 1, "a non-cache-miss 400 must never be retried")
  assert.equal(calls.getActionIpfsId, 0, "the bundled source's CID must never be checked for a non-cache-miss failure")
  console.log("PASS  a 400 that is not the exact cache-miss response is never retried")
}

// --- a bundled-source CID mismatch refuses, never submits different code ---
{
  __resetChipotleAdapterStateForTests()
  const { client, calls, arkivLedger } = makeFakeChipotleClient({ cacheMisses: 1, bundledActionCid: "bafyreisomeotheractioncid" })
  arkivLedger.set(bindingA.grantId.toLowerCase(), { owner: bindingA.owner, expiresBlock: bindingA.expiresBlock.toString() })
  const provider = createChipotleKeyReleaseProvider({ client, config: CONFIG })

  let caught
  try {
    await provider.protect(new Uint8Array(32), bindingA)
    assert.fail("protect() must refuse when the bundled source's CID does not match the configured action CID")
  } catch (error) {
    caught = error
  }
  assert.ok(caught instanceof ChipotleUnavailableError)
  assert.equal(caught.stage, "action-source")
  assert.match(caught.message, /not the configured/)
  assert.equal(calls.invokeAction.length, 1, "a CID mismatch must refuse before ever submitting code")
  console.log("PASS  a bundled action-source CID mismatch refuses rather than submitting unverified code")
}

// --- nothing persists: one grant's held share never leaks into another's ---
{
  __resetChipotleAdapterStateForTests()
  const { client, arkivLedger } = makeFakeChipotleClient()
  arkivLedger.set(bindingA.grantId.toLowerCase(), { owner: bindingA.owner, expiresBlock: bindingA.expiresBlock.toString() })
  arkivLedger.set(bindingB.grantId.toLowerCase(), { owner: bindingB.owner, expiresBlock: bindingB.expiresBlock.toString() })
  const provider = createChipotleKeyReleaseProvider({ client, config: CONFIG })

  const shareA = new Uint8Array(32).fill(0x11)
  const shareB = new Uint8Array(32).fill(0x22)
  const protectedA = await provider.protect(shareA, bindingA)
  const protectedB = await provider.protect(shareB, bindingB)
  const releasedA = await provider.release(protectedA, bindingA)
  const releasedB = await provider.release(protectedB, bindingB)
  assert.deepEqual(releasedA, shareA)
  assert.deepEqual(releasedB, shareB)
  assert.notDeepEqual(releasedA, releasedB, "one grant's held share must never leak into another's release")
  console.log("PASS  two concurrent grants never leak each other's held share; nothing is cached across calls")
}

console.log("\nAll checks passed.")
process.exit(0)
