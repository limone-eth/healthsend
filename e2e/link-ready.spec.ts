import { expect, test, type BrowserContext, type Page } from "@playwright/test"
import { mockArkivWrite, mockFundAndHolderShare } from "./helpers/arkiv-write"

/**
 * H-71 — 2.5 Link ready: a longer link, an exact end, and what's inside.
 *
 * Reaching this screen means completing a real send end to end — pick files,
 * choose a window, click "Create the link" — which means `createSend`
 * (lib/sends.ts) has to actually succeed, grant write included. No spec in
 * this suite has driven that click before (`archive-send.spec.ts`'s own
 * comment explains why: a *real* grant write needs a *real* funded chain
 * transaction). `./helpers/arkiv-write.ts` answers the same JSON-RPC calls
 * `@arkiv-network/sdk`'s `createEntity` makes against a transport this test
 * controls instead of the live testnet, so the click completes offline. The
 * fund and holder-share routes are mocked the same way `/api/holder/unlock`
 * already is elsewhere in this suite — real route handlers, never run.
 */

const SWARM_ID_ORIGIN = "https://swarm-id.snaha.net"

function proxyHtml(): string {
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
          id: "link-ready-test-sender",
          name: "Link ready test sender",
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
    // No archive — this story sends freshly-picked files, not archived ones.
    if (message.type === "epochFeedDownloadReference") {
      respond({ type: "epochFeedDownloadReferenceResponse", requestId: message.requestId })
      return
    }
    if (message.type === "uploadData") {
      const bytes = new Uint8Array(message.data)
      const digest = await crypto.subtle.digest("SHA-256", bytes)
      const reference = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("")
      respond({ type: "uploadDataResponse", requestId: message.requestId, reference })
    }
  })
</script></body></html>`
}

async function mockSendInfrastructure(context: BrowserContext) {
  await context.route(`${SWARM_ID_ORIGIN}/proxy`, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: proxyHtml() }),
  )
  await mockArkivWrite(context)
  await mockFundAndHolderShare(context)
}

function visibleText(page: Page, text: string | RegExp) {
  return page.getByText(text).and(page.locator(":visible"))
}

function visibleButton(page: Page, name: string | RegExp) {
  return page.getByRole("button", { name }).and(page.locator(":visible"))
}

/**
 * Pick two fresh PDFs, tick "Documents", choose the 2-minute window, and
 * click "Create the link" — real clicks throughout, not a direct navigation.
 * Handles both the phone step flow (a "Continue" step between scope and
 * settings) and the desktop single-screen layout.
 */
async function createTwoPdfShare(page: Page, isMobile: boolean) {
  await page.goto("/new")
  await expect(page.getByRole("heading", { name: "New share" })).toBeVisible()

  await page.locator('div.rounded-card:visible input[type="file"]').setInputFiles([
    { name: "Blood test, March.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%march\n%%EOF\n") },
    { name: "Thyroid panel, June.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%june\n%%EOF\n") },
  ])
  await visibleButton(page, "Select all files").click()

  if (isMobile) {
    await visibleButton(page, "Continue").click()
  }

  await visibleButton(page, "2 min").click()
  await visibleButton(page, "Create the link").click()

  await expect(page.getByRole("heading", { name: "Your link is ready" })).toBeVisible({ timeout: 20_000 })
}

test.describe("Link ready", () => {
  for (const { name, width, height, isMobile } of [
    { name: "desktop (1440)", width: 1440, height: 900, isMobile: false },
    { name: "phone (400)", width: 400, height: 900, isMobile: true },
  ]) {
    test.describe(name, () => {
      test.beforeEach(async ({ page, context }) => {
        await page.setViewportSize({ width, height })
        await mockSendInfrastructure(context)
      })

      test("shows most of the link, never the fragment", async ({ page }) => {
        await createTwoPdfShare(page, isMobile)

        const linkText = await visibleText(page, /\/s\//).innerText()
        expect(linkText).not.toContain("#")
        // The old `truncateLink` cut host+path to 26 characters and appended
        // its own "…", so `healthsend.vercel.app/s/La…` (27 characters, and
        // ending in the literal character) used to pass a loose length
        // check. A packed entity key makes any full host + path well past
        // 40 characters, and CSS `truncate` never inserts the character into
        // the DOM text itself — it only clips how much of it paints.
        expect(linkText.length).toBeGreaterThan(40)
        expect(linkText.endsWith("…")).toBe(false)
      })

      test("when it ends carries a clock time for a 2-minute share", async ({ page }) => {
        await createTwoPdfShare(page, isMobile)

        // `LinkReady`'s old copy read a bare date ("13 September 2026") for a
        // share ending minutes away — `endMoment` (components/countdown-copy.ts)
        // always names a clock time within the same day. The "When it ends"
        // row states it with the kept length figure alongside; the greeting
        // above states the same moment in a sentence, so match the row.
        await expect(visibleText(page, /today at \d{2}:\d{2} · 2 minutes/)).toBeVisible()
      })

      test("carries no row about what the recipient sees about the sender", async ({ page }) => {
        await createTwoPdfShare(page, isMobile)

        await expect(page.getByText(/see about you/i)).toHaveCount(0)
      })

      test("What's in it opens to both document names and closes again", async ({ page }) => {
        await createTwoPdfShare(page, isMobile)

        const disclosure = visibleButton(page, /What's in it/)
        await expect(disclosure).toHaveAttribute("aria-expanded", "false")
        await expect(page.getByText("Blood test, March.pdf")).toHaveCount(0)

        await disclosure.click()
        await expect(disclosure).toHaveAttribute("aria-expanded", "true")
        await expect(visibleText(page, "Blood test, March.pdf")).toBeVisible()
        await expect(visibleText(page, "Thyroid panel, June.pdf")).toBeVisible()

        await disclosure.click()
        await expect(disclosure).toHaveAttribute("aria-expanded", "false")
        await expect(page.getByText("Blood test, March.pdf")).toHaveCount(0)
      })

      test("no horizontal overflow", async ({ page }) => {
        await createTwoPdfShare(page, isMobile)

        const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
        expect(scrollWidth).toBeLessThanOrEqual(width)
      })
    })
  }
})
