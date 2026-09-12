import { createHash } from "node:crypto"
import { expect, test, type BrowserContext, type Route } from "@playwright/test"

const SWARM_ID_ORIGIN = "https://swarm-id.snaha.net"
const SWARM_GATEWAY_PATTERN = /download\.gateway\.ethswarm\.org\/bytes\//
const IDENTITY_ADDRESS = "11".repeat(20)

type ArchiveBackend = {
  blobs: Map<string, Buffer>
  feedReference?: string
  gatewayReads: number
}

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
          id: "archive-test-sender",
          name: "Archive test sender",
          address: "${IDENTITY_ADDRESS}",
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
      const response = await fetch("${SWARM_ID_ORIGIN}/__test/archive-blob", {
        method: "POST",
        body: message.data,
      })
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
      await fetch("${SWARM_ID_ORIGIN}/__test/archive-feed", {
        method: "POST",
        body: message.reference,
      })
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
    backend.gatewayReads += 1
    if (!blob) {
      await route.fulfill({ status: 404, body: "Missing" })
      return
    }
    await route.fulfill({ status: 200, contentType: "application/octet-stream", body: blob })
  })
}

test("a sender adds a panel and reads it after reload and in a fresh browser", async ({ browser, page, baseURL }) => {
  const backend: ArchiveBackend = { blobs: new Map(), gatewayReads: 0 }
  await fulfillArchiveBackend(page.context(), backend)

  await page.goto("/add")
  await expect(page.getByRole("heading", { name: "What are you adding?" })).toBeVisible()
  await page.getByRole("button", { name: /Lab or test result/ }).click()
  await page.getByLabel("Date of test").fill("2026-09-12")
  await page.getByLabel("File").setInputFiles({
    name: "panel.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "marker,value,unit,ref_low,ref_high,flag\nFerritin,38,ug/L,15,300,\nVitamin D,18,ng/mL,30,100,L\n",
    ),
  })
  await page.getByRole("button", { name: "Add to archive" }).click()

  await expect(page).toHaveURL(`${baseURL}/`)
  await expect(page.getByText("1 panel · latest 12 September").and(page.locator(":visible"))).toBeVisible()
  expect(backend.feedReference).toMatch(/^[0-9a-f]{64}$/)
  const encrypted = backend.blobs.get(backend.feedReference!)
  expect(encrypted).toBeDefined()
  expect(encrypted!.includes(Buffer.from("Ferritin"))).toBe(false)

  const readsBeforeReload = backend.gatewayReads
  await page.reload()
  await expect(page.getByText("1 panel · latest 12 September").and(page.locator(":visible"))).toBeVisible()
  expect(backend.gatewayReads).toBeGreaterThan(readsBeforeReload)

  const freshContext = await browser.newContext({ baseURL })
  await fulfillArchiveBackend(freshContext, backend)
  const freshPage = await freshContext.newPage()
  await freshPage.goto("/")
  await expect(freshPage.getByText("1 panel · latest 12 September").and(freshPage.locator(":visible"))).toBeVisible()
  await freshContext.close()
})

test("a sender adds wearable data and reads it after reload", async ({ page }) => {
  const backend: ArchiveBackend = { blobs: new Map(), gatewayReads: 0 }
  await fulfillArchiveBackend(page.context(), backend)

  await page.goto("/add")
  await page.getByRole("button", { name: /Wearable export/ }).click()
  await page.getByLabel("File").setInputFiles({
    name: "sleep.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        metric: "Sleep duration",
        unit: "hours",
        target: 8,
        values: [
          { date: "2026-09-10", value: 7.5 },
          { date: "2026-09-12", value: 8.1 },
        ],
      }),
    ),
  })
  await page.getByRole("button", { name: "Add to archive" }).click()

  await expect(page.getByText("1 kind · latest 12 September").and(page.locator(":visible"))).toBeVisible()
  await page.reload()
  await expect(page.getByText("1 kind · latest 12 September").and(page.locator(":visible"))).toBeVisible()
})

test("a genuinely empty archive keeps the empty treatment", async ({ page }) => {
  const backend: ArchiveBackend = { blobs: new Map(), gatewayReads: 0 }
  await fulfillArchiveBackend(page.context(), backend)

  await page.goto("/")
  // Four visible: the mobile `BucketRow` list and the desktop `BucketCard` grid
  // (app/(sender)/page.tsx) both render "Nothing here yet" for each empty bucket, one of
  // them always hidden via CSS rather than absent from the DOM (R3-020) — `getByText`
  // does not filter on visibility the way `getByRole` does, so an unfiltered count would
  // see all eight.
  await expect(page.getByText("Nothing here yet").and(page.locator(":visible"))).toHaveCount(4)
  await expect(page.getByText(/could not load your archive/i)).toHaveCount(0)
})

test("an archive load failure is not shown as an empty archive", async ({ page }) => {
  const backend: ArchiveBackend = {
    blobs: new Map(),
    feedReference: "33".repeat(32),
    gatewayReads: 0,
  }
  await fulfillArchiveBackend(page.context(), backend)

  await page.goto("/")
  await expect(page.getByText(/could not load your archive/i)).toBeVisible()
  await expect(page.getByText("Nothing here yet")).toHaveCount(0)
})
