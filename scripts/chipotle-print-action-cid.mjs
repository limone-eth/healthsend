/**
 * Prints `lib/key-release/chipotle-action.js`'s IPFS CID, computed by
 * Chipotle's own `POST /get_lit_action_ipfs_id` — no manual IPFS pinning,
 * and no guessed CID (docs/stories/H-67.md, "What to build").
 *
 * This script never registers the action. `add_action` and
 * `add_action_to_group` need the account's master key, which this repo's
 * app and scripts never read (see docs/stories/H-65.md, "Credentials", and
 * .env.example) — it prints the two calls the operator runs themselves.
 */
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

const CHIPOTLE_API_BASE = "https://api.chipotle.litprotocol.com/core/v1"
const actionPath = fileURLToPath(new URL("../lib/key-release/chipotle-action.js", import.meta.url))

const apiKey = process.env.NEXT_PUBLIC_CHIPOTLE_USAGE_API_KEY
if (!apiKey) {
  console.error("Set NEXT_PUBLIC_CHIPOTLE_USAGE_API_KEY (any valid Chipotle API key works — this call is a stateless")
  console.error("compute utility, not an account write) to compute the CID.")
  process.exit(2)
}

const code = await readFile(actionPath, "utf8")

const res = await fetch(`${CHIPOTLE_API_BASE}/get_lit_action_ipfs_id`, {
  method: "POST",
  headers: { "X-Api-Key": apiKey, "content-type": "application/json" },
  body: JSON.stringify(code),
})
const body = await res.json()
if (!res.ok || typeof body !== "string") {
  console.error(`Chipotle rejected the CID computation: HTTP ${res.status}`, body)
  process.exit(1)
}
const actionCid = body

console.log(`chipotle-action.js's CID: ${actionCid}`)
console.log()
console.log("This app never registers actions itself — that needs the account key. Run these two calls")
console.log("yourself (see developer.litprotocol.com/management/api_direct):")
console.log()
console.log(`  POST ${CHIPOTLE_API_BASE}/add_action`)
console.log(`    X-Api-Key: <account key>`)
console.log(`    {"action_ipfs_cid": "${actionCid}", "name": "healthsend-key-release", "description": "H-65/H-67 protect/release gate"}`)
console.log()
console.log(`  POST ${CHIPOTLE_API_BASE}/add_action_to_group`)
console.log(`    X-Api-Key: <account key>`)
console.log(`    {"group_id": <healthsend group id>, "action_ipfs_cid": "${actionCid}"}`)
console.log()
console.log(`Then set NEXT_PUBLIC_CHIPOTLE_ACTION_CID=${actionCid} in the environment.`)
