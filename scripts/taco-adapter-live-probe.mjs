/**
 * Opt-in, non-destructive probe of live TACo infrastructure — H-52's own
 * evidence that the adapter's dependencies are (or are not) actually
 * reachable right now, distinct from the fuller grant-issuing live proof a
 * later story adds once asset/grant issuance exists (H-53/H-54).
 *
 * This script never writes to Arkiv and spends no gas: the held share,
 * signer, and Arkiv-bound condition it uses are all disposable, built from a
 * grant id that cannot exist. A pass proves the coordination RPC, the
 * configured DKG ritual, and the Porter cohort are reachable, AND that a real
 * cohort refuses to release for a condition Arkiv has no record of — the
 * exact fail-closed behavior an expired or absent grant must produce. It
 * does not release for a grant Arkiv actually has a live record for; that
 * needs real asset/grant issuance (H-53/H-54) and is out of this proof's
 * scope.
 *
 * `@nucypher/taco`'s browser (ESM) build cannot be resolved by plain Node —
 * see the module doc in lib/key-release/taco.ts — so this script loads the
 * real SDK through `createRequire`, never through `import`, and never
 * imports the adapter module itself.
 */
import { createRequire } from "node:module"
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

const DEFAULT_DOMAIN = "lynx"
const DEFAULT_RITUAL_ID = "27"
const DEFAULT_COORDINATION_RPC = "https://polygon-amoy.drpc.org"

const domain = process.env.NEXT_PUBLIC_TACO_DOMAIN ?? DEFAULT_DOMAIN
const ritualId = Number(process.env.NEXT_PUBLIC_TACO_RITUAL_ID ?? DEFAULT_RITUAL_ID)
const coordinationRpc = process.env.NEXT_PUBLIC_TACO_COORDINATION_RPC ?? DEFAULT_COORDINATION_RPC

if (process.env.RUN_TACO_LIVE_PROBE !== "1") {
  console.log("Skipped — this probe makes real network calls, so it is opt-in only.")
  console.log("Set RUN_TACO_LIVE_PROBE=1 to run it. Configuration that would be used:")
  console.log({ domain, ritualId, coordinationRpc })
  process.exit(2)
}

if (domain !== "lynx") {
  console.error(`Unsupported NEXT_PUBLIC_TACO_DOMAIN "${domain}" — only "lynx" is configured for this PoC.`)
  process.exit(2)
}
if (!Number.isInteger(ritualId) || ritualId < 0) {
  console.error("NEXT_PUBLIC_TACO_RITUAL_ID must be a non-negative integer.")
  process.exit(2)
}

const require = createRequire(import.meta.url)
const { initialize, encrypt, decrypt, domains, conditions, getPorterUris, ThresholdMessageKit } = require("@nucypher/taco")
const { ethers } = require("ethers")
const { buildArkivGrantQuery } = await import("../lib/arkiv.ts")

console.log(`TACo adapter live probe — ${new Date().toISOString()}`)
console.log(`domain=${domain} ritualId=${ritualId} coordinationRpc=${coordinationRpc}`)
console.log("Writes nothing to Arkiv. Spends no gas. All inputs below are disposable.\n")

function blocked(stage, error) {
  console.log(`\nBLOCKED at stage "${stage}": ${error instanceof Error ? error.message : String(error)}`)
  console.log("This is an infrastructure block, not a threshold-release result.")
  console.log('See docs/stories/H-52.md, "## Evidence".')
  process.exit(3)
}

function failed(stage, error) {
  console.log(`\nFAILED at stage "${stage}": ${error instanceof Error ? error.message : String(error)}`)
  console.log("Infrastructure responded, but the adapter did not behave as the fail-closed contract requires.")
  process.exit(1)
}

try {
  await initialize()
  console.log("stage 1/5  initialize — ok")
} catch (error) {
  blocked("initialize", error)
}

const rpcProvider = new ethers.providers.JsonRpcProvider(coordinationRpc)
try {
  const network = await rpcProvider.getNetwork()
  console.log(`stage 2/5  coordination RPC reachable — chainId ${network.chainId}`)
} catch (error) {
  blocked("coordination", error)
}

// A binding no Arkiv entity will ever match: a random grant id under a
// disposable owner. Any Arkiv RPC the condition names will answer "no rows",
// so a live cohort must refuse to release — the same fail-closed behavior a
// real, expired grant would produce. This is why stage 5 below is genuine
// evidence of the release path, not just of encryption.
const fabricatedBinding = {
  grantId: `0x${ethers.utils.hexlify(ethers.utils.randomBytes(32)).slice(2)}`,
  owner: ethers.Wallet.createRandom().address,
  expiresBlock: 1n,
  ref: ethers.utils.hexlify(ethers.utils.randomBytes(32)).slice(2),
}
const arkivRequest = buildArkivGrantQuery(fabricatedBinding)

let messageKit
try {
  const disposableShare = ethers.utils.randomBytes(32)
  const disposableSigner = ethers.Wallet.createRandom().connect(rpcProvider)
  const condition = new conditions.base.jsonRpc.JsonRpcCondition({
    endpoint: arkivRequest.endpoint,
    method: arkivRequest.method,
    params: arkivRequest.params,
    query: arkivRequest.query,
    returnValueTest: { comparator: "==", value: arkivRequest.expected },
  })
  messageKit = await encrypt(rpcProvider, domains.DEVNET, disposableShare, condition, ritualId, disposableSigner)
  console.log(`stage 3/5  ritual ${ritualId} resolved — disposable share encrypted under a real Arkiv-shaped condition (${messageKit.toBytes().length} bytes)`)
} catch (error) {
  blocked("encrypt", error)
}

try {
  const porterUris = await getPorterUris(domain)
  // This resolves a URI list (a hardcoded default plus an optional fetch of
  // a static config) — it never contacts a Porter node, so it is not by
  // itself evidence the cohort is reachable. Stage 5 is what actually tests that.
  console.log(`stage 4/5  Porter URI list resolved — ${porterUris.length} URI(s) (not yet contacted)`)
} catch (error) {
  blocked("porter", error)
}

// A "Threshold of responses not met" rejection and a DNS/connection failure
// to the Porter cohort look identical from here on up — the SDK aggregates
// per-node errors into one message either way (see @nucypher/taco's tdec.js,
// ERR_DECRYPTION_FAILED). That is exactly the ambiguity lib/key-release/
// taco.ts refuses to paper over with a fabricated "denied" classification, so
// this probe does not paper over it either: a network-failure signature in
// the rejection means no node was actually reached, which is BLOCKED, not a
// verified refusal — regardless of how the SDK phrases it.
const NETWORK_FAILURE_PATTERN = /ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|network ?error/i

try {
  const restored = ThresholdMessageKit.fromBytes(messageKit.toBytes())
  const released = await decrypt(rpcProvider, domains.DEVNET, restored, undefined, undefined)
  // A real cohort must never hand back key material for a condition bound to
  // an Arkiv entity that does not exist. If we get here, the nodes released
  // anyway — that is a correctness failure of the network, not of this
  // adapter, but it must still stop the run rather than print "LIVE".
  failed("porter", new Error(`the cohort released ${released.length} bytes for a condition bound to a nonexistent Arkiv entity`))
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  if (NETWORK_FAILURE_PATTERN.test(message)) {
    blocked("porter", error)
  }
  console.log(`stage 5/5  release correctly refused for a nonexistent Arkiv entity — ${message}`)
}

console.log("\nLIVE: a real cohort resolved the ritual, encrypted under a real Arkiv-bound condition,")
console.log("and correctly refused to release for a grant that Arkiv has no record of — the exact")
console.log("fail-closed behavior an expired or absent grant must produce.")
console.log("Not tested here: release for a grant Arkiv actually has a live record for — that needs")
console.log("real asset/grant issuance (H-53/H-54) and is out of this proof's scope.")
process.exit(0)
