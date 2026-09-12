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
    await mockHolderUnlock(context, share.entityKeyHex, () => ({
      status: 200,
      body: { share: share.heldShare, expiresAt: Math.floor(Date.now() / 1000) + 900 },
    }))
    await mockSwarmGateway(context, share.reference, share.blob)

    await page.goto(`/s/${share.packedKey}#${share.fragment}`)

    // A bundle of two: the nav carries both filenames, and the active one's
    // content is actually decrypted and rendered — not just "the page loaded".
    await expect(page.getByRole("button", { name: "thyroid-panel.csv" })).toBeVisible()
    await expect(page.getByRole("button", { name: "consult-notes.txt" })).toBeVisible()
    await expect(page.locator("table")).toBeVisible()
    await expect(page.getByText("TSH")).toBeVisible()

    // The second document must actually open, not just have a visible tab:
    // clicking it must swap the rendered content, not silently keep showing
    // the first file.
    await page.getByRole("button", { name: "consult-notes.txt" }).click()
    await expect(page.getByText("CONSULT NOTE")).toBeVisible()
    await expect(page.locator("table")).toHaveCount(0)

    await assertNoStoredIdentity(context)
  })

  test("expiry while a document is open closes it, not just at the initial load", async ({
    page,
    context,
  }) => {
    // The countdown in `Viewer` (app/s/[key]/page.tsx) is the access, not a
    // decoration beside it: when the window closes while a reader has the page
    // open, the document must actually go away under them. Every other test in
    // this file either starts already expired or never lets enough wall-clock
    // time pass to reach the boundary live, so this is the only test that
    // watches the live-to-expired transition happen.
    const share = await buildShareFixture()
    await mockArkiv(context, {
      kind: "found",
      entityKeyHex: share.entityKeyHex,
      reference: share.reference,
      authCommitment: share.commitment,
      // One block out — a couple of seconds of wall-clock life, long enough to
      // render and short enough not to slow the suite down.
      expiresBlock: share.currentBlock + 1,
      currentBlock: share.currentBlock,
    })
    await mockHolderUnlock(context, share.entityKeyHex, () => ({
      status: 200,
      body: { share: share.heldShare, expiresAt: Math.floor(Date.now() / 1000) + 900 },
    }))
    await mockSwarmGateway(context, share.reference, share.blob)

    await page.goto(`/s/${share.packedKey}#${share.fragment}`)

    await expect(page.getByText("TSH")).toBeVisible()

    await expect(page.getByText("This link has expired")).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText("TSH")).toHaveCount(0)
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
    await mockHolderUnlock(context, share.entityKeyHex, () => ({
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
    await mockHolderUnlock(context, share.entityKeyHex, () => ({
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
    // It does need to check that the request actually carries a *different*
    // key than the real one, though — otherwise this stub would return 403 for
    // the correct fragment too, and the test would never notice the app had
    // stopped deriving a distinct key per fragment.
    await mockHolderUnlock(context, share.entityKeyHex, (body) => {
      expect(
        body.authKey,
        "a wrong fragment must derive a different auth key than the real one",
      ).not.toBe(share.authKeyB64)
      return { status: 403, body: { error: "Not authorised for this grant" } }
    })

    // A fragment that is well-formed but is not the one that seals this share.
    await page.goto(`/s/${share.packedKey}#${"Z".repeat(22)}`)

    await expect(page.getByText("Could not open this send")).toBeVisible()
    await expect(page.getByText("This link has expired", { exact: true })).toHaveCount(0)
  })
})

test.describe("a coded share, offline (H-7)", () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await blockUnstubbedNetwork(context, baseURL!)
  })

  /**
   * A single stub playing the holder's real protocol: refuse a bare probe
   * with "a code is required", refuse anything but the right proof with
   * "wrong code", and only then serve the share. This is what makes the test
   * below exercise the actual two-step flow rather than assuming it.
   */
  async function mockCodedHolder(context: BrowserContext, entityKeyHex: string, codeHash: string, heldShare: string) {
    await mockHolderUnlock(context, entityKeyHex, (body) => {
      if (!body.codeProof) return { status: 401, body: { error: "A code is required to open this", codeRequired: true } }
      if (body.codeProof !== codeHash) {
        return { status: 401, body: { error: "That code is not right", wrongCode: true } }
      }
      return { status: 200, body: { share: heldShare, expiresAt: Math.floor(Date.now() / 1000) + 900 } }
    })
  }

  test("the code screen renders before anything else, and holds at 400 and 1440 with no overflow", async ({
    page,
    context,
  }) => {
    const share = await buildShareFixture("4821")
    await mockArkiv(context, {
      kind: "found",
      entityKeyHex: share.entityKeyHex,
      reference: share.reference,
      authCommitment: share.commitment,
      expiresBlock: share.expiresBlock,
      currentBlock: share.currentBlock,
    })
    await mockCodedHolder(context, share.entityKeyHex, share.codeHash!, share.heldShare)

    for (const width of [400, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto(`/s/${share.packedKey}#${share.fragment}`)

      await expect(page.getByText("The four-digit code you were sent separately")).toBeVisible()
      // 3.1's own claim: nothing about the document renders behind this gate.
      await expect(page.getByText("TSH")).toHaveCount(0)

      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }))
      expect(scrollWidth, `must not overflow horizontally at ${width}px`).toBeLessThanOrEqual(clientWidth)
    }
  })

  test("a wrong code fails closed with its own status, then the right code opens it", async ({
    page,
    context,
  }) => {
    const share = await buildShareFixture("4821")
    await mockArkiv(context, {
      kind: "found",
      entityKeyHex: share.entityKeyHex,
      reference: share.reference,
      authCommitment: share.commitment,
      expiresBlock: share.expiresBlock,
      currentBlock: share.currentBlock,
    })
    await mockCodedHolder(context, share.entityKeyHex, share.codeHash!, share.heldShare)
    await mockSwarmGateway(context, share.reference, share.blob)

    await page.goto(`/s/${share.packedKey}#${share.fragment}`)
    await expect(page.getByText("The four-digit code you were sent separately")).toBeVisible()

    const enterCode = async (digits: string) => {
      const boxes = page.getByRole("textbox", { name: /code digit/i })
      for (let i = 0; i < digits.length; i++) {
        await boxes.nth(i).fill(digits[i])
      }
    }

    // Wrong code: its own status, never the generic "could not open", never
    // "expired", never "unavailable" — and no document ever rendered.
    await enterCode("0000")
    await page.getByRole("button", { name: "Open it" }).click()
    await expect(page.getByText("That code isn't right.")).toBeVisible()
    await expect(page.getByText("This link has expired")).toHaveCount(0)
    await expect(page.getByText("Temporarily unavailable")).toHaveCount(0)
    await expect(page.getByText("Could not open this send")).toHaveCount(0)
    await expect(page.getByText("TSH")).toHaveCount(0)

    // The right code opens it — proving the crypto path (linkShare mixed with
    // the code) actually reconstructs the same content key `createSend` split.
    await enterCode("4821")
    await page.getByRole("button", { name: "Open it" }).click()
    await expect(page.getByText("TSH")).toBeVisible()
  })

  test("locked out reads as its own status too, distinct from a single wrong guess", async ({
    page,
    context,
  }) => {
    const share = await buildShareFixture("4821")
    await mockArkiv(context, {
      kind: "found",
      entityKeyHex: share.entityKeyHex,
      reference: share.reference,
      authCommitment: share.commitment,
      expiresBlock: share.expiresBlock,
      currentBlock: share.currentBlock,
    })
    await mockHolderUnlock(context, share.entityKeyHex, (body) => {
      if (!body.codeProof) return { status: 401, body: { error: "required", codeRequired: true } }
      return {
        status: 401,
        body: { error: "Too many attempts — ask the sender for a new link", wrongCode: true, locked: true },
      }
    })

    await page.goto(`/s/${share.packedKey}#${share.fragment}`)
    const boxes = page.getByRole("textbox", { name: /code digit/i })
    for (let i = 0; i < 4; i++) await boxes.nth(i).fill("0")
    await page.getByRole("button", { name: "Open it" }).click()

    await expect(page.getByText("Too many attempts. Ask the sender for a new link.")).toBeVisible()
    await expect(page.getByRole("button", { name: "Open it" })).toBeDisabled()
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
