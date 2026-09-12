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
import { expect, type BrowserContext, type Request, type Route } from "@playwright/test"
import { hashActionCid } from "@/lib/key-release/chipotle"
import { encodeGrantBinding, toHex } from "@/lib/crypto"

/** Default Arkiv RPC endpoint — see .env.example, NEXT_PUBLIC_ARKIV_RPC. */
export const ARKIV_RPC_PATTERN = /rpc\.tiramisu\.db-chain\.testnet\.arkiv\.network/

/** Default Swarm gateway — see .env.example, NEXT_PUBLIC_SWARM_GATEWAY. */
export const SWARM_GATEWAY_PATTERN = /download\.gateway\.ethswarm\.org\/bytes\//

/** Lit's Chipotle base — see `lib/key-release/chipotle.ts`'s `CHIPOTLE_API_BASE`. */
export const CHIPOTLE_API_PATTERN = /api\.chipotle\.litprotocol\.com/

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
/** A live entity whose payload will not parse — not the same fact as "missing". */
export type MalformedGrant = { kind: "malformed"; entityKeyHex: string; currentBlock: number }
/**
 * A wrong RPC URL, a proxy, or a down endpoint answering with a plain HTTP status — not a
 * JSON-RPC error, and not the shape the SDK uses for "no live entity" either.
 */
export type TransportFailure = { kind: "transport-fail" }
/**
 * H-69: a v3, threshold-release grant — `owner`/`expiresBlock` are the entity's own native fields
 * (see `lib/arkiv.ts`'s `toGrant`, the `payload.v === 3` branch), not attributes anyone with a key
 * could shape, so this fixture writes both the native fields and matching `sender`/`expires_block`
 * attributes rather than only one or the other.
 */
export type FoundThresholdGrant = {
  kind: "found-v3"
  entityKeyHex: string
  owner: string
  reference: string
  release: { provider: string; domain: string; ritualId: number; iv: string; ciphertext: string; grantId: string }
  expiresBlock: number
  currentBlock: number
}

/**
 * Stub the Arkiv JSON-RPC transport `getGrant`/`getCurrentBlock` call directly.
 *
 * Only the two methods the recipient path actually issues are handled —
 * `eth_blockNumber` (the chain head) and `arkiv_query` (the entity lookup). Any
 * other method is a bug in the fixture, not a real request, so it fails loudly
 * instead of reaching the network.
 */
export async function mockArkiv(
  context: BrowserContext,
  scenario: FoundGrant | FoundThresholdGrant | MissingGrant | MalformedGrant | TransportFailure,
) {
  await context.route(ARKIV_RPC_PATTERN, async (route) => {
    if (scenario.kind === "transport-fail") {
      await route.fulfill({ status: 404, contentType: "text/plain", body: "Not Found" })
      return
    }

    const { id, method } = readJsonRpc(route)

    if (method === "eth_blockNumber") {
      await route.fulfill({ json: jsonRpcResult(id, "0x" + scenario.currentBlock.toString(16)) })
      return
    }

    if (method === "arkiv_query") {
      // The query text carries the entity key as a literal, lowercase hex
      // value (`$key = key(0x…)`) — see @arkiv-network/sdk's `getEntity`. A
      // caller that asked for the wrong entity would otherwise still receive
      // this scenario's fixture data and the test would not notice.
      if (scenario.kind === "found" || scenario.kind === "found-v3" || scenario.kind === "malformed") {
        const [query] = readJsonRpc(route).params as [string, unknown]
        expect(
          query.toLowerCase(),
          "the recipient must query Arkiv for the entity key the grant actually names",
        ).toContain(scenario.entityKeyHex.toLowerCase().replace(/^0x/, ""))
      }

      if (scenario.kind === "missing") {
        await route.fulfill({
          json: jsonRpcResult(id, { data: [], blockNumber: String(scenario.currentBlock), cursor: null }),
        })
        return
      }

      // A v3, threshold-release grant — `owner`/`expiresAt` are the entity's
      // own native fields, never attributes anyone with a key could shape
      // (see lib/arkiv.ts's `toGrant`), so this fixture writes both, kept in
      // sync with each other the way a real write always is.
      if (scenario.kind === "found-v3") {
        const entity = {
          key: scenario.entityKeyHex,
          owner: scenario.owner,
          creator: scenario.owner,
          createdAt: "0x1",
          updatedAt: "0x1",
          expiresAt: "0x" + scenario.expiresBlock.toString(16),
          creationFlags: 0,
          contentType: "application/json",
          payload:
            "0x" + Buffer.from(JSON.stringify({ v: 3, ref: scenario.reference, release: scenario.release }), "utf8").toString("hex"),
          attributes: [
            { name: "filetype", type: "str", value: "pdf" },
            { name: "sender", type: "addr", value: scenario.owner },
            { name: "created_at", type: "u64", value: Math.floor(Date.now() / 1000) - 60 },
            { name: "expires_block", type: "u64", value: scenario.expiresBlock },
            { name: "recipient", type: "str", value: "blind-recipient" },
            { name: "label", type: "str", value: "blind-label" },
            { name: "file_count", type: "u64", value: 1 },
          ],
        }
        await route.fulfill({
          json: jsonRpcResult(id, { data: [entity], blockNumber: String(scenario.currentBlock), cursor: null }),
        })
        return
      }

      // A live entity, but its payload is not JSON at all — distinct from "missing"
      // (kind: "missing" above), which never puts an entity in `data` to begin with.
      const payloadHex =
        scenario.kind === "malformed"
          ? "0x" + Buffer.from("not valid json", "utf8").toString("hex")
          : "0x" +
            Buffer.from(
              JSON.stringify({ v: 2, ref: scenario.reference, authCommitment: scenario.authCommitment }),
              "utf8",
            ).toString("hex")
      const expiresBlock = scenario.kind === "malformed" ? scenario.currentBlock + 500 : scenario.expiresBlock
      const entity = {
        key: scenario.entityKeyHex,
        owner: "0x" + "11".repeat(20),
        creator: "0x" + "11".repeat(20),
        createdAt: "0x1",
        updatedAt: "0x1",
        expiresAt: "0x" + expiresBlock.toString(16),
        creationFlags: 0,
        contentType: "application/json",
        payload: payloadHex,
        attributes: [
          { name: "filetype", type: "str", value: "mixed" },
          { name: "created_at", type: "u64", value: Math.floor(Date.now() / 1000) - 60 },
          { name: "expires_block", type: "u64", value: expiresBlock },
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

/**
 * What `/api/holder/unlock` answers, for the one call the recipient path makes
 * to our server.
 *
 * `entityKeyHex` is the entity the caller is expected to name. Asserting it
 * here means a request for the wrong entity fails the test outright, rather
 * than silently receiving this scenario's fixture data — the same fixture
 * would otherwise answer for any entity key at all.
 *
 * `expectedAuthKeyB64` is the real holder's other gate, reproduced here —
 * H-58/R3-005. A live holder never runs its business logic (serve the share,
 * check a code, report locked-out) until the presented auth key matches the
 * grant's commitment; a request carrying any other key gets refused before
 * `respond` is even consulted. Without this, a stub that only ever answers
 * `respond` regardless of what `authKey` it was sent cannot tell a correct
 * unlock apart from a broken `deriveAuthKey` that sends the same wrong key for
 * every fragment — the offline suite passed in full with exactly that
 * mutation applied. `respond` still gets the full body, so a test with its own
 * multi-step protocol (a code gate, a lockout counter) can build that on top,
 * once the key itself is already known to be right.
 */
export async function mockHolderUnlock(
  context: BrowserContext,
  entityKeyHex: string,
  expectedAuthKeyB64: string,
  respond: (body: {
    entityKey: string
    authKey: string
    /** H-7: present only once the reader has submitted a code. */
    codeProof?: string
  }) => { status: number; body: unknown },
) {
  await context.route("**/api/holder/unlock", async (route) => {
    const body = route.request().postDataJSON() as { entityKey: string; authKey: string; codeProof?: string }
    expect(
      body.entityKey?.toLowerCase(),
      "the recipient must ask the holder for the entity key the grant actually names",
    ).toBe(entityKeyHex.toLowerCase())
    if (body.authKey !== expectedAuthKeyB64) {
      await route.fulfill({ status: 403, json: { error: "Not authorised for this grant" } })
      return
    }
    const { status, body: json } = respond(body)
    await route.fulfill({ status, json })
  })
}

/**
 * The holder is unreachable — `fetch` itself rejects, before any status or body
 * exists to classify. `route.abort()` is what reproduces that in Playwright,
 * distinct from `mockHolderUnlock` answering with a 5xx, which still completes.
 */
export async function mockHolderUnreachable(context: BrowserContext) {
  await context.route("**/api/holder/unlock", async (route) => {
    await route.abort("failed")
  })
}

/**
 * The Swarm gateway read: `GET /bytes/:reference` returning the sealed blob.
 *
 * Asserts the requested reference is the one the grant actually points at —
 * without it, this stub answers the same blob for any reference, so a client
 * that fetched the wrong content hash would still see the right file.
 */
export async function mockSwarmGateway(context: BrowserContext, reference: string, blob: Uint8Array) {
  await context.route(SWARM_GATEWAY_PATTERN, async (route) => {
    const requested = route.request().url().match(/\/bytes\/([0-9a-fA-F]+)/)?.[1]
    expect(requested?.toLowerCase(), "the recipient must fetch the reference the grant points at").toBe(
      reference.toLowerCase(),
    )
    await route.fulfill({ status: 200, contentType: "application/octet-stream", body: Buffer.from(blob) })
  })
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64")
}
function fromBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64"))
}

/**
 * H-69: a fake Lit Chipotle endpoint — `ping`/`list_actions`/
 * `list_wallets_in_group`/`get_lit_action_ipfs_id`/`lit_action`, enough for
 * `lib/key-release/chipotle.ts`'s real `createHttpChipotleClient` to run
 * against, unmodified, from the actual browser page under test. `arkivLedger`
 * plays the enclave's own liveness check (`chipotle-action.js`'s
 * `grantIsLive`) — a grant absent from it is refused exactly like an expired
 * or deleted one, mirroring `scripts/chipotle-adapter-proof.mjs`'s fake.
 */
export async function mockChipotle(
  context: BrowserContext,
  options: {
    actionCid: string
    pkpId: string
    arkivLedger: Map<string, { owner: string; expiresBlock: string }>
  },
) {
  async function computeCommitment(grantId: string, owner: string, expiresBlockStr: string, ref: string) {
    const bytes = encodeGrantBinding({ grantId: grantId as `0x${string}`, owner: owner as `0x${string}`, expiresBlock: BigInt(expiresBlockStr), ref })
    const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource)
    return toHex(new Uint8Array(digest))
  }

  await context.route(CHIPOTLE_API_PATTERN, async (route) => {
    const url = new URL(route.request().url())

    if (url.pathname.endsWith("/version")) {
      await route.fulfill({ status: 200, body: "ok" })
      return
    }
    if (url.pathname.endsWith("/list_actions")) {
      await route.fulfill({ json: [{ id: hashActionCid(options.actionCid) }] })
      return
    }
    if (url.pathname.endsWith("/list_wallets_in_group")) {
      await route.fulfill({ json: [{ id: "0", wallet_address: options.pkpId }] })
      return
    }
    if (url.pathname.endsWith("/get_lit_action_ipfs_id")) {
      await route.fulfill({ json: options.actionCid })
      return
    }
    if (url.pathname.endsWith("/lit_action")) {
      const body = route.request().postDataJSON() as { js_params: Record<string, string> }
      const jsParams = body.js_params
      const expected = await computeCommitment(jsParams.grantId, jsParams.owner, jsParams.expiresBlock, jsParams.ref)
      if (expected !== jsParams.commitment) {
        await route.fulfill({ json: { response: { authorized: false, error: "commitment mismatch" }, has_error: false, logs: "" } })
        return
      }
      if (jsParams.mode === "release") {
        const entry = options.arkivLedger.get(jsParams.grantId.toLowerCase())
        const live =
          entry !== undefined &&
          entry.owner.toLowerCase() === jsParams.owner.toLowerCase() &&
          entry.expiresBlock === jsParams.expiresBlock
        if (!live) {
          await route.fulfill({ json: { response: { authorized: false, error: "grant is not live" }, has_error: false, logs: "" } })
          return
        }
      }
      const inputString = jsParams.mode === "protect" ? jsParams.payload : jsParams.ciphertext
      const outputString = toBase64(Uint8Array.from(fromBase64(inputString), (b) => b ^ 0x5a))
      await route.fulfill({ json: { response: { authorized: true, result: outputString }, has_error: false, logs: "" } })
      return
    }

    await route.fulfill({ status: 501, json: `not stubbed for this test: ${url.pathname}` })
  })
}

/**
 * The only two things the offline lane may reach: this origin's own page
 * assets (the document, its scripts, styles, fonts — never an API call), and
 * the one API route the recipient path calls, `/api/holder/unlock`, which
 * `mockHolderUnlock` (or `mockHolderUnreachable`) stubs separately. Arkiv and
 * Swarm are both third-party origins and are never allowed through here —
 * `mockArkiv` and `mockSwarmGateway` register their own, more specific routes
 * on top of this one.
 */
/**
 * Exported for direct testing (H-58/R3-010) — the classification itself is
 * what a same-origin `sendBeacon` slipped past: Playwright reports it as
 * resource type `ping`, which this list did not block, so the guard treated
 * it as a page asset and let it continue to the real server.
 */
export function isAllowedOffline(request: Request, baseURL: string): boolean {
  const url = request.url()
  if (!url.startsWith(baseURL)) return false
  if (url.startsWith(`${baseURL}/api/holder/unlock`)) return true
  // A page asset — document, script, stylesheet, font, image — never a
  // same-origin API call or a beacon. This is deliberately narrower than
  // "every same-origin route": a bug that made the recipient path call some
  // other route on our own server, or fire a beacon at one, must fail here
  // too, not pass silently because it happened to share an origin with the
  // page.
  return !["fetch", "xhr", "websocket", "ping"].includes(request.resourceType())
}

/**
 * Fail anything that is not a page asset or the mocked holder route. This is
 * what makes "offline" a tested claim rather than a hope: `route.abort()`
 * alone is not an assertion — a rejection the app catches or ignores could
 * leave every UI assertion green while a real network call went out. The
 * `expect()` below turns that into a hard test failure, and it reports through
 * to the test even though it runs inside a route handler, because Playwright
 * associates route-handler assertions with the test that registered the
 * route.
 *
 * Register this first: Playwright matches routes last-registered-first, so the
 * specific stubs registered after this one win for the URLs they cover.
 */
export async function blockUnstubbedNetwork(context: BrowserContext, baseURL: string) {
  await context.route("**/*", async (route) => {
    const request = route.request()
    if (isAllowedOffline(request, baseURL)) {
      await route.continue()
      return
    }
    expect(
      request.url(),
      `the offline recipient path must never reach an unstubbed route (resourceType: ${request.resourceType()})`,
    ).toBe("<no unstubbed network in the offline lane>")
    await route.abort("failed")
  })
}
