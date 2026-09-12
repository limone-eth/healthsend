import { test, expect } from "@playwright/test"
import { mockGrantList, signInAsSender } from "./helpers/sender-sign-in"

/**
 * R3-020 — the mobile archive (`app/(sender)/page.tsx`) rendered the desktop `BucketCard`
 * grid shrunk to one column: ~179px cards with their own "Add a panel"-style link, instead
 * of frame `zsDfc`'s five compact 62px list rows (`n7oJQ`, read via the pencil MCP tool
 * against `healthsend.pen`). `BucketRow` is the fixed-height row component that frame
 * actually specifies; this proves it renders at 400px, not the taller card.
 */

test.use({ viewport: { width: 400, height: 900 } })

test("mobile archive renders five 62px list rows, not desktop cards", async ({ page }) => {
  await signInAsSender(page.context())
  await mockGrantList(page.context(), [])
  await page.goto("/")

  await expect(page.getByRole("heading", { name: "Your archive" })).toBeVisible()

  const names = ["Blood panels", "Wearables", "Medications", "Notes"]
  const rows: { name: string; box: { x: number; y: number; width: number; height: number } }[] = []
  for (const name of names) {
    const row = page.getByRole("link", { name: new RegExp(name) })
    const box = await row.boundingBox()
    if (!box) throw new Error(`expected the "${name}" row to have a layout box`)
    // The old desktop card was ~179px tall; the frame's row is a fixed 62px.
    expect(Math.round(box.height)).toBe(62)
    rows.push({ name, box })
  }

  const identityRow = page.locator("div.bg-disabled:visible").first()
  const identityBox = await identityRow.boundingBox()
  if (!identityBox) throw new Error("expected the Identity row to have a layout box")
  expect(Math.round(identityBox.height)).toBe(62)
  rows.push({ name: "Identity", box: identityBox })

  // A single column, top to bottom, in the frame's own order — not a grid.
  for (let i = 1; i < rows.length; i++) {
    expect(rows[i].box.y).toBeGreaterThan(rows[i - 1].box.y)
  }
})
