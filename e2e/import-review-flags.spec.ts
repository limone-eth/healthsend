import { test, expect } from "@playwright/test"

/**
 * H-57: proves the import-review screen actually renders what `lib/import.ts`
 * now produces for the fixed 32-marker `thyroid-panel.csv` dataset — not
 * inferred from the parser's own unit proof (`scripts/import-flag-proof.mjs`),
 * which never touches `ReviewScreen`.
 *
 * `/import-review` lives inside the Swarm-ID-gated `(sender)` layout (H-49),
 * so this stubs only what `useSenderIdentity` needs to report a connection —
 * `parentIdentify` and `deriveAppSecret` — the same protocol
 * `e2e/archive-persistence.spec.ts` stubs, trimmed to what a page that never
 * touches the archive actually calls.
 */
const SWARM_ID_ORIGIN = "https://swarm-id.snaha.net"
const IDENTITY_ADDRESS = "11".repeat(20)

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
  })
</script></body></html>`
}

test.beforeEach(async ({ page }) => {
  await page.context().route(`${SWARM_ID_ORIGIN}/proxy`, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: proxyHtml() }),
  )
  await page.goto("/import-review")
  await expect(page.getByRole("heading", { name: "Check what we read" })).toBeVisible()
})

test("the fixed 32-marker dataset reads as 29 clean, 3 flagged", async ({ page }) => {
  // R3-014: this is the real parser output for the real fixture, not a
  // hand-typed number that happens to agree with DESIGN.md's demo copy.
  // The split renders once per breakpoint (desktop/mobile), so this checks
  // the rendered page text rather than a single, breakpoint-specific node.
  await expect(page.locator("body")).toContainText("29 of 32 read cleanly")
  await expect(page.locator("body")).toContainText("3 need a look")
})

test("a qualified reading keeps its qualifier and reads as a clean match", async ({ page }) => {
  // R3-018: `hs-CRP,<0.3,mg/L,0,1,` must not vanish and must not be flagged.
  await page.getByRole("button", { name: "All 32" }).click()
  const row = page.getByText("hs-CRP", { exact: true }).locator("..").locator("..")
  await expect(row).toContainText("<0.3")
  await expect(row).toContainText("Matches")
})

test("a reversed reference range flags as parse uncertainty, not a clean match", async ({ page }) => {
  // R3-002: `Potassium,4.1,mmol/L,5.1,3.5,` is an impossible range (min > max).
  // The default filter is "Needs a look", so a real, unforced click finds it
  // there rather than requiring "All".
  const row = page.getByText("Potassium", { exact: true }).locator("..").locator("..")
  await expect(row).toContainText("Reference range is reversed")
})
