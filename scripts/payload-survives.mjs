/**
 * The honest counterpart to `verify:expiry`.
 *
 * That script shows a grant leaving the live query surface on its own. This one
 * shows what that does *not* achieve: the payload written by the creating
 * transaction — including the wrapped content key — is still in that
 * transaction's calldata, readable by anyone, after the entity is gone.
 *
 * We believed for most of a day that expiry destroyed the wrapped key. It does
 * not. This script exists so nobody has to take either claim on trust.
 *
 *   node scripts/payload-survives.mjs <txHash> [entityKey]
 */

import { createPublicClient as createArkivClient } from "@arkiv-network/sdk"
import { tiramisu } from "@arkiv-network/sdk/chains"
import { createPublicClient, http } from "viem"

const [txHash, entityKey] = process.argv.slice(2)
if (!txHash) {
  console.error("usage: node scripts/payload-survives.mjs <txHash> [entityKey]")
  process.exit(1)
}

const arkiv = createArkivClient({ chain: tiramisu, transport: http() })
const chain = createPublicClient({ chain: tiramisu, transport: http() })

if (entityKey) {
  let state = "gone from the query surface"
  try {
    if (await arkiv.getEntity(entityKey)) state = "still live"
  } catch {}
  console.log(`entity   ${entityKey}`)
  console.log(`status   ${state}\n`)
}

const tx = await chain.getTransaction({ hash: txHash })
const printable = Buffer.from(tx.input.slice(2), "hex")
  .toString("utf8")
  .replace(/[^\x20-\x7e]/g, ".")

// The payload is JSON, so it survives as readable text in the calldata.
const match = printable.match(/\{"v":\d+.*?\}\}/)

console.log(`tx       ${txHash}`)
console.log(`block    ${tx.blockNumber}`)
console.log(`calldata ${printable.length} bytes\n`)

if (match) {
  console.log("PAYLOAD RECOVERED FROM CALLDATA:\n")
  console.log(`  ${match[0]}\n`)
  console.log("The wrapped content key is in there. It is public, it is permanent,")
  console.log("and no expiry removes it. Anyone holding the link fragment can pair")
  console.log("the two and decrypt for as long as the Swarm blob survives.")
  process.exit(0)
}

console.log("No JSON payload found in this transaction's calldata.")
process.exit(1)
