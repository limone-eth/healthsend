import { test, expect } from "@playwright/test"
import { mockGrantList, signInAsSender } from "./helpers/sender-sign-in"

/**
 * R3-007 — a signed-in name still appeared on every sender route
 * (`app/(sender)/layout.tsx`'s `ConnectionPanel`), contradicting the settled
 * decision that the product has no name to print: a passkey carries none.
 *
 * `./helpers/sender-sign-in.ts`'s stub Swarm ID response names its identity
 * "Ari Example", exactly as the review's browser evidence did, so any
 * regression that prints `info.identity.name` again fails this test the
 * same way it failed review 3.
 */

test.use({ viewport: { width: 400, height: 900 } })

const ROUTE_HEADINGS: Record<string, string> = {
  "/": "Your archive",
  "/new": "New share",
  "/shares": "Your shares",
}

for (const [route, heading] of Object.entries(ROUTE_HEADINGS)) {
  test(`${route} never renders the signed-in name`, async ({ page }) => {
    await signInAsSender(page.context())
    await mockGrantList(page.context(), [])
    await page.goto(route)

    // Wait for the signed-in view to actually mount — `body` starts out showing only the
    // sign-in screen, and `.not.toContainText` succeeds the instant it checks, so asserting
    // against `body` before this would pass vacuously, before `SenderChrome` ever renders.
    await expect(page.getByRole("heading", { name: heading })).toBeVisible()
    await expect(page.locator("body")).not.toContainText("Ari Example")
  })
}
