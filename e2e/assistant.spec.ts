import { test, expect } from "@playwright/test"

test("assistant route keeps identity mounted and explains signed-out consent", async ({ page }) => {
  await page.goto("/assistant")

  await expect(page.getByRole("heading", { name: "Your assistant", level: 1 })).toBeVisible()
  await expect(page.locator("#swarm-id-connect")).toBeAttached()
  await expect(page.getByText("Sign in before you choose what an assistant may read.")).toBeVisible()
  // H-68 hides the assistant destination from the rail everywhere, including here: the
  // route still loads by direct URL, but nothing in the chrome offers it as a nav target.
  await expect(page.getByRole("button", { name: "Your archive" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Your assistant" })).toHaveCount(0)
})
