/**
 * Opt-in, non-destructive probe of live Lit Chipotle infrastructure — this
 * story's own evidence that `lib/key-release/chipotle.ts`'s dependencies are
 * (or are not) actually reachable right now, mirroring
 * scripts/taco-adapter-live-probe.mjs's shape and staging discipline.
 *
 * This script never writes to Arkiv and never spends real service credits
 * beyond what a single fabricated, disposable release attempt costs: the
 * grant id, owner, and ciphertext it uses cannot correspond to anything Lit
 * or Arkiv has a real record of. A pass proves the endpoint resolves,
 * answers HTTP, the configured group permits exactly one action and
 * contains the configured PKP, that action is invocable, and — the one
 * property that actually matters — a real enclave refuses to release for a
 * grant Arkiv has no record of. It does not prove a live release for a
 * grant that actually exists; that needs real asset/grant issuance and is
 * explicitly out of scope for this story (see docs/stories/H-65.md,
 * "Non-goals").
 *
 * Per docs/stories/H-65.md, "Credentials": a worker cannot create a Lit
 * account, mint a usage key, or publish the action this adapter needs. In
 * this repository, right now, that means this probe is expected to stop at
 * the "credentials" stage — that outcome is recorded honestly rather than
 * faked, and lists exactly which environment variables an operator must set.
 */
import { lookup } from "node:dns/promises"
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

if (process.env.RUN_CHIPOTLE_LIVE_PROBE !== "1") {
  console.log("Skipped — this probe makes real network calls, so it is opt-in only.")
  console.log("Set RUN_CHIPOTLE_LIVE_PROBE=1 to run it. Configuration that would be used:")
  console.log({
    actionCid: process.env.NEXT_PUBLIC_CHIPOTLE_ACTION_CID || "(unset)",
    pkpId: process.env.NEXT_PUBLIC_CHIPOTLE_PKP_ID || "(unset)",
    groupId: process.env.NEXT_PUBLIC_CHIPOTLE_GROUP_ID || "(unset)",
    usageApiKey: process.env.NEXT_PUBLIC_CHIPOTLE_USAGE_API_KEY ? "(set)" : "(unset)",
  })
  process.exit(2)
}

const { readChipotleConfig, createHttpChipotleClient, CHIPOTLE_API_BASE, invokeActionWithCacheMissRetry, ChipotleUnavailableError } =
  await import("../lib/key-release/chipotle.ts")
const { encodeGrantBinding, toHex } = await import("../lib/crypto.ts")

console.log(`Chipotle adapter live probe — ${new Date().toISOString()}`)
console.log(`Base URL: ${CHIPOTLE_API_BASE}`)
console.log("Writes nothing to Arkiv. All inputs below are disposable.\n")

function blocked(stage, error) {
  console.log(`\nBLOCKED at stage "${stage}": ${error instanceof Error ? error.message : String(error)}`)
  console.log("This is an infrastructure or credentials block, not a release result.")
  console.log('See docs/stories/H-65.md, "## Credentials" and "## Evidence".')
  process.exit(3)
}

function failed(stage, error) {
  console.log(`\nFAILED at stage "${stage}": ${error instanceof Error ? error.message : String(error)}`)
  console.log("Infrastructure responded, but the adapter did not behave as the fail-closed contract requires.")
  process.exit(1)
}

const config = readChipotleConfig()

// --- stage 1: credentials ---------------------------------------------------
const missing = []
if (!config.actionCid) missing.push("NEXT_PUBLIC_CHIPOTLE_ACTION_CID")
if (!config.pkpId) missing.push("NEXT_PUBLIC_CHIPOTLE_PKP_ID")
if (!config.groupId) missing.push("NEXT_PUBLIC_CHIPOTLE_GROUP_ID")
if (!config.usageApiKey) missing.push("NEXT_PUBLIC_CHIPOTLE_USAGE_API_KEY")
if (missing.length > 0) {
  blocked(
    "credentials",
    new Error(
      `Chipotle needs an account, a published action, a group, and a usage key. Missing: ${missing.join(", ")}. ` +
        "Create them at developer.litprotocol.com (see docs/stories/H-65.md, \"Credentials\"), then set these.",
    ),
  )
}
console.log("stage 1/5  credentials configured — action CID, PKP, group, and usage key are all set")

// --- stage 2: endpoint resolves ---------------------------------------------
const hostname = new URL(CHIPOTLE_API_BASE).hostname
try {
  const resolved = await lookup(hostname)
  console.log(`stage 2/5  endpoint resolves — ${hostname} -> ${resolved.address}`)
} catch (error) {
  blocked("resolve", error)
}

// --- stage 3: endpoint answers ----------------------------------------------
const client = createHttpChipotleClient(config)
try {
  await client.ping()
  console.log(`stage 3/5  endpoint answers HTTP — ${CHIPOTLE_API_BASE}`)
} catch (error) {
  blocked("reachable", error)
}

// --- stage 4: the group permits exactly the one configured action, and contains the PKP ---
let auth
try {
  auth = await client.getGroupAuthorization(config.groupId)
} catch (error) {
  blocked("single-action", error)
}
if (!auth.pkpInGroup) {
  failed(
    "single-action",
    new Error(`PKP ${config.pkpId} is not a member of group ${config.groupId} — list_wallets_in_group does not report it`),
  )
}
if (auth.hashedActionCids.some((hash) => { try { return BigInt(hash) === BigInt(0) } catch { return false } })) {
  failed(
    "single-action",
    new Error(`group ${config.groupId} permits all actions via the 0 wildcard — see developer.litprotocol.com/architecture/groups`),
  )
}
const { hashActionCid } = await import("../lib/key-release/chipotle.ts")
const expectedHash = hashActionCid(config.actionCid)
if (auth.hashedActionCids.length !== 1 || auth.hashedActionCids[0] !== expectedHash) {
  failed(
    "single-action",
    new Error(
      `group ${config.groupId} permits ${auth.hashedActionCids.length} action(s) (${auth.hashedActionCids.join(", ") || "none"}); ` +
        `expected exactly one, matching the configured action ${config.actionCid} (hash ${expectedHash}). A second, more ` +
        "permissive action on this group bypasses this adapter's gate entirely — see docs/stories/H-65.md.",
    ),
  )
}
console.log(`stage 4/5  action invocable — group ${config.groupId} permits exactly this one action and contains the PKP`)

// --- stage 5: a release against a fabricated, nonexistent grant is refused ---
//
// A "Threshold of responses not met"-shaped rejection and a DNS/connection
// failure can look identical from a bare HTTP client — the same ambiguity
// scripts/taco-adapter-live-probe.mjs calls out for Porter. This probe does
// not paper over it either: a network-failure signature in the response
// means no enclave was actually reached, which is BLOCKED, not a verified
// refusal.
const NETWORK_FAILURE_PATTERN = /ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed/i

const fabricatedBinding = {
  grantId: `0x${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`.slice(0, 66),
  owner: `0x${toHex(crypto.getRandomValues(new Uint8Array(20)))}`,
  expiresBlock: 1n,
  ref: toHex(crypto.getRandomValues(new Uint8Array(32))),
}
const commitment = toHex(
  new Uint8Array(await crypto.subtle.digest("SHA-256", encodeGrantBinding(fabricatedBinding))),
)
const fabricatedCiphertext = toHex(crypto.getRandomValues(new Uint8Array(32)))

try {
  // Not a bare `client.invokeAction` call: the live account's action cache
  // is in memory and can be cold (a fresh action, or one evicted by a
  // restart) — see docs/stories/H-69.md's amendments. This is the same
  // cache-miss-tolerant path a real `protect`/`release` call takes, so this
  // probe proves the adapter's actual behavior, not a narrower stand-in for it.
  const response = await invokeActionWithCacheMissRetry(client, config, {
    mode: "release",
    pkpId: config.pkpId,
    ciphertext: btoa(fabricatedCiphertext),
    commitment,
    grantId: fabricatedBinding.grantId,
    owner: fabricatedBinding.owner,
    expiresBlock: fabricatedBinding.expiresBlock.toString(10),
    ref: fabricatedBinding.ref,
  })
  if (response.authorized) {
    failed(
      "invoke",
      new Error(`the action released for a grant Arkiv has no record of (result length ${response.result?.length ?? 0})`),
    )
  }
  console.log(`stage 5/5  release correctly refused for a nonexistent Arkiv entity — ${response.error ?? "authorized: false"}`)
} catch (error) {
  // A CID mismatch between this build's bundled `chipotle-action.js` and the
  // registered action is its own named stage, distinct from an ordinary
  // invoke failure — see the module doc's amendments paragraph.
  const stage = error instanceof ChipotleUnavailableError ? error.stage : "invoke"
  const message = error instanceof Error ? error.message : String(error)
  if (NETWORK_FAILURE_PATTERN.test(message)) {
    blocked(stage, error)
  }
  failed(stage, error)
}

console.log("\nLIVE: the endpoint resolved and answered, the group permits exactly the one configured action and")
console.log("contains the PKP, and a real enclave correctly refused to release for a grant that Arkiv has no")
console.log("record of — the exact fail-closed behavior an expired or absent grant must produce.")
console.log("Not tested here: release for a grant Arkiv actually has a live record for — that needs real")
console.log("asset/grant issuance and is out of this proof's scope (see docs/stories/H-65.md, \"Non-goals\").")
process.exit(0)
