import { createHash } from "node:crypto"
import { test, expect, type BrowserContext, type Route } from "@playwright/test"

/**
 * H-66 — the mobile archive (`app/(sender)/page.tsx`) used to render the desktop
 * `BucketCard` grid shrunk to one column, or a fixed-height `BucketRow` list for five
 * mostly-empty groups (R3-020). Both are gone: the mobile list is now the blood test PDF
 * rows read from frame `W1yi5` (`J1The0`, via the pencil MCP tool against
 * `healthsend.pen`), still a fixed 62px shell, but one row per archived PDF rather than
 * one per bucket.
 *
 * Broke by design: change `DocumentRowMobile`'s `h-[62px]` to anything else in
 * app/(sender)/page.tsx and the height assertion below goes red.
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
          id: "archive-mobile-rows-sender",
          name: "Archive mobile rows sender",
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

test.use({ viewport: { width: 400, height: 900 } })

test("mobile archive renders one fixed 62px row per PDF, not a bucket grid", async ({ page }) => {
  // Sign-in is handled by this backend's own `/proxy` stub (below) — registering
  // `signInAsSender`'s separate, simpler stub on top of it shadows the archive
  // upload/feed handlers and the add flow never completes.
  const backend: ArchiveBackend = { blobs: new Map() }
  await fulfillArchiveBackend(page.context(), backend)

  await page.goto("/add")
  await page.getByRole("button", { name: /A letter or report/ }).click()
  await page.getByLabel("File").setInputFiles([
    { name: "Full blood count, March.pdf", mimeType: "application/pdf", buffer: fakePdf("march") },
    { name: "Thyroid panel, June.pdf", mimeType: "application/pdf", buffer: fakePdf("june") },
  ])
  await page.getByRole("button", { name: "Add to archive" }).click()
  await expect(page).toHaveURL(/\/$/)

  const names = ["Full blood count, March.pdf", "Thyroid panel, June.pdf"]
  const rows: { name: string; y: number }[] = []
  for (const name of names) {
    // The desktop `DocumentRow` renders the same name in its own hidden-at-400px DOM
    // (R3-020's pattern) — narrow to the one currently visible before measuring it.
    const box = await page
      .getByText(name, { exact: true })
      .filter({ visible: true })
      .locator("..")
      .locator("..")
      .boundingBox()
    if (!box) throw new Error(`expected the "${name}" row to have a layout box`)
    // The old bucket card/row was a different height; the frame's PDF row is a fixed 62px.
    expect(Math.round(box.height)).toBe(62)
    rows.push({ name, y: box.y })
  }

  // A single column, top to bottom, in add order — not a grid.
  expect(rows[1].y).toBeGreaterThan(rows[0].y)

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})
