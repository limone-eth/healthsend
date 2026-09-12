import { createHash } from "node:crypto"
import { expect, test, type BrowserContext, type Route } from "@playwright/test"

/**
 * H-56 — `/import-review`'s confirm action must write through H-44's real
 * archive store, not local React state (F-03), and its copy must only claim
 * what that write actually does (F-02). This backend stub is the same shape
 * `scripts/import-review-proof.mjs`'s sibling, `e2e/archive-persistence.spec.ts`,
 * already uses for `/add` — copied rather than shared, so this spec has no
 * import dependency on a file another story might still be shaping.
 */

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
          id: "import-review-test-sender",
          name: "Import review test sender",
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

// Broke by design: comment out the write in `ReviewScreen.confirm` (review-screen.tsx)
// and go back to only `setConfirmedIds(...)` — every assertion below that depends on
// `backend.feedReference` or on `/` showing the panel goes red, exactly reproducing F-03.
test("confirming a blood panel writes through the archive and survives reload", async ({ page }) => {
  const backend: ArchiveBackend = { blobs: new Map(), gatewayReads: 0 }
  await fulfillArchiveBackend(page.context(), backend)

  await page.goto("/import-review")
  await expect(page.getByRole("heading", { name: "Check what we read" })).toBeVisible()

  // Thyroid panel is FIXTURES[0], already selected — no switcher click needed.
  await page.getByRole("button", { name: /Looks right — add to archive/ }).click()
  await expect(page.getByText("Added to archive — ready to include in a share.")).toBeVisible()

  // The claim above is only true once a real write happened.
  expect(backend.feedReference).toMatch(/^[0-9a-f]{64}$/)
  const encrypted = backend.blobs.get(backend.feedReference!)
  expect(encrypted).toBeDefined()
  expect(encrypted!.includes(Buffer.from("TSH"))).toBe(false)

  // Cross-route: the archive screen reads through the same store `/add` uses.
  await page.goto("/")
  await expect(page.getByText(/1 panel · latest 12 August/)).toBeVisible()

  // Reload: a page refresh must not lose it — this is the state React alone cannot survive.
  await page.reload()
  await expect(page.getByText(/1 panel · latest 12 August/)).toBeVisible()
})

// Broke by design: remove the `kind !== "blood-panel"` guard in `confirm` and drop
// `disabledReason` from `DocumentReview`'s `<ReviewActions>` call — the button re-enables,
// clicking it throws inside `addRecordsToMyArchive([review.record])` (no `record` field
// exists on a `DocumentReviewData`, a compile error today; loosen the guard further and it
// silently calls through with no archive kind to write), and this test goes red.
test("a document import cannot claim a false 'added' — the action says why instead", async ({ page }) => {
  const backend: ArchiveBackend = { blobs: new Map(), gatewayReads: 0 }
  await fulfillArchiveBackend(page.context(), backend)

  await page.goto("/import-review")
  await page.getByRole("button", { name: "Consult note" }).click()

  await expect(
    page.getByText("Notes and letters like this aren't stored in your archive yet.").first(),
  ).toBeVisible()
  await expect(page.getByRole("button", { name: /Looks right/ })).toBeDisabled()

  expect(backend.feedReference).toBeUndefined()
  expect(backend.blobs.size).toBe(0)
})

// Broke by design: restore the old `ArchiveRetentionNote` copy ("The file itself stays in
// your archive so you can come back and compare") — the second assertion below goes red,
// reproducing F-02.
test("the retention note names what H-44's archive actually keeps", async ({ page }) => {
  const backend: ArchiveBackend = { blobs: new Map(), gatewayReads: 0 }
  await fulfillArchiveBackend(page.context(), backend)

  await page.goto("/import-review")
  await expect(page.getByText(/The file itself is not kept/)).toBeVisible()
  await expect(page.getByText(/The file itself stays in your archive/)).toHaveCount(0)

  await page.getByRole("button", { name: "Consult note" }).click()
  await expect(page.getByText("This kind is not stored in your archive yet.")).toBeVisible()
})
