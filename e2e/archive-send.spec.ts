import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import path from "node:path"
import { expect, test, type BrowserContext, type Route } from "@playwright/test"
import { generateContentKey, generateLinkSecret, packEntityKey, seal, splitContentKey, toBase64Url } from "@/lib/crypto"
import { packEnvelope, type PackedFile } from "@/lib/envelope"
import { mockArkiv, mockHolderUnlock, mockSwarmGateway } from "./helpers/network"

/**
 * H-64 — "New share lists archived PDFs with multi-select" and the send path
 * built from that selection.
 *
 * The archive-seeding backend below is `archive-persistence.spec.ts`'s own
 * stub, duplicated rather than imported — that file belongs to H-63 and this
 * one has no reason to depend on a module another story owns, the same
 * reasoning `app/(sender)/page.tsx`'s `countOpens` gives for its own
 * duplicated helper.
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
          id: "archive-send-test-sender",
          name: "Archive send test sender",
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

async function addTwoArchivedPdfs(page: import("@playwright/test").Page) {
  await page.goto("/add")
  await page.getByRole("button", { name: /A letter or report/ }).click()
  await page.getByLabel("File").setInputFiles([
    { name: "Blood test, March.pdf", mimeType: "application/pdf", buffer: fakePdf("march") },
    { name: "Thyroid panel, June.pdf", mimeType: "application/pdf", buffer: fakePdf("june") },
  ])
  await page.getByRole("button", { name: "Add to archive" }).click()
  await expect(page).toHaveURL(/\/$/)
}

/**
 * `ScopeSection` renders once for the phone step flow (`md:hidden`) and once
 * for tablet/desktop, so every matching string exists twice in the DOM. The
 * mobile copy is `display:none` at this suite's default (desktop) viewport —
 * excluded from `getByRole`'s accessibility-tree query, but `getByText`
 * matches raw DOM text regardless of visibility, so it needs the same
 * `:visible` filter `archive-persistence.spec.ts` (H-63) already uses.
 */
function visibleText(page: import("@playwright/test").Page, text: string | RegExp) {
  return page.getByText(text).and(page.locator(":visible"))
}

test("New share lists archived PDFs with multi-select, no file picker touched", async ({ page }) => {
  const backend: ArchiveBackend = { blobs: new Map() }
  await fulfillArchiveBackend(page.context(), backend)
  await addTwoArchivedPdfs(page)

  await page.goto("/new")
  await expect(page.getByRole("heading", { name: "New share" })).toBeVisible()

  // Both archived documents are listed without ever touching the file input —
  // the operator's "without a file picker" evidence.
  await page.getByRole("button", { name: /Your documents/ }).click()
  await expect(visibleText(page, "Blood test, March.pdf")).toBeVisible()
  await expect(visibleText(page, "Thyroid panel, June.pdf")).toBeVisible()

  const createLink = page.getByRole("button", { name: "Create the link" })
  await expect(createLink).toBeDisabled()

  await visibleText(page, "Blood test, March.pdf").click()
  // The operator's own phrasing (docs/stories/H-62.md): name(s) ticked, then
  // "N of your M documents".
  await expect(visibleText(page, "Blood test, March.pdf — 1 of your 2 documents")).toBeVisible()
  await expect(createLink).toBeEnabled()

  await visibleText(page, "Thyroid panel, June.pdf").click()
  await expect(
    visibleText(page, "Blood test, March.pdf and Thyroid panel, June.pdf — 2 of your 2 documents"),
  ).toBeVisible()

  // The operator's own required sentence, stated before any link exists.
  await expect(
    visibleText(page, "The document is shared as issued, including any name or date of birth printed on it."),
  ).toBeVisible()
})

test.describe("mobile, 400px", () => {
  test.use({ viewport: { width: 400, height: 800 } })

  /**
   * F2 (review-6, docs/stories/H-74.md): `app/(sender)/new/page.tsx`'s mobile
   * step-1 Continue checked only `selectedFiles.length`, so an archived-only
   * selection could never advance past step 1 on a phone. Fails on the line
   * named in the finding (`app/(sender)/new/page.tsx:435` before the fix,
   * which read `disabled={selectedFiles.length === 0}`).
   */
  test("selecting an archived PDF enables Continue", async ({ page }) => {
    const backend: ArchiveBackend = { blobs: new Map() }
    await fulfillArchiveBackend(page.context(), backend)
    await addTwoArchivedPdfs(page)

    await page.goto("/new")
    await expect(page.getByRole("heading", { name: "New share" })).toBeVisible()

    await page.getByRole("button", { name: /Your documents/ }).click()
    const continueButton = page.getByRole("button", { name: "Continue" })
    await expect(continueButton).toBeDisabled()

    await visibleText(page, "Blood test, March.pdf").click()
    // Two matches at mobile — the "Your documents" group's own named-selection
    // line, and the fixed bottom bar's `summaryLine` echoing the same count.
    await expect(visibleText(page, /1 of your 2 documents/).first()).toBeVisible()

    await expect(continueButton).toBeEnabled()
    await continueButton.click()
    // Step 2 — reaching the settings panel is the point: the sender can now
    // set a deadline and create the share, which the disabled Continue button
    // previously made impossible.
    await expect(page.getByPlaceholder("Who is this for?").and(page.locator(":visible"))).toBeVisible()
  })
})

test("an empty archive says so on New share and routes to Add", async ({ page }) => {
  const backend: ArchiveBackend = { blobs: new Map() }
  await fulfillArchiveBackend(page.context(), backend)

  await page.goto("/new")
  await expect(page.getByRole("heading", { name: "New share" })).toBeVisible()

  await expect(visibleText(page, "Your archive has no documents yet.")).toBeVisible()
  await page.getByRole("link", { name: "Add to your archive" }).click()
  await expect(page).toHaveURL(/\/add$/)
})

test("picking a fresh file clears an archive selection, and picking an archived document clears a fresh file", async ({
  page,
}) => {
  const backend: ArchiveBackend = { blobs: new Map() }
  await fulfillArchiveBackend(page.context(), backend)
  await addTwoArchivedPdfs(page)

  await page.goto("/new")
  await page.getByRole("button", { name: /Your documents/ }).click()
  await visibleText(page, "Blood test, March.pdf").click()
  await expect(visibleText(page, /1 of your 2 documents/)).toBeVisible()

  // Same descendant selector `new-share-layout.spec.ts` uses: the file input
  // itself is always `display:none` (a styled `<label>` wraps it), so
  // `:visible` has to apply to the enclosing card, not the input.
  await page.locator('div.rounded-card:visible input[type="file"]').setInputFiles({
    name: "sleep.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("marker,value,unit,ref_low,ref_high,flag\nFerritin,38,ug/L,15,300,\n"),
  })
  await page.getByRole("button", { name: /Documents/ }).click()
  await visibleText(page, "sleep.csv").click()
  // The one file picked is now the only one ticked — "all" reads as such.
  await expect(visibleText(page, "All 1 included")).toBeVisible()
  // The archive selection is gone — the summary line no longer names it.
  await expect(page.getByText(/of your 2 documents/)).toHaveCount(0)
})

/**
 * The round trip a recipient actually sees: a bundle built from one archived
 * PDF renders as a PDF, not text or a table. `createSendFromArchive`'s own
 * correctness (exactly one upload, the real bytes preserved) is proved
 * offline in `scripts/archive-send-proof.mjs`, the same split this repo
 * already draws between `send-path-proof.mjs` and this file's neighbour,
 * `recipient.spec.ts` — a live grant write needs a funded chain transaction
 * this suite cannot make headlessly, so the fixture below reproduces exactly
 * what that function hands the recipient (the same envelope, the same
 * split-key scheme) rather than driving a real "Create the link" click.
 */
test("a recipient opens a link built from an archived PDF and it renders as a PDF", async ({ page, context }) => {
  const pdfBytes = readFileSync(path.join(process.cwd(), "fixtures", "patient-summary.pdf"))
  const packed: PackedFile[] = [
    { header: { name: "patient-summary.pdf", mime: "application/pdf", size: pdfBytes.length }, body: pdfBytes },
  ]
  const envelope = packEnvelope(packed)
  const contentKey = generateContentKey()
  const sealed = await seal(contentKey, envelope)
  const blob = new Uint8Array(sealed.iv.length + sealed.ciphertext.length)
  blob.set(sealed.iv, 0)
  blob.set(sealed.ciphertext, sealed.iv.length)

  const linkSecret = generateLinkSecret()
  const { heldShare, authKey, commitment } = await splitContentKey(contentKey, linkSecret)
  const entityKeyHex = "0x" + "9b".repeat(32)
  const currentBlock = 1_000_000
  const reference = createHash("sha256").update(blob).digest("hex")

  await mockArkiv(context, {
    kind: "found",
    entityKeyHex,
    reference,
    authCommitment: commitment,
    expiresBlock: currentBlock + 500,
    currentBlock,
  })
  await mockHolderUnlock(context, entityKeyHex, toBase64Url(authKey), () => ({
    status: 200,
    body: { share: toBase64Url(heldShare), expiresAt: Math.floor(Date.now() / 1000) + 900 },
  }))
  await mockSwarmGateway(context, reference, blob)

  await page.goto(`/s/${packEntityKey(entityKeyHex)}#${toBase64Url(linkSecret)}`)

  const frame = page.locator("iframe")
  await expect(frame).toBeVisible()
  await expect(async () => {
    const src = await frame.getAttribute("src")
    expect(src).toMatch(/^blob:/)
  }).toPass()
  // The PDF path, not the CSV/text fallback `Preview` also renders.
  await expect(page.locator("table")).toHaveCount(0)
  await expect(page.locator("pre")).toHaveCount(0)
})
