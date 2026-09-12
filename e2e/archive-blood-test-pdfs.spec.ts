import { createHash } from "node:crypto"
import { test, expect, type BrowserContext, type Route } from "@playwright/test"

/**
 * H-66 — "Your archive" becomes the list of blood test PDFs, frames `M2g5J2` (desktop)
 * and `W1yi5` (mobile), read via the pencil MCP tool against `healthsend.pen`. Each test
 * below guards one behaviour the redesign added to `app/(sender)/page.tsx`; the comment on
 * each names the line that, if reverted, turns it red.
 */

const SWARM_ID_ORIGIN = "https://swarm-id.snaha.net"
const SWARM_GATEWAY_PATTERN = /download\.gateway\.ethswarm\.org\/bytes\//

type ArchiveBackend = { blobs: Map<string, Buffer>; feedReference?: string }

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
          id: "blood-test-pdfs-sender",
          name: "Blood test PDFs sender",
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
    if (message.type === "uploadData") {
      const response = await fetch("${SWARM_ID_ORIGIN}/__test/archive-blob", { method: "POST", body: message.data })
      respond({ type: "uploadDataResponse", requestId: message.requestId, reference: await response.text() })
      return
    }
    if (message.type === "epochFeedDownloadReference") {
      const response = await fetch("${SWARM_ID_ORIGIN}/__test/archive-feed")
      respond({
        type: "epochFeedDownloadReferenceResponse",
        requestId: message.requestId,
        ...(response.ok ? { reference: await response.text() } : {}),
      })
      return
    }
    if (message.type === "epochFeedUploadReference") {
      await fetch("${SWARM_ID_ORIGIN}/__test/archive-feed", { method: "POST", body: message.reference })
      respond({
        type: "epochFeedUploadReferenceResponse",
        requestId: message.requestId,
        socAddress: "${"22".repeat(32)}",
        epoch: { start: message.at, level: 0 },
        timestamp: message.at,
      })
    }
  })
</script></body></html>`
}

async function fulfillArchiveBackend(context: BrowserContext, backend: ArchiveBackend) {
  await context.route(`${SWARM_ID_ORIGIN}/proxy`, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: proxyHtml() }),
  )
  await context.route(`${SWARM_ID_ORIGIN}/__test/archive-blob`, async (route) => {
    const bytes = route.request().postDataBuffer() ?? Buffer.alloc(0)
    const reference = createHash("sha256").update(bytes).digest("hex")
    backend.blobs.set(reference, bytes)
    await route.fulfill({ status: 200, contentType: "text/plain", body: reference })
  })
  await context.route(`${SWARM_ID_ORIGIN}/__test/archive-feed`, async (route) => {
    if (route.request().method() === "POST") {
      backend.feedReference = route.request().postData() ?? undefined
      await route.fulfill({ status: 204 })
      return
    }
    if (!backend.feedReference) {
      await route.fulfill({ status: 404, body: "No archive" })
      return
    }
    await route.fulfill({ status: 200, contentType: "text/plain", body: backend.feedReference })
  })
  await context.route(SWARM_GATEWAY_PATTERN, async (route: Route) => {
    const reference = route.request().url().split("/").at(-1) ?? ""
    const blob = backend.blobs.get(reference)
    if (!blob) {
      await route.fulfill({ status: 404, body: "Missing" })
      return
    }
    await route.fulfill({ status: 200, contentType: "application/octet-stream", body: blob })
  })
}

function fakePdf(label: string): Buffer {
  return Buffer.from(`%PDF-1.4\n% ${label}\n%%EOF\n`)
}

async function addTwoPdfs(page: import("@playwright/test").Page) {
  await page.goto("/add")
  await page.getByRole("button", { name: /A letter or report/ }).click()
  await page.getByLabel("File").setInputFiles([
    { name: "Full blood count.pdf", mimeType: "application/pdf", buffer: fakePdf("full") },
    { name: "Lipid panel.pdf", mimeType: "application/pdf", buffer: fakePdf("lipid") },
  ])
  await page.getByRole("button", { name: "Add to archive" }).click()
  await expect(page).toHaveURL(/\/$/)
}

async function overflowPx(page: import("@playwright/test").Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
}

/**
 * Every row and note renders in both the mobile and desktop DOM at once, one hidden by
 * CSS depending on viewport (R3-020's pattern) — `getByText` matches both copies, which
 * `toBeVisible()` then refuses outright ("strict mode violation") rather than picking one.
 * Narrow to the currently-visible copy before asserting.
 */
function visibleText(page: import("@playwright/test").Page, text: string) {
  return page.getByText(text, { exact: true }).filter({ visible: true })
}

test.describe("desktop, 1440px", () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  // Broke by design: revert the header lede in `ArchiveHeader` (app/(sender)/page.tsx)
  // back to "Everything you have imported, in six groups." and this goes red.
  test("header carries the PDF-focused title, lede and primary action", async ({ page }) => {
    const backend: ArchiveBackend = { blobs: new Map() }
    await fulfillArchiveBackend(page.context(), backend)
    await page.goto("/")

    await expect(page.getByRole("heading", { name: "Your archive" })).toBeVisible()
    await expect(
      page.getByText(
        "Your blood test PDFs, exactly as the lab sent them. Nothing leaves this page unless you share it.",
      ),
    ).toBeVisible()
    // The primary action opens a multi-file PDF picker in place — no "What are you adding?"
    // chooser in between. Broke by design: turn `AddBloodTestsButton` back into a link to
    // /add and the file chooser never opens.
    const chooserEvent = page.waitForEvent("filechooser")
    await page.getByRole("button", { name: "Add blood tests" }).first().click()
    const chooser = await chooserEvent
    expect(chooser.isMultiple()).toBe(true)
    expect(await chooser.element().getAttribute("accept")).toContain("application/pdf")
    await expect(page).toHaveURL(/\/$/)
  })

  // Broke by design: hardcode `eyebrowLabel` in app/(sender)/page.tsx to always return
  // "3 BLOOD TESTS · PDF" and this goes red once a second PDF is added.
  test("the eyebrow count is the real row count, and rows carry PDF · size · date", async ({ page }) => {
    const backend: ArchiveBackend = { blobs: new Map() }
    await fulfillArchiveBackend(page.context(), backend)
    await addTwoPdfs(page)

    await expect(page.getByText("2 BLOOD TESTS · PDF")).toBeVisible()
    await expect(visibleText(page, "Full blood count.pdf")).toBeVisible()
    await expect(visibleText(page, "Lipid panel.pdf")).toBeVisible()
    await expect(page.getByText(/^PDF · \d+ B · added \d{1,2} \w+$/).first()).toBeVisible()

    await page.reload()
    await expect(page.getByText("2 BLOOD TESTS · PDF")).toBeVisible()
    await expect(visibleText(page, "Full blood count.pdf")).toBeVisible()
    await expect(visibleText(page, "Lipid panel.pdf")).toBeVisible()
  })

  // Broke by design: render `E2P3ZU`-style "Not shared" pill unconditionally on every
  // `DocumentRow` in app/(sender)/page.tsx — this data does not exist yet (H-64), and
  // the first assertion below goes red the moment that pill reappears.
  test("no share-status pill is guessed at, and the desktop card ends in an Add row", async ({ page }) => {
    const backend: ArchiveBackend = { blobs: new Map() }
    await fulfillArchiveBackend(page.context(), backend)
    await addTwoPdfs(page)

    await expect(page.getByText("Not shared")).toHaveCount(0)
    await expect(page.getByText(/^In \d+ share/)).toHaveCount(0)
    await expect(page.getByText("Add blood tests — pick one or several PDFs")).toBeVisible()
  })

  // Broke by design: restore the old identity copy ("Your name and date of birth are
  // separated…") in place of `SharedAsIssuedNote` — false for a PDF, and this goes red.
  test("the identity note says PDFs are shared exactly as issued", async ({ page }) => {
    const backend: ArchiveBackend = { blobs: new Map() }
    await fulfillArchiveBackend(page.context(), backend)
    await addTwoPdfs(page)

    await expect(visibleText(page, "Shared as issued")).toBeVisible()
    await expect(
      visibleText(
        page,
        "Each PDF is shared exactly as your lab sent it — including your name and date of birth, if they are printed on it.",
      ),
    ).toBeVisible()
    await expect(page.getByText(/separated from the rest/)).toHaveCount(0)
  })

  test("the empty state offers one action, not five empty buckets", async ({ page }) => {
    const backend: ArchiveBackend = { blobs: new Map() }
    await fulfillArchiveBackend(page.context(), backend)
    await page.goto("/")

    await expect(page.getByText("No blood test PDFs yet")).toBeVisible()
    await expect(page.getByText("Blood panels")).toHaveCount(0)
    await expect(page.getByText("Wearables")).toHaveCount(0)
    await expect(page.getByText("Medications")).toHaveCount(0)
    expect(await overflowPx(page)).toBeLessThanOrEqual(0)
  })

  test("populated archive has zero horizontal overflow at 1440px", async ({ page }) => {
    const backend: ArchiveBackend = { blobs: new Map() }
    await fulfillArchiveBackend(page.context(), backend)
    await addTwoPdfs(page)
    expect(await overflowPx(page)).toBeLessThanOrEqual(0)
  })
})

test.describe("mobile, 400px", () => {
  test.use({ viewport: { width: 400, height: 900 } })

  // Broke by design: revert the mobile lede in `ArchiveHeader` back to the desktop
  // string instead of frame `W1yi5`'s shorter one, and this goes red.
  test("mobile header carries its own shorter lede", async ({ page }) => {
    const backend: ArchiveBackend = { blobs: new Map() }
    await fulfillArchiveBackend(page.context(), backend)
    await page.goto("/")

    await expect(page.getByRole("heading", { name: "Your archive" })).toBeVisible()
    await expect(page.getByText("Your blood test PDFs, as the lab sent them.")).toBeVisible()
  })

  // Broke by design: use `formatFullDate` instead of `formatShortDate` in
  // `DocumentRowMobile` (app/(sender)/page.tsx) and the "Mar"-style short month below
  // is replaced by the full month name, going red.
  test("mobile rows drop the PDF prefix and abbreviate the month", async ({ page }) => {
    const backend: ArchiveBackend = { blobs: new Map() }
    await fulfillArchiveBackend(page.context(), backend)
    await addTwoPdfs(page)

    await expect(page.getByText("2 BLOOD TESTS · PDF")).toBeVisible()
    await expect(visibleText(page, "Full blood count.pdf")).toBeVisible()
    // en-GB's short month for September is "Sept", four letters, not the three every other
    // month gets — don't assume a fixed length, just that it's a short month name.
    await expect(page.getByText(/^\d+ B · added \d{1,2} \w+$/).first()).toBeVisible()
  })

  // Broke by design: swap the mobile note's `Eye` glyph/copy for the desktop pair in
  // `SharedAsIssuedNote` — the shorter mobile sentence below stops matching and this
  // goes red.
  test("mobile identity note uses the shorter, no-pill copy", async ({ page }) => {
    const backend: ArchiveBackend = { blobs: new Map() }
    await fulfillArchiveBackend(page.context(), backend)
    await addTwoPdfs(page)

    await expect(visibleText(page, "Any name or date of birth on the PDF goes with it.")).toBeVisible()
    // The desktop note's own title, "Shared as issued", contains the substring "as issued"
    // and `getByText` matches case-insensitively — an unexact query for "As issued" would
    // false-positive on that title. `exact: true` (via `visibleText`) is required here, not
    // just for style: without it this assertion cannot tell the pill from the title.
    await expect(visibleText(page, "As issued")).toHaveCount(0)
  })

  test("populated archive has zero horizontal overflow at 400px", async ({ page }) => {
    const backend: ArchiveBackend = { blobs: new Map() }
    await fulfillArchiveBackend(page.context(), backend)
    await addTwoPdfs(page)
    expect(await overflowPx(page)).toBeLessThanOrEqual(0)
  })

  test("empty archive has zero horizontal overflow at 400px", async ({ page }) => {
    const backend: ArchiveBackend = { blobs: new Map() }
    await fulfillArchiveBackend(page.context(), backend)
    await page.goto("/")
    await expect(page.getByText("No blood test PDFs yet")).toBeVisible()
    expect(await overflowPx(page)).toBeLessThanOrEqual(0)
  })
})
