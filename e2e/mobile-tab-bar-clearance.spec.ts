import { test, expect } from "@playwright/test"

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
 * `/import-review` was originally the one page the story names a concrete,
 * reproducible scenario for — "Fix the 2 flagged" behind the bar at 400px.
 * H-49/R2-006 then moved it under the Swarm-ID-gated `(sender)` layout (so
 * navigating to it no longer tears down the sign-in iframe), which means it
 * renders nothing without a real sign-in this repo has no offline stub for
 * — the same constraint that already ruled out `/`, `/new` and `/shares`
 * below. `/chrome-preview` renders `SenderChrome` unauthenticated by design
 * (it is a review harness for the chrome itself, not a signed-in route), so
 * it now carries the one clickable, real, in-`main` control this test
 * needs — see its own comment on the "Mark reviewed" button.
 *
 * The other four pages the story names (`/add`, `/new`, `/shares`, `/`)
 * share the exact same fix, because it lives once in `chrome.tsx`'s `main`
 * padding rather than per page, but none of them offer an equivalent
 * in-page regression to click: `/`, `/new` and `/shares` sit behind a live
 * Swarm ID sign-in (`useSenderIdentity`) with no offline stub in this repo,
 * so they render no content into `main` at all without one; `/add`'s only
 * enabled controls (two kind cards, then a file input once one is picked)
 * never reach the bottom of the viewport under their real content, so there
 * is nothing there for a scroll-to-bottom click to prove. See H-42's
 * `## Choices`.
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
