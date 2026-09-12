import { defineConfig, devices } from "@playwright/test"

/**
 * The recipient is the thing worth testing in a browser, and the thing worth
 * testing about the recipient is that they arrive with *nothing*: no Swarm ID,
 * no wallet, no stored session. Playwright gives each test a fresh context by
 * default, which is a guest window that can be re-run.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: "pnpm dev",
    url: process.env.BASE_URL ?? "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
