/**
 * The network boundary a recipient's browser actually touches.
 *
 * `openSend` (lib/sends.ts) never calls our own server for the read path except
 * `/api/holder/unlock`. The grant lookup (`getGrant`, `getCurrentBlock`) goes
 * straight from the browser to the Arkiv JSON-RPC endpoint, and the ciphertext
 * comes straight from the Swarm gateway. To run the recipient offline, all three
 * have to be stubbed — not just the two our own server owns.
 *
 * These helpers stub Playwright routes; the application never learns it is under
 * test.
 */
import type { BrowserContext, Route } from "@playwright/test"

/** Default Arkiv RPC endpoint — see .env.example, NEXT_PUBLIC_ARKIV_RPC. */
export const ARKIV_RPC_PATTERN = /rpc\.tiramisu\.db-chain\.testnet\.arkiv\.network/

/** Default Swarm gateway — see .env.example, NEXT_PUBLIC_SWARM_GATEWAY. */
export const SWARM_GATEWAY_PATTERN = /download\.gateway\.ethswarm\.org\/bytes\//

type JsonRpcBody = { id: number; method: string; params: unknown[] }

function jsonRpcResult(id: number, result: unknown) {
  return { jsonrpc: "2.0", id, result }
}

function readJsonRpc(route: Route): JsonRpcBody {
  return route.request().postDataJSON() as JsonRpcBody
}

export type FoundGrant = {
  kind: "found"
  entityKeyHex: string
  reference: string
  authCommitment: string
  expiresBlock: number
  currentBlock: number
}
export type MissingGrant = { kind: "missing"; currentBlock: number }

/**
 * Stub the Arkiv JSON-RPC transport `getGrant`/`getCurrentBlock` call directly.
 *
 * Only the two methods the recipient path actually issues are handled —
 * `eth_blockNumber` (the chain head) and `arkiv_query` (the entity lookup). Any
 * other method is a bug in the fixture, not a real request, so it fails loudly
 * instead of reaching the network.
 */
export async function mockArkiv(context: BrowserContext, scenario: FoundGrant | MissingGrant) {
  await context.route(ARKIV_RPC_PATTERN, async (route) => {
    const { id, method } = readJsonRpc(route)

    if (method === "eth_blockNumber") {
      await route.fulfill({ json: jsonRpcResult(id, "0x" + scenario.currentBlock.toString(16)) })
      return
    }

    if (method === "arkiv_query") {
      if (scenario.kind === "missing") {
        await route.fulfill({
          json: jsonRpcResult(id, { data: [], blockNumber: String(scenario.currentBlock), cursor: null }),
        })
        return
      }
      const payload = JSON.stringify({
        v: 2,
        ref: scenario.reference,
        authCommitment: scenario.authCommitment,
      })
      const payloadHex = "0x" + Buffer.from(payload, "utf8").toString("hex")
      const entity = {
        key: scenario.entityKeyHex,
        owner: "0x" + "11".repeat(20),
        creator: "0x" + "11".repeat(20),
        createdAt: "0x1",
        updatedAt: "0x1",
        expiresAt: "0x" + scenario.expiresBlock.toString(16),
        creationFlags: 0,
        contentType: "application/json",
        payload: payloadHex,
        attributes: [
          { name: "filetype", type: "str", value: "mixed" },
          { name: "created_at", type: "u64", value: Math.floor(Date.now() / 1000) - 60 },
          { name: "expires_block", type: "u64", value: scenario.expiresBlock },
          { name: "recipient", type: "str", value: "blind-recipient" },
          { name: "label", type: "str", value: "blind-label" },
          { name: "file_count", type: "u64", value: 2 },
        ],
      }
      await route.fulfill({
        json: jsonRpcResult(id, { data: [entity], blockNumber: String(scenario.currentBlock), cursor: null }),
      })
      return
    }

    // An RPC method this fixture does not know means the recipient path changed
    // shape; fail the request rather than letting it fall through to the network.
    await route.fulfill({
      status: 501,
      json: { jsonrpc: "2.0", id, error: { code: -32601, message: `not stubbed for this test: ${method}` } },
    })
  })
}

/** What `/api/holder/unlock` answers, for the one call the recipient path makes to our server. */
export async function mockHolderUnlock(
  context: BrowserContext,
  respond: (body: { entityKey: string; authKey: string }) => { status: number; body: unknown },
) {
  await context.route("**/api/holder/unlock", async (route) => {
    const body = route.request().postDataJSON() as { entityKey: string; authKey: string }
    const { status, body: json } = respond(body)
    await route.fulfill({ status, json })
  })
}

/** The Swarm gateway read: `GET /bytes/:reference` returning the sealed blob. */
export async function mockSwarmGateway(context: BrowserContext, blob: Uint8Array) {
  await context.route(SWARM_GATEWAY_PATTERN, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/octet-stream", body: Buffer.from(blob) })
  })
}

/**
 * Fail anything that is not the app's own origin and was not given an explicit
 * stub above. This is what makes "offline" a tested claim rather than a hope —
 * a change that made the recipient path reach a new service would fail the
 * suite instead of quietly passing over a real network call.
 *
 * Register this first: Playwright matches routes last-registered-first, so the
 * specific stubs registered after this one win for the URLs they cover.
 */
export async function blockUnstubbedNetwork(context: BrowserContext, baseURL: string) {
  await context.route("**/*", async (route) => {
    if (route.request().url().startsWith(baseURL)) {
      await route.continue()
      return
    }
    await route.abort("failed")
  })
}
