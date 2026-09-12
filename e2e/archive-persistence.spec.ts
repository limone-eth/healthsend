import { createHash } from "node:crypto"
import { expect, test, type BrowserContext, type Route } from "@playwright/test"
import { mockGrantList } from "./helpers/sender-sign-in"

const SWARM_ID_ORIGIN = "https://swarm-id.snaha.net"
const SWARM_GATEWAY_PATTERN = /download\.gateway\.ethswarm\.org\/bytes\//
const IDENTITY_ADDRESS = "11".repeat(20)

type ArchiveBackend = {
  blobs: Map<string, Buffer>
  feedReference?: string
  gatewayReads: number
  /**
   * H-70's lagging-feed test mode. When set, a GET on the feed keeps
   * answering the reference from before the most recent write for this many
   * reads before it catches up — the same lag docs/stories/H-70.md describes
   * ("cleared with no error, and the list still said 1 BLOOD TEST").
   */
  lagReads?: number
  visibleFeedReference?: string
  remainingLaggedReads?: number
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
      const reference = route.request().postData() ?? undefined
      backend.feedReference = reference
      if (backend.lagReads) {
        // The write lands, but a GET keeps answering the old reference for
        // `lagReads` more reads — `visibleFeedReference` only catches up once
        // that lag is read through, below.
        backend.remainingLaggedReads = backend.lagReads
      } else {
        backend.visibleFeedReference = reference
      }
      await route.fulfill({ status: 204 })
      return
    }
    let answer = backend.visibleFeedReference
    if (backend.lagReads) {
      if ((backend.remainingLaggedReads ?? 0) > 0) {
        backend.remainingLaggedReads = (backend.remainingLaggedReads ?? 0) - 1
      } else {
        backend.visibleFeedReference = backend.feedReference
        answer = backend.visibleFeedReference
      }
    } else {
      answer = backend.feedReference
    }
    if (!answer) {
      await route.fulfill({ status: 404, body: "No archive" })
      return
    }
    await route.fulfill({ status: 200, contentType: "text/plain", body: answer })
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

// H-66 narrows this screen to PDFs: a blood-panel record must still round-trip through
// the archive (proven independently by scripts/archive-roundtrip.mjs), but it must not
// appear as a row here, and it must not stop the empty state from showing.
// Broke by design: drop the `record.kind === "document"` filter in `ArchiveScreen`
// (app/(sender)/page.tsx) and this panel starts rendering as if it were a PDF.
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
  await expect(page.getByText("No blood test PDFs yet")).toBeVisible()
  await expect(page.getByText(/Ferritin/)).toHaveCount(0)
  expect(backend.feedReference).toMatch(/^[0-9a-f]{64}$/)
  const encrypted = backend.blobs.get(backend.feedReference!)
  expect(encrypted).toBeDefined()
  expect(encrypted!.includes(Buffer.from("Ferritin"))).toBe(false)

  const readsBeforeReload = backend.gatewayReads
  await page.reload()
  await expect(page.getByText("No blood test PDFs yet")).toBeVisible()
  expect(backend.gatewayReads).toBeGreaterThan(readsBeforeReload)

  const freshContext = await browser.newContext({ baseURL })
  await fulfillArchiveBackend(freshContext, backend)
  const freshPage = await freshContext.newPage()
  await freshPage.goto("/")
  await expect(freshPage.getByText("No blood test PDFs yet")).toBeVisible()
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

  // A wearable series is not a blood test PDF: the archive page must still show its
  // empty state, not a "1 kind · latest ..." bucket summary (that group is gone).
  await expect(page.getByText("No blood test PDFs yet")).toBeVisible()
  await page.reload()
  await expect(page.getByText("No blood test PDFs yet")).toBeVisible()
})

// Broke by design: change `eyebrowLabel`'s singular branch in app/(sender)/page.tsx from
// "BLOOD TEST" to "BLOOD TESTS" and the singular assertion below goes red.
test("a genuinely empty archive keeps the empty treatment", async ({ page }) => {
  const backend: ArchiveBackend = { blobs: new Map(), gatewayReads: 0 }
  await fulfillArchiveBackend(page.context(), backend)

  await page.goto("/")
  await expect(page.getByText("No blood test PDFs yet")).toBeVisible()
  await expect(page.getByText(/could not load your archive/i)).toHaveCount(0)
  await expect(page.getByText(/BLOOD TEST/)).toHaveCount(0)
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
  await expect(page.getByText("No blood test PDFs yet")).toHaveCount(0)
})

const isoDayMonth = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: "UTC" })
function fakePdf(label: string): Buffer {
  return Buffer.from(`%PDF-1.4\n% ${label}\n%%EOF\n`)
}

test("a sender picks two PDFs in one go and reads both after reload", async ({ page }) => {
  const backend: ArchiveBackend = { blobs: new Map(), gatewayReads: 0 }
  await fulfillArchiveBackend(page.context(), backend)

  await page.goto("/add")
  await page.getByRole("button", { name: /A letter or report/ }).click()
  await page.getByLabel("File").setInputFiles([
    { name: "Blood test, March.pdf", mimeType: "application/pdf", buffer: fakePdf("march") },
    { name: "Thyroid panel, June.pdf", mimeType: "application/pdf", buffer: fakePdf("june") },
  ])
  const blobsBeforeAdd = backend.blobs.size
  await page.getByRole("button", { name: "Add to archive" }).click()

  await expect(page).toHaveURL(/\/$/)
  const today = isoDayMonth.format(new Date())
  // H-66: the eyebrow counts real rows, not a bucket summary.
  await expect(page.getByText("2 BLOOD TESTS · PDF")).toBeVisible()
  // Each row renders in both the mobile and desktop DOM, one hidden by CSS (R3-020), so
  // the name text exists twice — narrow to the currently-visible copy before asserting.
  await expect(page.getByText("Blood test, March.pdf", { exact: true }).filter({ visible: true })).toBeVisible()
  await expect(page.getByText("Thyroid panel, June.pdf", { exact: true }).filter({ visible: true })).toBeVisible()
  await expect(
    page.getByText(new RegExp(`added ${today}`)).filter({ visible: true }),
  ).toHaveCount(2)

  // The whole pick is one archive upload, not one per file.
  expect(backend.blobs.size).toBe(blobsBeforeAdd + 1)

  await page.reload()
  await expect(page.getByText("Blood test, March.pdf", { exact: true }).filter({ visible: true })).toBeVisible()
  await expect(page.getByText("Thyroid panel, June.pdf", { exact: true }).filter({ visible: true })).toBeVisible()
})

// Broke by design: point the archive's "Add blood tests" back at /add and the file chooser
// never opens on "/".
test("Add blood tests opens the PDF picker straight from the archive", async ({ page }) => {
  const backend: ArchiveBackend = { blobs: new Map(), gatewayReads: 0 }
  await fulfillArchiveBackend(page.context(), backend)

  await page.goto("/")
  await expect(page.getByText("No blood test PDFs yet")).toBeVisible()

  const chooserEvent = page.waitForEvent("filechooser")
  await page.getByRole("button", { name: "Add blood tests" }).filter({ visible: true }).first().click()
  const chooser = await chooserEvent
  const blobsBeforeAdd = backend.blobs.size
  await chooser.setFiles([
    { name: "Blood test, March.pdf", mimeType: "application/pdf", buffer: fakePdf("march") },
    { name: "Thyroid panel, June.pdf", mimeType: "application/pdf", buffer: fakePdf("june") },
  ])

  await expect(page.getByText("2 BLOOD TESTS · PDF")).toBeVisible()
  await expect(page.getByText("Blood test, March.pdf", { exact: true }).filter({ visible: true })).toBeVisible()
  await expect(page.getByText("Thyroid panel, June.pdf", { exact: true }).filter({ visible: true })).toBeVisible()
  await expect(page).toHaveURL(/\/$/)
  // The whole pick is still one archive upload.
  expect(backend.blobs.size).toBe(blobsBeforeAdd + 1)

  await page.reload()
  await expect(page.getByText("2 BLOOD TESTS · PDF")).toBeVisible()
})

test("a non-PDF renamed .pdf is rejected and nothing is uploaded", async ({ page }) => {
  const backend: ArchiveBackend = { blobs: new Map(), gatewayReads: 0 }
  await fulfillArchiveBackend(page.context(), backend)

  await page.goto("/add")
  await page.getByRole("button", { name: /A letter or report/ }).click()
  await page.getByLabel("File").setInputFiles({
    name: "not-really-a-pdf.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("just some text, not a PDF"),
  })
  await page.getByRole("button", { name: "Add to archive" }).click()

  // The rejection says the file name once and ends the sentence, with no "Could not add
  // these PDFs: Not a PDF:" stutter. Broke by design: restore the old message in
  // lib/archive-input.ts's NotAPdfError and this goes red.
  await expect(page.getByText("“not-really-a-pdf.pdf” isn't a PDF, so nothing was added.", { exact: true })).toBeVisible()
  await expect(page.getByText(/Could not add/)).toHaveCount(0)
  await expect(page).toHaveURL(/\/add$/)
  expect(backend.blobs.size).toBe(0)
})

/**
 * Every row renders in both the mobile and desktop DOM at once, one hidden by CSS —
 * `getByRole` would otherwise match both copies' identically-labelled buttons.
 */
function removeButton(page: import("@playwright/test").Page, name: string) {
  return page.getByRole("button", { name: `Remove ${name} from your archive` }).filter({ visible: true })
}

/**
 * Whatever this device remembered about its own last archive write, read
 * straight out of `localStorage` under H-70's own key prefix. Used to prove
 * the acceptance criterion directly rather than trust the store's own
 * account of itself: only a Swarm reference and a revision number, never
 * archive content or key material.
 */
async function readRememberedWrites(page: import("@playwright/test").Page): Promise<unknown[]> {
  return page.evaluate(() => {
    const values: unknown[] = []
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i)
      if (!key?.startsWith("healthsend:archive-last-write:")) continue
      values.push(JSON.parse(window.localStorage.getItem(key)!))
    }
    return values
  })
}

// H-70: two adds and a removal fired back to back, against a feed that keeps
// answering the reference from before each write for two more reads — the
// lag docs/stories/H-70.md describes ("cleared with no error, and the list
// still said 1 BLOOD TEST"). Every change must show at once, and none may be
// silently overwritten by the next one starting from a stale read.
async function runLaggingFeedFlow({
  page,
  context,
  browser,
  baseURL,
}: {
  page: import("@playwright/test").Page
  context: BrowserContext
  browser: import("@playwright/test").Browser
  baseURL: string | undefined
}) {
  const backend: ArchiveBackend = { blobs: new Map(), gatewayReads: 0, lagReads: 2 }
  await fulfillArchiveBackend(context, backend)
  await mockGrantList(context, [])

  await page.goto("/")
  await expect(page.getByText("No blood test PDFs yet")).toBeVisible()

  const firstChooser = page.waitForEvent("filechooser")
  await page.getByRole("button", { name: "Add blood tests" }).filter({ visible: true }).first().click()
  await (await firstChooser).setFiles([
    { name: "Blood test, March.pdf", mimeType: "application/pdf", buffer: fakePdf("march") },
    { name: "Thyroid panel, June.pdf", mimeType: "application/pdf", buffer: fakePdf("june") },
  ])
  await expect(page.getByText("2 BLOOD TESTS · PDF")).toBeVisible()

  // What this write left in localStorage: only a reference and a rev, and
  // neither the PDF bytes nor "Thyroid" nor "June" appear anywhere in it.
  const rememberedAfterFirstAdd = await readRememberedWrites(page)
  expect(rememberedAfterFirstAdd.length).toBeGreaterThan(0)
  for (const remembered of rememberedAfterFirstAdd) {
    expect(Object.keys(remembered as object).sort()).toEqual(["reference", "rev"])
    const serialized = JSON.stringify(remembered)
    expect(serialized).not.toMatch(/Thyroid|June|PDF-1\.4/)
  }

  // A third pick straight after, while the feed is still lagging behind the
  // first write: the list must show all three without a reload.
  const secondChooser = page.waitForEvent("filechooser")
  await page.getByRole("button", { name: "Add blood tests" }).filter({ visible: true }).first().click()
  await (await secondChooser).setFiles([
    { name: "Lipid panel, July.pdf", mimeType: "application/pdf", buffer: fakePdf("july") },
  ])
  await expect(page.getByText("3 BLOOD TESTS · PDF")).toBeVisible()
  await expect(page.getByText("Blood test, March.pdf", { exact: true }).filter({ visible: true })).toBeVisible()
  await expect(page.getByText("Thyroid panel, June.pdf", { exact: true }).filter({ visible: true })).toBeVisible()
  await expect(page.getByText("Lipid panel, July.pdf", { exact: true }).filter({ visible: true })).toBeVisible()

  // Remove one, feed still lagging: the row goes at once.
  await removeButton(page, "Thyroid panel, June.pdf").click()
  await expect(page.getByRole("dialog")).toBeVisible()
  await page.getByRole("button", { name: "Remove it" }).click()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expect(page.getByText("2 BLOOD TESTS · PDF")).toBeVisible()
  await expect(page.getByText("Thyroid panel, June.pdf")).toHaveCount(0)
  await expect(page.getByText("Blood test, March.pdf", { exact: true }).filter({ visible: true })).toBeVisible()
  await expect(page.getByText("Lipid panel, July.pdf", { exact: true }).filter({ visible: true })).toBeVisible()

  // A genuinely fresh context has no local memory of its own — unlike this
  // page's reload, above, which the store's own remembered write already
  // carries through the lag. So the feed's lag window is read through first,
  // on this device, before that fresh context reads: exactly `lagReads`
  // reads answer the stale, pre-removal reference, and this device's own
  // remembered write keeps the screen correct through every one of them.
  for (let read = 0; read < backend.lagReads!; read++) {
    await page.reload()
    await expect(page.getByText("2 BLOOD TESTS · PDF")).toBeVisible()
    await expect(page.getByText("Thyroid panel, June.pdf")).toHaveCount(0)
  }

  // Reload in a fresh context: the final state — March and July, not June — is there.
  const freshContext = await browser.newContext({ baseURL })
  await fulfillArchiveBackend(freshContext, backend)
  await mockGrantList(freshContext, [])
  const freshPage = await freshContext.newPage()
  await freshPage.goto("/")
  await expect(freshPage.getByText("2 BLOOD TESTS · PDF")).toBeVisible()
  await expect(freshPage.getByText("Blood test, March.pdf", { exact: true }).filter({ visible: true })).toBeVisible()
  await expect(freshPage.getByText("Lipid panel, July.pdf", { exact: true }).filter({ visible: true })).toBeVisible()
  await expect(freshPage.getByText("Thyroid panel, June.pdf")).toHaveCount(0)
  await freshContext.close()
}

test.describe("desktop, 1440px", () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test("adds and a removal show at once and survive a lagging feed, with the right state after reload", async ({
    page,
    context,
    browser,
    baseURL,
  }) => {
    await runLaggingFeedFlow({ page, context, browser, baseURL })
  })
})

test.describe("mobile, 400px", () => {
  test.use({ viewport: { width: 400, height: 800 } })

  test("adds and a removal show at once and survive a lagging feed, with the right state after reload", async ({
    page,
    context,
    browser,
    baseURL,
  }) => {
    await runLaggingFeedFlow({ page, context, browser, baseURL })
  })
})
