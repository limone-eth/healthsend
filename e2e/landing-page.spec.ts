import { test, expect } from "@playwright/test"

/**
 * H-47 regression guards for `/landing`, which renders with no network
 * dependency (see `e2e/contrast.spec.ts`'s comment).
 *
 * R2-010: the "What makes it different" claim used to say the held key
 * share is deleted exactly "when the date passes." `lib/holder-store.ts`'s
 * `TTL_GRACE_SECONDS` gives the holder up to an hour past that date before
 * its share is actually gone, so the unqualified sentence overstated its own
 * precision. The fix states the bound instead of hiding it.
 *
 * R2-011: `Action` (`components/ui.tsx`) renders a plain `<button>` with no
 * navigation of its own. The Nav bar's "Create your archive" `Link` is
 * `hidden` below `md`, so at phone width the hero and final CTAs — plain
 * `Action`s with no `onClick` — were the page's only entry points, and
 * neither one went anywhere.
 */

const OLD_UNQUALIFIED_CLAIM =
  "Here, when the date passes, the half of the key we hold is deleted. Not a promise"

test("states the deletion bound rather than an exact-moment claim", async ({ page }) => {
  await page.goto("/landing")
  const body = await page.locator("body").innerText()

  expect(body).not.toContain(OLD_UNQUALIFIED_CLAIM)
  expect(body).toContain("deleted within the hour that follows")
})

test("the entry action at phone width creates an archive", async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 900 })
  await page.goto("/landing")

  // Hero's primary CTA — a plain `Action` before this fix, wired with no
  // `onClick`. `.first()` picks it out from the identical-label CTA in the
  // final section further down the page.
  await page.getByRole("button", { name: "Create your archive" }).first().click()

  await expect(page).toHaveURL(/\/$/)
})

for (const width of [400, 1440]) {
  test(`renders with no horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto("/landing")

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }))

    expect(scrollWidth).toBeLessThanOrEqual(clientWidth)
  })
}
