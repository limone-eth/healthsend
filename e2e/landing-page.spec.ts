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

// H-62/H-64: sending a PDF as-is (not stripping the name and date of birth
// printed on it) reverses the blanket claim step 1 used to make.
const OLD_BLANKET_CLAIM =
  "Your name and date of birth are set aside as they come in, so they are never part of anything you send."

test("step 1 no longer claims every document sets its identifiers aside", async ({ page }) => {
  await page.goto("/landing")
  const body = await page.locator("body").innerText()

  expect(body).not.toContain(OLD_BLANKET_CLAIM)
  expect(body).toContain("a PDF report")
  expect(body).toContain("a PDF goes out exactly as issued, including anything printed on it.")
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

// F9 (review-6, docs/stories/H-74.md): H-68 hid the Assistant destination and
// removed its dedicated section, but the hero line (`app/landing/page.tsx:131`,
// `:135`) and the third problem card (`:171`) still promised it. Fails on
// current `main`, which renders "your assistant" and "An assistant you use
// daily" at both widths named in the finding's own evidence line.
for (const width of [400, 1440]) {
  test(`makes no Assistant promise at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto("/landing")

    const body = await page.locator("body").innerText()
    expect(body).not.toContain("your assistant")
    expect(body).not.toContain("An assistant you use daily")
    expect(body.toLowerCase()).not.toContain("assistant")
  })
}
