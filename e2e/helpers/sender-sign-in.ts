/**
 * The sign-in boundary every `(sender)` route shares — `app/(sender)/layout.tsx`
 * keeps `SignInScreen`'s Swarm ID container mounted until `onConnectionChange`
 * reports an identity, so `/`, `/add`, `/new`, `/shares` and `/import-review` all
 * render nothing real until this is stubbed. `deriveAppSecret` is the one other
 * call every derived key (`lib/identity.ts`) needs, and it never leaves the iframe,
 * so a real sign-in test needs both regardless of which route it targets.
 *
 * Modelled on `e2e/archive-persistence.spec.ts`'s proxy stub, trimmed to sign-in
 * only — routes that never touch the sender's archive (`/add`, `/new`, `/shares`,
 * `/import-review`) have no reason to carry its upload/feed handlers too.
 */
import type { BrowserContext, Route } from "@playwright/test"
import { ARKIV_RPC_PATTERN } from "./network"

export const SWARM_ID_ORIGIN = "https://swarm-id.snaha.net"

/** The chain head `mockGrantList` answers with — grant fixtures pick an `expiresBlock` past this. */
export const MOCK_CURRENT_BLOCK = 1_000_000

function signInProxyHtml(): string {
  return `<!doctype html>
<html><body><script>
  const parentOrigin = new URL(document.referrer).origin
  const respond = (message) => parent.postMessage(message, parentOrigin)
  parent.postMessage({ type: "proxyInitialized" }, "*")

  addEventListener("message", async (event) => {
    const message = event.data
    if (message.type === "parentIdentify") {
      respond({ type: "proxyReady", authenticated: true, parentOrigin, storageShared: true })
      respond({
        type: "connectionInfoChanged",
        canUpload: true,
        uploadMode: "subsidised",
        identity: {
          id: "ari-example",
          name: "Ari Example",
          address: "${"11".repeat(20)}",
          avatar: { source: "generated", url: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>" },
        },
      })
      return
    }
    if (message.type === "deriveAppSecret") {
      const bytes = new TextEncoder().encode(message.label)
      const digest = await crypto.subtle.digest("SHA-256", bytes)
      respond({ type: "deriveAppSecretResponse", requestId: message.requestId, secret: new Uint8Array(digest) })
      return
    }
    if (message.type === "epochFeedDownloadReference") {
      respond({ type: "epochFeedDownloadReferenceResponse", requestId: message.requestId })
    }
  })
</script></body></html>`
}

/** Stubs the Swarm ID iframe so any `(sender)` route signs in without a real passkey. */
export async function signInAsSender(context: BrowserContext) {
  await context.route(`${SWARM_ID_ORIGIN}/proxy`, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: signInProxyHtml() }),
  )
}

type MockGrantEntity = {
  entityKeyHex: string
  expiresBlock: number
  recipientBlind: string
  fileKind?: string
  fileCount?: number
}

/** A live v2 grant entity, shaped exactly as `toGrant` (lib/arkiv.ts) requires. */
export function mockGrantEntity(grant: MockGrantEntity) {
  const payloadHex =
    "0x" +
    Buffer.from(JSON.stringify({ v: 2, ref: "a".repeat(64), authCommitment: "b".repeat(64) }), "utf8").toString(
      "hex",
    )
  return {
    key: grant.entityKeyHex,
    owner: "0x" + "11".repeat(20),
    creator: "0x" + "11".repeat(20),
    createdAt: "0x1",
    updatedAt: "0x1",
    expiresAt: "0x" + grant.expiresBlock.toString(16),
    creationFlags: 0,
    contentType: "application/json",
    payload: payloadHex,
    attributes: [
      { name: "filetype", type: "str", value: grant.fileKind ?? "mixed" },
      { name: "created_at", type: "u64", value: Math.floor(Date.now() / 1000) - 60 },
      { name: "expires_block", type: "u64", value: grant.expiresBlock },
      { name: "recipient", type: "str", value: grant.recipientBlind },
      { name: "label", type: "str", value: "blind-label" },
      { name: "file_count", type: "u64", value: grant.fileCount ?? 1 },
    ],
  }
}

/**
 * Stubs the Arkiv RPC transport for `listGrants` (lib/arkiv.ts) — the sender
 * dashboard's `select().where().ownedBy().fetch()` walk, which runs over the same
 * `arkiv_query` method `e2e/helpers/network.ts`'s `mockArkiv` stubs for the
 * recipient's single-entity `getEntity` read. One page, no cursor: every fixture
 * used against this repo's sender routes fits well under the 200-row page cap
 * `verify:grant-paging` (scripts/grant-paging-proof.mjs) exists to guard.
 */
export async function mockGrantList(context: BrowserContext, entities: ReturnType<typeof mockGrantEntity>[]) {
  await context.route(ARKIV_RPC_PATTERN, async (route: Route) => {
    const { id, method } = route.request().postDataJSON() as { id: number; method: string }
    if (method === "eth_blockNumber") {
      await route.fulfill({ json: { jsonrpc: "2.0", id, result: "0x" + MOCK_CURRENT_BLOCK.toString(16) } })
      return
    }
    if (method === "arkiv_query") {
      // No `cursor` key at all, not `cursor: null` — the SDK's `hasNextPage()` is
      // `this.cursor !== undefined`, and `JSON.parse` turns a `null` into a value that
      // is not `undefined`, so a literal `null` here paginates forever (`listGrants`'s
      // `MAX_LIST_PAGES` guard is what actually caught this while writing the fixture).
      await route.fulfill({
        json: { jsonrpc: "2.0", id, result: { data: entities, blockNumber: String(MOCK_CURRENT_BLOCK) } },
      })
      return
    }
    await route.fulfill({
      status: 501,
      json: { jsonrpc: "2.0", id, error: { code: -32601, message: `not stubbed for this test: ${method}` } },
    })
  })
}
