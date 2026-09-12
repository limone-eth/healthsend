import { test, expect, type Page } from "@playwright/test"
import { mockGrantEntity, mockGrantList, signInAsSender, MOCK_CURRENT_BLOCK } from "./helpers/sender-sign-in"

/**
 * The Countdown card on Your shares holds its content (operator screenshot, 2026-09-13):
 * "CLOSING" poked above the card's top border and "Expires Saturday" wrapped onto two
 * lines inside a fixed 56px row. The date line is now longer still ("Expires Saturday at
 * 00:26"), so the card has to grow to fit rather than clip.
 *
 * Broke by design: put `h-14` back on `Countdown` in components/ui.tsx, or drop
 * `whitespace-nowrap` from its date line, and the containment assertions go red.
 */

// ~6 days at the nominal 2s block time — inside the week, so the long weekday + time label.
const SIX_DAYS_OF_BLOCKS = Math.floor((6 * 86400) / 2) - 1800

async function openShares(page: Page) {
  await signInAsSender(page.context())
  await mockGrantList(page.context(), [
    mockGrantEntity({
      entityKeyHex: "0x" + "43".repeat(32),
      expiresBlock: MOCK_CURRENT_BLOCK + SIX_DAYS_OF_BLOCKS,
      recipientBlind: "recipient-countdown",
    }),
  ])
  await page.goto("/shares")
  await expect(page.getByRole("heading", { name: "Your shares" })).toBeVisible()
}

async function expectCardHoldsItsContent(page: Page) {
  const word = page.getByText("CLOSING", { exact: true }).filter({ visible: true }).first()
  await expect(word).toBeVisible()
  const card = word.locator("xpath=ancestor::div[contains(@class,'rounded-control')][1]")
  const date = card.getByText(/^Expires /)
  const remaining = card.getByText(/ left$/)

  const cardBox = (await card.boundingBox())!
  const wordBox = (await word.boundingBox())!
  const dateBox = (await date.boundingBox())!
  const remainingBox = (await remaining.boundingBox())!

  // Everything inside the card's border.
  for (const [name, box] of [
    ["state word", wordBox],
    ["date line", dateBox],
    ["time left", remainingBox],
  ] as const) {
    expect(box.y, `${name} top inside the card`).toBeGreaterThanOrEqual(cardBox.y)
    expect(box.y + box.height, `${name} bottom inside the card`).toBeLessThanOrEqual(cardBox.y + cardBox.height)
    expect(box.x + box.width, `${name} right edge inside the card`).toBeLessThanOrEqual(cardBox.x + cardBox.width)
  }

  // The date line is one line of 14px text, not two.
  expect(dateBox.height, "date line stays on one line").toBeLessThan(24)
  await expect(date).toContainText(" at ")

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBe(0)
}

test.describe("desktop, 1440px", () => {
  test.use({ viewport: { width: 1440, height: 900 } })
  test("the Countdown card holds its word, date and time left", async ({ page }) => {
    await openShares(page)
    await expectCardHoldsItsContent(page)
  })
})

test.describe("mobile, 400px", () => {
  test.use({ viewport: { width: 400, height: 860 } })
  test("the Countdown card holds its word, date and time left", async ({ page }) => {
    await openShares(page)
    await expectCardHoldsItsContent(page)
  })
})
