import { test, expect, type BrowserContext } from "@playwright/test"
import { buildShareFixture } from "./helpers/fixture"
import {
  blockUnstubbedNetwork,
  mockArkiv,
  mockHolderUnlock,
  mockHolderUnreachable,
  mockSwarmGateway,
} from "./helpers/network"
import { packEntityKey } from "@/lib/crypto"

/**
 * Recipient-path tests.
 *
 * Two lanes:
 *
 *   offline (default) — every recipient state, driven entirely by Playwright
 *   route stubs. No Swarm ID, no funded Arkiv key, no Upstash, no network. This
 *   is what `pnpm test` and a plain `pnpm e2e` run.
 *
 *   live (opt-in, tag @live) — the original test against a real share link,
 *   which needs a signed-in Swarm ID and a postage batch, neither of which
 *   exists headlessly:
 *
 *     SHARE_URL='http://localhost:3000/s/0x…#…' pnpm exec playwright test --grep @live
 *
 *   playwright.config.ts excludes @live from the default run (`grepInvert`), so
 *   it only runs when explicitly asked for. It still no-ops without SHARE_URL,
 *   via the `test.skip` below — belt and braces.
 */

const SHARE_URL = process.env.SHARE_URL

/** Assert the context really is empty — that is the claim under test. */
async function assertNoStoredIdentity(context: BrowserContext) {
  const cookies = await context.cookies()
  expect(cookies, "a recipient should not need a cookie").toHaveLength(0)
}

test.describe("a recipient with nothing", () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await blockUnstubbedNetwork(context, baseURL!)
  })

  test("an unknown grant reads as expired, not as an error", async ({ page, context }) => {
    await mockArkiv(context, { kind: "missing", currentBlock: 1_000_000 })
    await page.goto(`/s/0x${"ab".repeat(32)}#${"A".repeat(43)}`)

    await expect(page.getByText("This link has expired")).toBeVisible()
    // The distinction the product rests on: expiry is the absence of a grant,
    // and it must never be dressed up as a failure.
    await expect(page.getByText(/could not open/i)).toHaveCount(0)
    await assertNoStoredIdentity(context)
  })

  test("a link truncated at the # says so", async ({ page }) => {
    // No fragment: `openSend` returns "no-key" before touching the network, so
    // no Arkiv stub is registered here — the still-active block would catch a
    // regression that made this path fetch anyway.
    await page.goto(`/s/0x${"ab".repeat(32)}`)
    await expect(page.getByText("Incomplete link")).toBeVisible()
  })

  test("the recipient is never asked to sign in", async ({ page, context }) => {
    await mockArkiv(context, { kind: "missing", currentBlock: 1_000_000 })
    await page.goto(`/s/0x${"ab".repeat(32)}#${"A".repeat(43)}`)
    await expect(page.getByText(/continue with swarm id/i)).toHaveCount(0)
    await expect(page.getByRole("button", { name: /sign in/i })).toHaveCount(0)
  })
})

test.describe("the five ways a share link resolves, offline", () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await blockUnstubbedNetwork(context, baseURL!)
  })

  test("ok — a share opens and its documents render", async ({ page, context }) => {
    const share = await buildShareFixture()
    await mockArkiv(context, {
      kind: "found",
      entityKeyHex: share.entityKeyHex,
      reference: share.reference,
      authCommitment: share.commitment,
      expiresBlock: share.expiresBlock,
      currentBlock: share.currentBlock,
    })
    await mockHolderUnlock(context, () => ({
      status: 200,
      body: { share: share.heldShare, expiresAt: Math.floor(Date.now() / 1000) + 900 },
    }))
    await mockSwarmGateway(context, share.blob)

    await page.goto(`/s/${share.packedKey}#${share.fragment}`)

    // A bundle of two: the nav carries both filenames, and the active one's
    // content is actually decrypted and rendered — not just "the page loaded".
    await expect(page.getByRole("button", { name: "thyroid-panel.csv" })).toBeVisible()
    await expect(page.getByRole("button", { name: "consult-notes.txt" })).toBeVisible()
    await expect(page.locator("table")).toBeVisible()
    await expect(page.getByText("TSH")).toBeVisible()
    await assertNoStoredIdentity(context)
  })

  test("expired — the grant is gone", async ({ page, context }) => {
    await mockArkiv(context, { kind: "missing", currentBlock: 1_000_000 })
    await page.goto(`/s/0x${"cd".repeat(32)}#${"B".repeat(43)}`)

    await expect(page.getByText("This link has expired")).toBeVisible()
    // Direction one of the distinction: expiry never offers a retry — there is
    // nothing to retry.
    await expect(page.getByText(/try again/i)).toHaveCount(0)
    await expect(page.getByText("Temporarily unavailable")).toHaveCount(0)
  })

  test("unavailable — the holder is down, and the grant is not expired", async ({ page, context }) => {
    const share = await buildShareFixture()
    await mockArkiv(context, {
      kind: "found",
      entityKeyHex: share.entityKeyHex,
      reference: share.reference,
      authCommitment: share.commitment,
      expiresBlock: share.expiresBlock,
      currentBlock: share.currentBlock,
    })
    await mockHolderUnlock(context, () => ({
      status: 503,
      body: { error: "Could not reach the holder", retryable: true },
    }))

    await page.goto(`/s/${share.packedKey}#${share.fragment}`)

    await expect(page.getByText("Temporarily unavailable")).toBeVisible()
    await expect(page.getByText(/try again/i)).toBeVisible()
    // Direction two of the distinction: unavailable must never claim the link
    // itself expired.
    await expect(page.getByText("This link has expired", { exact: true })).toHaveCount(0)
  })

  test("revoked — the sender ended it early, distinct from expiry", async ({ page, context }) => {
    const share = await buildShareFixture()
    await mockArkiv(context, {
      kind: "found",
      entityKeyHex: share.entityKeyHex,
      reference: share.reference,
      authCommitment: share.commitment,
      expiresBlock: share.expiresBlock,
      currentBlock: share.currentBlock,
    })
    // The holder tells a revoke apart from a lapsed grant with the same 410 plus
    // a `revoked` flag — see lib/unlock.ts and app/api/holder/unlock/route.ts.
    await mockHolderUnlock(context, () => ({
      status: 410,
      body: { error: "expired", revoked: true },
    }))

    await page.goto(`/s/${share.packedKey}#${share.fragment}`)

    await expect(page.getByText("Access to this send has ended")).toBeVisible()
    await expect(page.getByText(/the sender ended it early/i)).toBeVisible()
    // Direction one: a revoke must never read as the natural-expiry copy.
    await expect(page.getByText("This link has expired")).toHaveCount(0)
    await expect(page.getByText(/nobody ended this early/i)).toHaveCount(0)
  })

  test("no-key — a link missing its fragment says so", async ({ page }) => {
    await page.goto(`/s/0x${"ef".repeat(32)}`)
    await expect(page.getByText("Incomplete link")).toBeVisible()
  })

  test("error — a link secret that does not match the grant", async ({ page, context }) => {
    const share = await buildShareFixture()
    await mockArkiv(context, {
      kind: "found",
      entityKeyHex: share.entityKeyHex,
      reference: share.reference,
      authCommitment: share.commitment,
      expiresBlock: share.expiresBlock,
      currentBlock: share.currentBlock,
    })
    // The holder compares the presented auth key's hash against the grant's
    // commitment; a wrong fragment derives a wrong auth key, and any wrong auth
    // key gets the same answer, so the stub does not need to replay the HMAC.
    await mockHolderUnlock(context, () => ({
      status: 403,
      body: { error: "Not authorised for this grant" },
    }))

    // A fragment that is well-formed but is not the one that seals this share.
    await page.goto(`/s/${share.packedKey}#${"Z".repeat(22)}`)

    await expect(page.getByText("Could not open this send")).toBeVisible()
    await expect(page.getByText("This link has expired", { exact: true })).toHaveCount(0)
  })
})

test.describe("infrastructure failures are never dressed up as expiry", () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await blockUnstubbedNetwork(context, baseURL!)
  })

  test("a 404 from the Arkiv RPC reads as unavailable, not expiry", async ({ page, context }) => {
    // A wrong RPC URL, a proxy, or a down endpoint — an HTTP 404 that is not a
    // JSON-RPC response at all, and structurally nothing like the SDK's own
    // "no live entity" signal. See lib/arkiv.ts, getGrant.
    await mockArkiv(context, { kind: "transport-fail" })
    await page.goto(`/s/0x${"12".repeat(32)}#${"C".repeat(43)}`)

    await expect(page.getByText("Temporarily unavailable")).toBeVisible()
    await expect(page.getByText("This link has expired")).toHaveCount(0)
    await expect(page.getByText("Could not open this send")).toHaveCount(0)
  })

  test("a malformed live entity reads as an error, not expiry", async ({ page, context }) => {
    // The entity is live — Arkiv answers with a row — but its payload is not
    // JSON. Distinct from "missing", which never puts a row in the result at
    // all. See lib/arkiv.ts, MalformedGrantError.
    const entityKeyHex = "0x" + "9c".repeat(32)
    await mockArkiv(context, { kind: "malformed", entityKeyHex, currentBlock: 1_000_000 })
    await page.goto(`/s/${packEntityKey(entityKeyHex)}#${"D".repeat(43)}`)

    await expect(page.getByText("Could not open this send")).toBeVisible()
    await expect(page.getByText("This link has expired")).toHaveCount(0)
    await expect(page.getByText("Temporarily unavailable")).toHaveCount(0)
  })

  test("a rejected holder fetch reads as unavailable, not a decryption error", async ({
    page,
    context,
  }) => {
    // `fetch("/api/holder/unlock")` rejects outright — no response, no status,
    // nothing to classify. The ordinary shape of an unreachable holder. See
    // lib/sends.ts, openSend.
    const share = await buildShareFixture()
    await mockArkiv(context, {
      kind: "found",
      entityKeyHex: share.entityKeyHex,
      reference: share.reference,
      authCommitment: share.commitment,
      expiresBlock: share.expiresBlock,
      currentBlock: share.currentBlock,
    })
    await mockHolderUnreachable(context)

    await page.goto(`/s/${share.packedKey}#${share.fragment}`)

    await expect(page.getByText("Temporarily unavailable")).toBeVisible()
    await expect(page.getByText("Could not open this send")).toHaveCount(0)
    await expect(page.getByText("This link has expired", { exact: true })).toHaveCount(0)
  })
})

test.describe("a live send", { tag: "@live" }, () => {
  test.skip(!SHARE_URL, "set SHARE_URL to a freshly created share link")

  test("opens in a clean context and shows every document", async ({ page, context }) => {
    await page.goto(SHARE_URL!)

    await expect(page.getByText("Shared with you")).toBeVisible()
    await expect(page.getByText("This link has expired")).toHaveCount(0)

    // No account was involved in reading this.
    await assertNoStoredIdentity(context)

    // A bundle exposes one button per document; a single send exposes none.
    const tabs = page.locator("nav button")
    const count = await tabs.count()
    if (count > 0) {
      for (let i = 0; i < count; i++) {
        await tabs.nth(i).click()
        await expect(page.locator("table, pre, iframe").first()).toBeVisible()
      }
    } else {
      await expect(page.locator("table, pre, iframe").first()).toBeVisible()
    }
  })

  test("offers no download control", async ({ page }) => {
    await page.goto(SHARE_URL!)
    await expect(page.getByText("Shared with you")).toBeVisible()
    // We never hand the reader a file. The PDF path suppresses the built-in
    // viewer chrome too, so there is no Download button anywhere on the page.
    await expect(page.locator("a[download]")).toHaveCount(0)
    await expect(page.getByRole("button", { name: /download|save/i })).toHaveCount(0)
  })
})
