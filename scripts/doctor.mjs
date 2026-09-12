/**
 * Preflight. Checks every external thing a send depends on, and says which desk
 * to visit when one is missing.
 *
 *   node scripts/doctor.mjs
 */
import { createPublicClient, http, formatEther } from "viem"
import { tiramisu } from "@arkiv-network/sdk/chains"
import { privateKeyToAccount } from "viem/accounts"
import { readFileSync } from "node:fs"

const ok = (m) => console.log(`  ok    ${m}`)
const bad = (m, fix) => {
  console.log(`  FAIL  ${m}`)
  if (fix) console.log(`        → ${fix}`)
  failures++
}
let failures = 0

function env(name) {
  if (process.env[name]) return process.env[name]
  try {
    const match = readFileSync(new URL("../.env.local", import.meta.url), "utf8").match(
      new RegExp(`^${name}=(.+)$`, "m"),
    )
    return match?.[1]?.trim()
  } catch {
    return undefined
  }
}

console.log("\nArkiv (grant registry)")
const publicClient = createPublicClient({ chain: tiramisu, transport: http(env("NEXT_PUBLIC_ARKIV_RPC")) })
try {
  const [chainId, block] = await Promise.all([publicClient.getChainId(), publicClient.getBlockNumber()])
  ok(`RPC reachable — chain ${chainId}, block ${block}`)
} catch (error) {
  bad(`RPC unreachable: ${error.shortMessage ?? error.message}`, "check https://status.arkiv.network/")
}

const funderKey = env("ARKIV_FUNDER_PRIVATE_KEY")
if (!funderKey) {
  bad("ARKIV_FUNDER_PRIVATE_KEY is not set", "cp .env.example .env.local and add a key")
} else {
  const account = privateKeyToAccount(funderKey)
  try {
    const balance = await publicClient.getBalance({ address: account.address })
    if (balance === 0n) {
      bad(`funder ${account.address} has no GLM`, `claim at https://hub.arkiv.network/faucet for ${account.address}`)
    } else {
      ok(`funder ${account.address} holds ${formatEther(balance)} GLM`)
    }
  } catch (error) {
    bad(`could not read funder balance: ${error.message}`)
  }
}

console.log("\nSwarm (storage)")
const gateway = env("NEXT_PUBLIC_SWARM_GATEWAY") ?? "https://download.gateway.ethswarm.org"
try {
  // A known-absent reference: any answer that is not a transport error proves
  // the gateway is up and speaking bzz.
  const response = await fetch(`${gateway}/bytes/${"0".repeat(64)}`, { method: "HEAD" })
  ok(`download gateway reachable — ${gateway} (HTTP ${response.status})`)
} catch (error) {
  bad(`download gateway unreachable: ${error.message}`, "set NEXT_PUBLIC_SWARM_GATEWAY to another public gateway")
}

const idOrigin = env("NEXT_PUBLIC_SWARM_ID_ORIGIN") ?? "https://swarm-id.snaha.net"
try {
  const response = await fetch(idOrigin, { method: "HEAD" })
  ok(`Swarm ID origin reachable — ${idOrigin} (HTTP ${response.status})`)
} catch (error) {
  bad(`Swarm ID origin unreachable: ${error.message}`)
}

console.log("\nUpload capability is per-identity and can only be checked in the browser:")
console.log("  sign in on the app and look for canUpload on the sign-in panel.")
console.log("  No postage batch → get a gift code at the Swarm desk, or set")
console.log("  NEXT_PUBLIC_SWARM_SUBSIDISED_GATEWAY to a stamping gateway.")

console.log(failures === 0 ? "\nAll preflight checks passed.\n" : `\n${failures} check(s) failed.\n`)
process.exit(failures === 0 ? 0 : 1)
