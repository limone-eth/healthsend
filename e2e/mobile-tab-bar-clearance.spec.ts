import { test, expect } from "@playwright/test"
import { mockGrantEntity, mockGrantList, signInAsSender, MOCK_CURRENT_BLOCK } from "./helpers/sender-sign-in"

/**
 * H-42 regression guard for `components/chrome.tsx`'s mobile tab bar.
 *
 * The tab bar is fixed, `$glass-raised` chrome sitting over whatever `main`
 * renders beneath it. A bounding-rect comparison across pages and viewports
 * previously reported `overlap=false` for a control that was visibly
 * covered — a rect check can pick the wrong element, miss paint that
 * extends past a box, or measure before a scroll settles, and every one of
 * those failure modes still reports green. The only proof that holds is the
 * one a real user gets: scroll to the bottom, then `click()` with no
 * `force`, which Playwright fails outright when anything else is capturing
 * the pointer at that point.
 *
 * R3-011 found four of the story's five named routes (`/add`, `/new`,
 * `/shares`, `/`) missing a click entirely — `/chrome-preview` stood in for
 * all of them because, at the time, `/import-review` had just moved under
 * the Swarm-ID-gated `(sender)` layout (H-49/R2-006) and this repo had no
 * offline stub for a real sign-in. `e2e/archive-persistence.spec.ts` (H-44)
 * added exactly that stub afterwards; `./helpers/sender-sign-in.ts` trims it
 * to sign-in only for the four routes below that never touch the sender's
 * archive. `/chrome-preview`'s own test stays alongside them — it is the one
 * regression that isolates the shared `chrome.tsx` padding from any one
 * route's content, independent of sign-in.
 */

test.use({ viewport: { width: 400, height: 800 } })

test("/chrome-preview — \"Mark reviewed\" clears the tab bar at 400px", async ({ page }) => {
  await page.goto("/chrome-preview")

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))

  const markReviewed = page.getByRole("button", { name: "Mark reviewed" })
  await expect(markReviewed).toBeVisible()

  // No `force`: a real click, exactly as a user would land it. Playwright's
  // actionability check throws if the tab bar (or anything else) is the
  // element actually receiving the pointer at that point, instead of
  // quietly reporting a false pass the way a rect comparison did.
  await markReviewed.click()
  await expect(page.getByRole("button", { name: "Reviewed" })).toBeVisible()
})

test("/ — the last archive row clears the tab bar at 400px", async ({ page }) => {
  await signInAsSender(page.context())
  await mockGrantList(page.context(), [])
  await page.goto("/")

  await expect(page.getByRole("heading", { name: "Your archive" })).toBeVisible()
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))

  // H-66: an empty archive is the empty-state card's own "Add blood tests" CTA, the
  // last actionable element on the page — not a bucket row (those are gone).
  const addBloodTests = page.getByRole("link", { name: "Add blood tests" }).last()
  await expect(addBloodTests).toBeVisible()
  await addBloodTests.click()
  await expect(page).toHaveURL(/\/add$/)
})

test("/add — the last enabled kind card clears the tab bar at 400px", async ({ page }) => {
  await signInAsSender(page.context())
  await page.goto("/add")

  await expect(page.getByRole("heading", { name: "What are you adding?" })).toBeVisible()
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))

  // "Wearable export" is the last of the two kinds this build can actually parse — the
  // four below it ("Medications", "Your health history", "Notes", "A letter or report")
  // are disabled placeholders per app/(sender)/add/page.tsx's `KINDS`, so a real click
  // has nothing to prove on them.
  const wearableExport = page.getByRole("button", { name: /Wearable export/ })
  await expect(wearableExport).toBeVisible()
  await expect(wearableExport).toBeEnabled()
  await wearableExport.click()
  await expect(page.getByLabel("File")).toBeVisible()
})

test("/new — Continue clears the tab bar at 400px", async ({ page }) => {
  await signInAsSender(page.context())
  await page.goto("/new")

  await expect(page.getByRole("heading", { name: "New share" })).toBeVisible()
  await page.locator('div.rounded-card:visible input[type="file"]').setInputFiles({
    name: "panel.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("marker,value,unit,ref_low,ref_high,flag\nFerritin,38,ug/L,15,300,\n"),
  })
  // Nothing is selected the moment files land (app/(sender)/new/page.tsx's `onPickFiles`
  // resets `selected`), so Continue starts disabled until the header checkbox includes them.
  await page.getByRole("button", { name: "Select all files" }).click()

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  const continueButton = page.getByRole("button", { name: "Continue" })
  await expect(continueButton).toBeVisible()
  await expect(continueButton).toBeEnabled()
  await continueButton.click()
  await expect(page.getByText("Back to what to include")).toBeVisible()
})

test("/shares — End access now clears the tab bar at 400px", async ({ page }) => {
  await signInAsSender(page.context())
  await mockGrantList(page.context(), [
    mockGrantEntity({
      entityKeyHex: "0x" + "42".repeat(32),
      expiresBlock: MOCK_CURRENT_BLOCK + 500_000,
      recipientBlind: "recipient-a",
    }),
  ])
  await page.goto("/shares")

  await expect(page.getByRole("heading", { name: "Your shares" })).toBeVisible()
  await expect(page.getByText(/document.*Sent/)).toBeVisible()
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))

  const endAccess = page.getByRole("button", { name: "End access now" })
  await expect(endAccess).toBeVisible()
  await endAccess.click()
  await expect(page.getByRole("heading", { name: "End access now?" })).toBeVisible()
})

test("/import-review — Fix the flagged clears the tab bar at 400px", async ({ page }) => {
  await signInAsSender(page.context())
  await page.goto("/import-review")

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  const fixFlagged = page.getByRole("button", { name: /^Fix the \d+ flagged$/ })
  await expect(fixFlagged).toBeVisible()
  await fixFlagged.click()
  // The mobile filter toggle is desktop-only (`hidden md:flex` in review-screen.tsx), so
  // this click cannot flip a visible chip the way `/chrome-preview`'s does — the meaningful
  // assertion here is the one above: an unforced click actually landed on the button.
  await expect(fixFlagged).toBeFocused()
})
