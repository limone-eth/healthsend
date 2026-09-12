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
 * `/import-review` is the one page the story names a concrete, reproducible
 * scenario for — "Fix the 3 flagged" behind the bar at 400px — so it is the
 * one exercised here with a real click. The other four pages the story
 * names (`/add`, `/new`, `/shares`, `/`) share the exact same fix, because
 * it lives once in `chrome.tsx`'s `main` padding rather than per page, but
 * none of them offer an equivalent in-page regression to click:
 * `/`, `/new` and `/shares` sit behind a live Swarm ID sign-in
 * (`useSenderIdentity`) with no offline stub in this repo, so they render no
 * content into `main` at all without one; `/add`'s only enabled controls
 * (two kind cards, then a file input once one is picked) never reach the
 * bottom of the viewport under their real content, so there is nothing
 * there for a scroll-to-bottom click to prove. See H-42's `## Choices`.
 */

test.use({ viewport: { width: 400, height: 800 } })

test("/import-review — \"Fix the 3 flagged\" clears the tab bar at 400px", async ({ page }) => {
  await page.goto("/import-review")

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))

  const fixFlagged = page.getByRole("button", { name: "Fix the 3 flagged" })
  await expect(fixFlagged).toBeVisible()

  // No `force`: a real click, exactly as a user would land it. Playwright's
  // actionability check throws if the tab bar (or anything else) is the
  // element actually receiving the pointer at that point, instead of
  // quietly reporting a false pass the way a rect comparison did.
  await fixFlagged.click()
})
