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
 * answers HTTP, the configured PKP authorizes exactly one action, that
 * action is invocable, and — the one property that actually matters — a
 * real enclave refuses to release for a grant Arkiv has no record of. It
 * does not prove a live release for a grant that actually exists; that
 * needs real asset/grant issuance and is explicitly out of scope for this
 * story (see docs/stories/H-65.md, "Non-goals").
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
    endpoint: process.env.NEXT_PUBLIC_CHIPOTLE_ENDPOINT || "(unset)",
    actionCid: process.env.NEXT_PUBLIC_CHIPOTLE_ACTION_CID || "(unset)",
    pkpPublicKey: process.env.NEXT_PUBLIC_CHIPOTLE_PKP_PUBLIC_KEY || "(unset)",
    usageApiKey: process.env.NEXT_PUBLIC_CHIPOTLE_USAGE_API_KEY ? "(set)" : "(unset)",
  })
  process.exit(2)
}

const { readChipotleConfig, createHttpChipotleClient } = await import("../lib/key-release/chipotle.ts")
const { encodeGrantBinding, toHex } = await import("../lib/crypto.ts")

console.log(`Chipotle adapter live probe — ${new Date().toISOString()}`)
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
if (!config.endpoint) missing.push("NEXT_PUBLIC_CHIPOTLE_ENDPOINT")
if (!config.actionCid) missing.push("NEXT_PUBLIC_CHIPOTLE_ACTION_CID")
if (!config.pkpPublicKey) missing.push("NEXT_PUBLIC_CHIPOTLE_PKP_PUBLIC_KEY")
if (!config.usageApiKey) missing.push("NEXT_PUBLIC_CHIPOTLE_USAGE_API_KEY")
if (missing.length > 0) {
  blocked(
    "credentials",
    new Error(
      `Chipotle needs an account, a published action, and a usage key. Missing: ${missing.join(", ")}. ` +
        "Create them at developer.litprotocol.com (see docs/stories/H-65.md, \"Credentials\"), then set these.",
    ),
  )
}
console.log("stage 1/5  credentials configured — endpoint, action CID, PKP, and usage key are all set")

// --- stage 2: endpoint resolves ---------------------------------------------
let hostname
try {
  hostname = new URL(config.endpoint).hostname
} catch (error) {
  blocked("credentials", error)
}
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
  console.log(`stage 3/5  endpoint answers HTTP — ${config.endpoint}`)
} catch (error) {
  blocked("reachable", error)
}

// --- stage 4: exactly one action is authorized on the PKP, and it is invocable ---
let actions
try {
  actions = await client.listAuthorizedActions(config.pkpPublicKey)
} catch (error) {
  blocked("single-action", error)
}
if (actions.length !== 1 || actions[0] !== config.actionCid) {
  failed(
    "single-action",
    new Error(
      `PKP ${config.pkpPublicKey} authorizes ${actions.length} action(s) (${actions.join(", ") || "none"}); ` +
        `expected exactly one, matching the configured action ${config.actionCid}. A second, more ` +
        "permissive action on this PKP bypasses this adapter's gate entirely — see docs/stories/H-65.md.",
    ),
  )
}
console.log(`stage 4/5  action invocable — PKP ${config.pkpPublicKey} authorizes exactly this one action`)

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
  const response = await client.invokeAction({
    actionCid: config.actionCid,
    pkpPublicKey: config.pkpPublicKey,
    usageApiKey: config.usageApiKey,
    jsParams: {
      mode: "release",
      ciphertext: btoa(fabricatedCiphertext),
      commitment,
      grantId: fabricatedBinding.grantId,
      owner: fabricatedBinding.owner,
      expiresBlock: fabricatedBinding.expiresBlock.toString(10),
      ref: fabricatedBinding.ref,
    },
  })
  if (response.authorized) {
    failed(
      "invoke",
      new Error(`the action released for a grant Arkiv has no record of (result length ${response.result?.length ?? 0})`),
    )
  }
  console.log(`stage 5/5  release correctly refused for a nonexistent Arkiv entity — ${response.error ?? "authorized: false"}`)
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  if (NETWORK_FAILURE_PATTERN.test(message)) {
    blocked("invoke", error)
  }
  failed("invoke", error)
}

console.log("\nLIVE: the endpoint resolved and answered, the PKP authorizes exactly the one configured action,")
console.log("and a real enclave correctly refused to release for a grant that Arkiv has no record of — the")
console.log("exact fail-closed behavior an expired or absent grant must produce.")
console.log("Not tested here: release for a grant Arkiv actually has a live record for — that needs real")
console.log("asset/grant issuance and is out of this proof's scope (see docs/stories/H-65.md, \"Non-goals\").")
process.exit(0)
