/**
 * Mission 02 evidence: the same query, before and after the boundary, with no
 * delete call in between.
 *
 * Creates one grant-shaped entity with a short lifetime, runs the compound
 * query the dashboard runs, waits for the entity to lapse on its own, and runs
 * the identical query again. Nothing in this script deletes anything.
 *
 *   node scripts/expiry-demo.mjs [ttlSeconds]
 */

import { createPublicClient, createWalletClient } from "@arkiv-network/sdk"
import { tiramisu } from "@arkiv-network/sdk/chains"
import { addr, str, u64 } from "@arkiv-network/sdk/attr"
import { and, eq, gte } from "@arkiv-network/sdk/query"
import { ExpirationTime, jsonToPayload } from "@arkiv-network/sdk/utils"
import { http, formatEther } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { readFileSync } from "node:fs"

const TTL = Math.max(30, Number(process.argv[2] ?? 60))

function loadKey() {
  if (process.env.ARKIV_FUNDER_PRIVATE_KEY) return process.env.ARKIV_FUNDER_PRIVATE_KEY
  try {
    const match = readFileSync(new URL("../.env.local", import.meta.url), "utf8").match(
      /^ARKIV_FUNDER_PRIVATE_KEY=(0x[0-9a-fA-F]{64})/m,
    )
    if (match) return match[1]
  } catch {}
  console.error("No ARKIV_FUNDER_PRIVATE_KEY. Fund a key at https://hub.arkiv.network/faucet")
  process.exit(1)
}

const account = privateKeyToAccount(loadKey())
const publicClient = createPublicClient({ chain: tiramisu, transport: http() })
const wallet = createWalletClient({ chain: tiramisu, transport: http(), account })

const balance = await publicClient.getBalance({ address: account.address })
console.log(`account  ${account.address}`)
console.log(`balance  ${formatEther(balance)} GLM`)
if (balance === 0n) {
  console.error(`\nThis account has no GLM. Fund it at https://hub.arkiv.network/faucet`)
  process.exit(1)
}

const now = Math.floor(Date.now() / 1000)

// The compound filter the sender's dashboard uses: owner + namespace + kind +
// file type + a creation-time range. Five typed attributes, not a lookup by id.
const dashboardQuery = () =>
  publicClient
    .select({ key: true, attributes: true })
    .where(
      and(
        // Tagged, not bare: a bare string asserts `str` and a bare bigint
        // `u256`, and a mismatched predicate matches nothing rather than failing.
        eq("app", str("healthsend")),
        eq("kind", str("grant")),
        eq("sender", addr(account.address)),
        eq("filetype", str("csv")),
        gte("created_at", u64(BigInt(now - 60))),
      ),
    )
    .ownedBy(account.address)
    .limit(50)
    .fetch()

console.log(`\ncreating a grant with a ${TTL}s lifetime…`)
const { entityKey, txHash } = await wallet.createEntity({
  payload: jsonToPayload({ v: 1, ref: "demo-swarm-reference", wrap: { iv: "x", ct: "y" } }),
  contentType: "application/json",
  attributes: {
    app: str("healthsend"),
    kind: str("grant"),
    sender: addr(account.address),
    filetype: str("csv"),
    recipient: str("blinded-recipient-hmac"),
    label: str("blinded-label-hmac"),
    created_at: u64(BigInt(now)),
    expires_at: u64(BigInt(now + TTL)),
  },
  expires: ExpirationTime.fromSeconds(Math.ceil(TTL / 2) * 2),
})
console.log(`entity   ${entityKey}`)
console.log(`tx       https://tiramisu.explorer.arkiv.network/tx/${txHash}`)

const before = await dashboardQuery()
console.log(`\nBEFORE   query returns ${before.entities.length} row(s)`)
for (const e of before.entities) console.log(`         ${e.key}`)

console.log(`\nwaiting ${TTL + 20}s for the grant to lapse (no delete call is made)…`)
const deadline = Date.now() + (TTL + 90) * 1000
let gone = false
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 10_000))
  const poll = await dashboardQuery()
  const stillThere = poll.entities.some((e) => e.key === entityKey)
  process.stdout.write(`         t+${Math.round((Date.now() - now * 1000) / 1000)}s rows=${poll.entities.length}\n`)
  if (!stillThere) {
    gone = true
    break
  }
}

const after = await dashboardQuery()
console.log(`\nAFTER    query returns ${after.entities.length} row(s)`)
console.log(`\n${gone ? "PASS" : "FAIL"}  the grant ${gone ? "expired on its own" : "is still present"}.`)

const direct = await publicClient.getEntity(entityKey).catch(() => null)
console.log(`getEntity(${entityKey.slice(0, 12)}…) -> ${direct ? "still readable" : "not found"}`)
process.exit(gone ? 0 : 1)
