import { createHash } from "node:crypto"
import { test, expect, type BrowserContext, type Route } from "@playwright/test"
import { mockGrantEntity, mockGrantList, MOCK_CURRENT_BLOCK } from "./helpers/sender-sign-in"
import { addShareIndexEntry, createArchive, type DocumentRecord } from "@/lib/archive"

/**
 * H-18 — "Remove this from your archive" (frame `i90sl`), the sheet
 * `components/remove-document-sheet.tsx` and its entry point on
 * `app/(sender)/page.tsx`'s document rows.
 *
 * The business rules (which live shares end, the "opened" note, the chalk
 * card's presence) are proved without a browser in
 * `scripts/remove-document-proof.mjs`. What only a real browser can show is
 * layout — centred and capped at 560 on desktop, bottom-anchored full-bleed
 * on a phone, zero horizontal overflow at both — and that the two actions
 * really do what their labels say when actually clicked.
 */

const SWARM_ID_ORIGIN = "https://swarm-id.snaha.net"
const SWARM_GATEWAY_PATTERN = /download\.gateway\.ethswarm\.org\/bytes\//
const IDENTITY_ADDRESS = "11".repeat(20)

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
          id: "remove-document-sender",
          name: "Remove document sender",
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

async function addOnePdf(page: import("@playwright/test").Page, name: string) {
  await page.goto("/add")
  await page.getByRole("button", { name: /A letter or report/ }).click()
  await page.getByLabel("File").setInputFiles({ name, mimeType: "application/pdf", buffer: fakePdf(name) })
  await page.getByRole("button", { name: "Add to archive" }).click()
  await expect(page).toHaveURL(/\/$/)
}

async function overflowPx(page: import("@playwright/test").Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
}

/**
 * Every row renders in both the mobile and desktop DOM at once, one hidden by CSS
 * depending on viewport (see `visibleText` in e2e/archive-blood-test-pdfs.spec.ts) —
 * `getByRole` would otherwise match both copies' identically-labelled buttons.
 */
function removeButton(page: import("@playwright/test").Page, name: string) {
  return page.getByRole("button", { name: `Remove ${name} from your archive` }).filter({ visible: true })
}

/**
 * Seeds the archive backend directly with one document and `count` live,
 * indexed shares that all hold it — the same document-plus-share-index shape
 * `createSendFromArchive` would build over `count` real sends, without
 * driving each one through the browser. Used by F6 and F7 (docs/stories/H-74.md),
 * which both need a document already sitting in one or more live shares.
 */
async function seedArchiveWithLiveShares(
  backend: ArchiveBackend,
  document: DocumentRecord,
  count: number,
): Promise<ReturnType<typeof mockGrantEntity>[]> {
  const archiveKey = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode("healthsend/archive/v1")),
  )
  let encrypted = await createArchive(archiveKey, [document])
  const entities: ReturnType<typeof mockGrantEntity>[] = []
  const now = Math.floor(Date.now() / 1000)
  for (let i = 0; i < count; i++) {
    const entityKeyHex = ("0x" + (i + 1).toString(16).padStart(64, "0")) as string
    encrypted = await addShareIndexEntry(encrypted, archiveKey, {
      entityKey: entityKeyHex,
      documentIds: [document.id],
      createdAt: now,
      expiresAt: now + 3600,
    })
    entities.push(
      mockGrantEntity({ entityKeyHex, expiresBlock: MOCK_CURRENT_BLOCK + 500, recipientBlind: `recipient-${i}` }),
    )
  }
  const reference = createHash("sha256").update(encrypted).digest("hex")
  backend.blobs.set(reference, Buffer.from(encrypted))
  backend.feedReference = reference
  return entities
}

test.describe("desktop, 1440px", () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test("the sheet opens centred and capped at 560, with no live share to report", async ({ page, context }) => {
    const backend: ArchiveBackend = { blobs: new Map() }
    await fulfillArchiveBackend(context, backend)
    await mockGrantList(context, [])
    await addOnePdf(page, "Blood test.pdf")

    await removeButton(page, "Blood test.pdf").click()

    const dialog = page.getByRole("dialog", { name: "Remove this from your archive" })
    await expect(dialog).toBeVisible()
    await expect(page.getByText("It is in", { exact: false })).toHaveCount(0)
    await expect(page.getByText("There is no undo.", { exact: false })).toBeVisible()

    const box = await dialog.boundingBox()
    if (!box) throw new Error("expected the sheet to have a layout box")
    expect(Math.round(box.width)).toBe(560)
    // Centred: equal space either side of the 1440px viewport.
    const leftGap = box.x
    const rightGap = 1440 - (box.x + box.width)
    expect(Math.abs(leftGap - rightGap)).toBeLessThan(2)

    expect(await overflowPx(page)).toBeLessThanOrEqual(0)
  })

  test("Keep it closes the sheet without removing the document", async ({ page, context }) => {
    const backend: ArchiveBackend = { blobs: new Map() }
    await fulfillArchiveBackend(context, backend)
    await mockGrantList(context, [])
    await addOnePdf(page, "Blood test.pdf")

    await removeButton(page, "Blood test.pdf").click()
    await expect(page.getByRole("dialog")).toBeVisible()
    await page.getByRole("button", { name: "Keep it" }).click()
    await expect(page.getByRole("dialog")).toHaveCount(0)

    await page.reload()
    await expect(page.getByText("Blood test.pdf").filter({ visible: true })).toBeVisible()
  })

  test("Remove it takes the document out of the archive, and a reload confirms it", async ({ page, context }) => {
    const backend: ArchiveBackend = { blobs: new Map() }
    await fulfillArchiveBackend(context, backend)
    await mockGrantList(context, [])
    await addOnePdf(page, "Blood test.pdf")

    await removeButton(page, "Blood test.pdf").click()
    await expect(page.getByRole("dialog")).toBeVisible()
    await page.getByRole("button", { name: "Remove it" }).click()
    await expect(page.getByRole("dialog")).toHaveCount(0)
    await expect(page.getByText("Blood test.pdf")).toHaveCount(0)
    await expect(page.getByText("No blood test PDFs yet")).toBeVisible()

    await page.reload()
    await expect(page.getByText("No blood test PDFs yet")).toBeVisible()
    await expect(page.getByText("Blood test.pdf")).toHaveCount(0)
  })

  /**
   * F6 (review-6, docs/stories/H-74.md): `app/(sender)/page.tsx`'s `confirmRemove`
   * (`app/(sender)/page.tsx:230` before the fix) handled only the `refused`
   * outcome from `performRemoveDocument`, so a `removed-partial` result — the
   * PDF removed, but a share's `endSend` call failing — closed the dialog as
   * if the share had ended too, and said nothing. Forces that exact outcome
   * with a real click by seeding one live, indexed share and making the
   * holder's revoke endpoint refuse.
   */
  test("a share that fails to end is reported, not silently closed", async ({ page, context }) => {
    const backend: ArchiveBackend = { blobs: new Map() }
    await fulfillArchiveBackend(context, backend)

    const document: DocumentRecord = {
      id: "doc-partial",
      kind: "document",
      name: "Blood test.pdf",
      size: fakePdf("partial").length,
      provenance: { sourceId: "test-source", importedAt: new Date().toISOString() },
      bytes: Buffer.from(fakePdf("partial")).toString("base64url"),
    }
    const entities = await seedArchiveWithLiveShares(backend, document, 1)
    await mockGrantList(context, entities)
    await context.route("**/api/holder/revoke", (route) =>
      route.fulfill({ status: 500, json: { error: "revoke refused" } }),
    )

    await page.goto("/")
    await removeButton(page, "Blood test.pdf").click()
    const dialog = page.getByRole("dialog", { name: "Remove this from your archive" })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText("It is in one share that is still open")).toBeVisible()

    await page.getByRole("button", { name: "Remove it" }).click()

    // Never closed as if everything ended: a dialog is still on screen, but a
    // distinct one naming the failure — not the sheet's own "Removing…" stuck
    // forever, and not nothing.
    const partialDialog = page.getByRole("dialog", { name: "Removed from your archive" })
    await expect(partialDialog).toBeVisible()
    await expect(
      partialDialog.getByText(
        "Removed from your archive. 1 share could not be ended and is still open — end it from Your shares.",
      ),
    ).toBeVisible()
    await expect(partialDialog.getByText("Share of this PDF")).toBeVisible()
    await expect(partialDialog.getByRole("link", { name: "Go to Your shares" })).toHaveAttribute("href", "/shares")

    // The PDF itself is out of the archive either way — reflected immediately.
    await expect(page.getByText("No blood test PDFs yet")).toBeVisible()

    await partialDialog.getByRole("button", { name: "Done" }).click()
    await expect(page.getByRole("dialog")).toHaveCount(0)
  })
})

test.describe("mobile, 400px", () => {
  test.use({ viewport: { width: 400, height: 800 } })

  test("the sheet is bottom-anchored and full-bleed, with zero horizontal overflow", async ({ page, context }) => {
    const backend: ArchiveBackend = { blobs: new Map() }
    await fulfillArchiveBackend(context, backend)
    await mockGrantList(context, [])
    await addOnePdf(page, "Blood test.pdf")

    await removeButton(page, "Blood test.pdf").click()
    const dialog = page.getByRole("dialog", { name: "Remove this from your archive" })
    await expect(dialog).toBeVisible()

    const box = await dialog.boundingBox()
    if (!box) throw new Error("expected the sheet to have a layout box")
    expect(Math.round(box.width)).toBe(400)
    expect(Math.round(box.x)).toBe(0)
    // Bottom-anchored: the sheet's own bottom edge sits at the viewport's bottom edge.
    expect(Math.round(box.y + box.height)).toBe(800)

    expect(await overflowPx(page)).toBeLessThanOrEqual(0)
  })

  /**
   * F7 (review-6, docs/stories/H-74.md): the sheet had no height limit and no
   * inner scroll, so a document in many live shares pushed the title, the PDF
   * identity and the Remove/Keep actions off-screen with nothing to bring
   * them back — review-6's own evidence: `top=-653 ... overflowY=visible
   * scrollHeight=1453 clientHeight=1453 afterWheelTop=-653`. Seeds the
   * archive directly with 12 share-index entries (rather than driving 12 real
   * sends through the browser) and 12 matching live grants, then proves a
   * real wheel action actually scrolls the share list while the title, PDF
   * identity and both actions stay reachable.
   */
  test("a document in 12 live shares keeps its title, identity and actions reachable", async ({ page, context }) => {
    const backend: ArchiveBackend = { blobs: new Map() }
    await fulfillArchiveBackend(context, backend)

    const document: DocumentRecord = {
      id: "doc-12-shares",
      kind: "document",
      name: "Blood test.pdf",
      size: fakePdf("many shares").length,
      provenance: { sourceId: "test-source", importedAt: new Date().toISOString() },
      bytes: Buffer.from(fakePdf("many shares")).toString("base64url"),
    }

    const entities = await seedArchiveWithLiveShares(backend, document, 12)
    await mockGrantList(context, entities)
    await page.goto("/")

    await removeButton(page, "Blood test.pdf").click()
    const dialog = page.getByRole("dialog", { name: "Remove this from your archive" })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText("It is in 12 shares that are still open")).toBeVisible()

    const box = await dialog.boundingBox()
    if (!box) throw new Error("expected the sheet to have a layout box")
    // Capped at the viewport (with a little slack for the safe-area calc), not
    // left to grow to the content's full 1,453px, as it did before the fix.
    expect(box.height).toBeLessThanOrEqual(800)

    const scrollArea = dialog.locator("div.overflow-y-auto")
    const before = await scrollArea.evaluate((el) => ({ scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }))
    expect(before.scrollHeight).toBeGreaterThan(before.clientHeight)
    expect(before.scrollTop).toBe(0)

    await scrollArea.hover()
    await page.mouse.wheel(0, 600)
    await expect(async () => {
      const scrollTop = await scrollArea.evaluate((el) => el.scrollTop)
      expect(scrollTop).toBeGreaterThan(0)
    }).toPass()

    // Reachable — title, PDF identity and both actions, even after scrolling.
    await expect(page.getByRole("heading", { name: "Remove this from your archive" })).toBeInViewport()
    await expect(dialog.getByText("Blood test.pdf", { exact: true })).toBeInViewport()
    await expect(page.getByRole("button", { name: "Remove it" })).toBeInViewport()
    await expect(page.getByRole("button", { name: "Keep it" })).toBeInViewport()

    expect(await overflowPx(page)).toBeLessThanOrEqual(0)
  })
})
