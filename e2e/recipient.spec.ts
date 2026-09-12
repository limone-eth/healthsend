import { test, expect, type BrowserContext } from "@playwright/test"

/**
 * Recipient-path tests.
 *
 * The states that need no setup run always. The happy path needs a real share
 * link, which needs a signed-in Swarm ID and a postage batch — neither of which
 * exists headlessly — so it is driven by an env var:
 *
 *   SHARE_URL='http://localhost:3000/s/0x…#…' pnpm e2e
 *
 * Create the link in the app, paste it in, and this asserts what a guest would
 * actually see.
 */

const SHARE_URL = process.env.SHARE_URL

/** Assert the context really is empty — that is the claim under test. */
async function assertNoStoredIdentity(context: BrowserContext) {
  const cookies = await context.cookies()
  expect(cookies, "a recipient should not need a cookie").toHaveLength(0)
}

test.describe("a recipient with nothing", () => {
  test("an unknown grant reads as expired, not as an error", async ({ page, context }) => {
    await page.goto(`/s/0x${"ab".repeat(32)}#${"A".repeat(43)}`)

    await expect(page.getByText("This link has expired")).toBeVisible()
    // The distinction the product rests on: expiry is the absence of a grant,
    // and it must never be dressed up as a failure.
    await expect(page.getByText(/could not open/i)).toHaveCount(0)
    await assertNoStoredIdentity(context)
  })

  test("a link truncated at the # says so", async ({ page }) => {
    await page.goto(`/s/0x${"ab".repeat(32)}`)
    await expect(page.getByText("Incomplete link")).toBeVisible()
  })

  test("the recipient is never asked to sign in", async ({ page }) => {
    await page.goto(`/s/0x${"ab".repeat(32)}#${"A".repeat(43)}`)
    await expect(page.getByText(/continue with swarm id/i)).toHaveCount(0)
    await expect(page.getByRole("button", { name: /sign in/i })).toHaveCount(0)
  })
})

test.describe("a live send", () => {
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
