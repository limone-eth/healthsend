import { test, expect } from "@playwright/test"
import { signInAsSender } from "./helpers/sender-sign-in"

/**
 * R3-006 / R3-021 — `/new`'s two-column split (`app/(sender)/new/page.tsx`) switched to
 * two columns at `md` (768px), 512px earlier than DESIGN.md's Layout table allows (`≥1280`,
 * `xl`), and the summary panel was never sticky. Both `ScopeSection` and `SettingsSection`
 * render as a bare `<Card>` (components/ui.tsx, `.rounded-card`, `w-full`) directly inside
 * their flex column, so each Card's own bounding box is the column's real rendered width —
 * no test id needed, and exactly two `.rounded-card` elements are visible at `md` and up
 * (the mobile step flow's copies of the same components stay in the DOM but `display:none`,
 * excluded by Playwright's `:visible`).
 */

test.describe("/new column layout", () => {
  test("tablet (1024px, inside 768–1279) stays one column", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 })
    await signInAsSender(page.context())
    await page.goto("/new")

    await expect(page.getByRole("heading", { name: "New share" })).toBeVisible()
    const cards = page.locator("div.rounded-card:visible")
    await expect(cards).toHaveCount(2)
    const scope = await cards.nth(0).boundingBox()
    const settings = await cards.nth(1).boundingBox()
    if (!scope || !settings) throw new Error("expected both cards to have a layout box")

    // One column: the settings card sits fully below the scope card, not beside it, and
    // both take the same full-bleed width — the opposite of a side-by-side split.
    expect(settings.y).toBeGreaterThanOrEqual(scope.y + scope.height - 1)
    expect(Math.round(scope.width)).toBe(Math.round(settings.width))
  })

  test("desktop (1440px, ≥1280) splits 640 + 400 at a 40px gutter", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await signInAsSender(page.context())
    await page.goto("/new")

    await expect(page.getByRole("heading", { name: "New share" })).toBeVisible()
    const cards = page.locator("div.rounded-card:visible")
    await expect(cards).toHaveCount(2)
    const scope = await cards.nth(0).boundingBox()
    const settings = await cards.nth(1).boundingBox()
    if (!scope || !settings) throw new Error("expected both cards to have a layout box")

    expect(Math.round(scope.width)).toBe(640)
    expect(Math.round(settings.width)).toBe(400)
    expect(Math.round(settings.x - (scope.x + scope.width))).toBe(40)
    // Side by side, not stacked.
    expect(Math.abs(scope.y - settings.y)).toBeLessThan(2)
  })

  test("desktop summary panel stays sticky while the scope list scrolls", async ({ page }) => {
    // Tall enough that the summary column's own content (recipient field, access mode,
    // PIN toggle, window picker, the Create action) fits below the `xl:top-11` sticky
    // offset in one screen — otherwise even a correctly sticky panel would still show
    // its bottom edge below the fold, which would falsely look like this bug.
    await page.setViewportSize({ width: 1440, height: 1100 })
    await signInAsSender(page.context())
    await page.goto("/new")

    await page.locator('div.rounded-card:visible input[type="file"]').setInputFiles(
      Array.from({ length: 80 }, (_, i) => ({
        name: `file-${i}.csv`,
        mimeType: "text/csv",
        buffer: Buffer.from("marker,value,unit,ref_low,ref_high,flag\nFerritin,38,ug/L,15,300,\n"),
      })),
    )
    // The scope row starts collapsed (components/ui.tsx's `Card` holds `ScopeRowHeader`,
    // `expanded` defaults to `false`) — expand it so 25 file rows actually push the left
    // column past the viewport height, which is what makes "sticky" a real claim to check.
    await page.getByRole("button", { name: /Documents/ }).click()

    const createLink = page.getByRole("button", { name: "Create the link" })
    await expect(createLink).toBeVisible()
    const before = await createLink.boundingBox()
    if (!before) throw new Error("expected Create the link to have a layout box")

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await expect(createLink).toBeVisible()
    const after = await createLink.boundingBox()
    if (!after) throw new Error("expected Create the link to still have a layout box after scrolling")

    // Non-sticky: the panel would have scrolled off with the rest of `main` and either
    // disappeared or moved well past the viewport, the exact failure R3-021's browser
    // evidence recorded (`y=-384.625`, `createInViewport=false`).
    expect(after.y).toBeGreaterThanOrEqual(0)
    expect(after.y).toBeLessThan(1100)
  })
})
