import { test, expect } from "@playwright/test"

test("assistant route keeps identity mounted and explains signed-out consent", async ({ page }) => {
  await page.goto("/assistant")

  await expect(page.getByRole("heading", { name: "Your assistant", level: 1 })).toBeVisible()
  await expect(page.locator("#swarm-id-connect")).toBeAttached()
  await expect(page.getByText("Sign in before you choose what an assistant may read.")).toBeVisible()
  await expect(page.getByRole("button", { name: "Your assistant" })).toBeVisible()
})
