import { test, expect } from "@playwright/test"
import { signInAsSender, mockGrantList } from "./helpers/sender-sign-in"

/**
 * H-68 regression guard for `components/chrome.tsx`: the PDF-only proof of
 * concept has nothing for the assistant (H-22) to connect to, so the rail
 * and mobile tab bar must not offer it as a destination. Before the fix —
 * `DESTINATIONS.map` at the Rail (chrome.tsx line 59) and the `TabBar`'s
 * `items` (chrome.tsx line 158), both mapping the unfiltered `DESTINATIONS`
 * array — a third, "Your assistant"/"Assistant" button rendered alongside
 * the other two and the `toHaveCount(0)` assertions below failed.
 *
 * Real clicks, not rect checks: each test also drives the remaining
 * destination end to end (URL change, new heading) to prove the two that
 * stay are still wired, not just present in the DOM.
 */

test("rail at 1440px shows only archive and shares, and a real click still navigates", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await signInAsSender(page.context())
  await mockGrantList(page.context(), [])
  await page.goto("/")

  await expect(page.getByRole("heading", { name: "Your archive" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Your archive" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Your shares" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Your assistant" })).toHaveCount(0)

  await page.getByRole("button", { name: "Your shares" }).click()
  await expect(page).toHaveURL(/\/shares$/)
  await expect(page.getByRole("heading", { name: "Your shares" })).toBeVisible()

  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth)
})

test("mobile tab bar at 400px shows only archive and shares, and a real click still navigates", async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 800 })
  await signInAsSender(page.context())
  await mockGrantList(page.context(), [])
  await page.goto("/")

  await expect(page.getByRole("heading", { name: "Your archive" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Archive" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Shares" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Assistant" })).toHaveCount(0)

  await page.getByRole("button", { name: "Shares" }).click()
  await expect(page).toHaveURL(/\/shares$/)
  await expect(page.getByRole("heading", { name: "Your shares" })).toBeVisible()

  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth)
})
