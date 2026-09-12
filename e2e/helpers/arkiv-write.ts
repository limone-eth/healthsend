import { encodeAbiParameters, encodeEventTopics, keccak256, toHex } from "viem"
import type { BrowserContext, Route } from "@playwright/test"
import { ARKIV_RPC_PATTERN } from "./network"

/**
 * Stub a real Arkiv grant *write* — `createGrant` (lib/arkiv.ts), which signs
 * and sends a genuine chain transaction through `@arkiv-network/sdk`'s
 * `createEntity`, then reads the new entity key back out of the receipt's
 * `EntityCreated` log.
 *
 * Every other Arkiv fixture in this suite (`network.ts`'s `mockArkiv`,
 * `sender-sign-in.ts`'s `mockGrantList`) only ever answers the *read* side —
 * `eth_blockNumber` and `arkiv_query` — because a write has never been driven
 * through the real UI here before (see `archive-send.spec.ts`'s own comment:
 * "a live grant write needs a funded chain transaction this suite cannot make
 * headlessly"). That is true of the *real* testnet; it is not true of a
 * transport this suite controls. `writeContract`'s standard JSON-RPC
 * sequence — nonce, gas, fee, `eth_sendRawTransaction`, then
 * `eth_getTransactionReceipt` — is answered here with fixed, valid-shaped
 * values, and the receipt carries one ABI-correct `EntityCreated` log so the
 * SDK's own `decodeEventLog` accepts it. Nothing about the log's `entityKey`
 * or `owner` is asserted against anywhere else, so fixed values are enough —
 * this fixture proves the UI path completes, not that a specific key was
 * minted.
 */

const ARKIV_ADDRESS = "0x4400000000000000000000000000000000000044"
const ENTITY_CREATED_ABI = [
  {
    type: "event",
    name: "EntityCreated",
    inputs: [
      { name: "entityKey", type: "bytes32", indexed: true },
      { name: "owner", type: "address", indexed: true },
      { name: "expiresAt", type: "uint64", indexed: false },
      { name: "creationFlags", type: "uint8", indexed: false },
    ],
  },
] as const

function jsonRpcResult(id: number, result: unknown) {
  return { jsonrpc: "2.0", id, result }
}
function jsonRpcError(id: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code: -32601, message } }
}

/** A block shape complete enough for viem's fee-history probe, not a real chain state. */
function fakeBlock(blockNumber: bigint) {
  return {
    number: toHex(blockNumber),
    hash: "0x" + "22".repeat(32),
    parentHash: "0x" + "00".repeat(32),
    nonce: "0x0000000000000000",
    sha3Uncles: "0x" + "00".repeat(32),
    logsBloom: "0x" + "00".repeat(256),
    transactionsRoot: "0x" + "00".repeat(32),
    stateRoot: "0x" + "00".repeat(32),
    receiptsRoot: "0x" + "00".repeat(32),
    miner: "0x" + "00".repeat(20),
    difficulty: "0x0",
    totalDifficulty: "0x0",
    extraData: "0x",
    size: "0x0",
    gasLimit: "0x1000000",
    gasUsed: "0x0",
    timestamp: toHex(BigInt(Math.floor(Date.now() / 1000))),
    transactions: [] as string[],
    uncles: [] as string[],
  }
}

export async function mockArkivWrite(context: BrowserContext, currentBlock = 1_000_000) {
  let nonce = 0
  let lastReceipt: Record<string, unknown> | null = null

  await context.route(ARKIV_RPC_PATTERN, async (route: Route) => {
    const body = route.request().postDataJSON() as { id: number; method: string; params: unknown[] }
    const { id, method, params } = body

    switch (method) {
      case "eth_chainId":
        await route.fulfill({ json: jsonRpcResult(id, toHex(BigInt(7_738_577))) })
        return
      case "eth_blockNumber":
        await route.fulfill({ json: jsonRpcResult(id, toHex(BigInt(currentBlock))) })
        return
      case "eth_getBlockByNumber":
        await route.fulfill({ json: jsonRpcResult(id, fakeBlock(BigInt(currentBlock))) })
        return
      case "eth_getTransactionCount":
        await route.fulfill({ json: jsonRpcResult(id, toHex(nonce)) })
        return
      case "eth_estimateGas":
        await route.fulfill({ json: jsonRpcResult(id, toHex(BigInt(500_000))) })
        return
      case "eth_maxPriorityFeePerGas":
        // Refused on purpose: pushes the SDK's wallet client onto the legacy
        // `eth_gasPrice` path instead of EIP-1559, one RPC method fewer to fake.
        await route.fulfill({ json: jsonRpcError(id, "not supported") })
        return
      case "eth_gasPrice":
        await route.fulfill({ json: jsonRpcResult(id, toHex(BigInt(1_000_000_000))) })
        return
      case "eth_sendRawTransaction": {
        nonce += 1
        const raw = (params as [string])[0] as `0x${string}`
        const txHash = keccak256(raw)
        const entityKey = ("0x" + "aa".repeat(32)) as `0x${string}`
        const owner = ("0x" + "bb".repeat(20)) as `0x${string}`
        const topics = encodeEventTopics({
          abi: ENTITY_CREATED_ABI,
          eventName: "EntityCreated",
          args: { entityKey, owner },
        })
        const data = encodeAbiParameters(
          [
            { name: "expiresAt", type: "uint64" },
            { name: "creationFlags", type: "uint8" },
          ],
          [BigInt(999_999_999), 0],
        )
        lastReceipt = {
          transactionHash: txHash,
          status: "0x1",
          blockNumber: toHex(BigInt(currentBlock) + BigInt(1)),
          blockHash: "0x" + "11".repeat(32),
          transactionIndex: "0x0",
          from: owner,
          to: ARKIV_ADDRESS,
          contractAddress: null,
          cumulativeGasUsed: "0x1",
          gasUsed: "0x1",
          effectiveGasPrice: "0x1",
          logsBloom: "0x" + "00".repeat(256),
          logs: [
            {
              address: ARKIV_ADDRESS,
              topics,
              data,
              blockNumber: toHex(BigInt(currentBlock) + BigInt(1)),
              transactionHash: txHash,
              transactionIndex: "0x0",
              blockHash: "0x" + "11".repeat(32),
              logIndex: "0x0",
              removed: false,
            },
          ],
        }
        await route.fulfill({ json: jsonRpcResult(id, txHash) })
        return
      }
      case "eth_getTransactionReceipt":
        await route.fulfill({ json: jsonRpcResult(id, lastReceipt) })
        return
      default:
        // A 200 with a JSON-RPC-level error, not an HTTP error status: viem's
        // own `prepareTransactionRequest` opportunistically tries a combined
        // "fill" call and falls back to individual RPC calls when it errors,
        // which only happens cleanly for this shape of response.
        await route.fulfill({ json: jsonRpcError(id, `not stubbed for this test: ${method}`) })
    }
  })
}

/**
 * The two same-origin server calls a fresh `createSend` makes besides Arkiv
 * and Swarm: the gas top-up and handing the key share to the holder. Both
 * are mocked away rather than let their real route handlers run — those
 * handlers call the real funder/holder store, which do not exist for this
 * fixture's fake identity and grant.
 */
export async function mockFundAndHolderShare(context: BrowserContext) {
  await context.route("**/api/fund", (route) => route.fulfill({ json: { funded: true } }))
  await context.route("**/api/holder/share", (route) => {
    if (route.request().method() === "GET") {
      route.fulfill({ json: { ok: true } })
      return
    }
    route.fulfill({ json: { stored: true } })
  })
}
