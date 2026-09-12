import { defineConfig, devices } from "@playwright/test"

/**
 * The recipient is the thing worth testing in a browser, and the thing worth
 * testing about the recipient is that they arrive with *nothing*: no Swarm ID,
 * no wallet, no stored session. Playwright gives each test a fresh context by
 * default, which is a guest window that can be re-run.
 *
 * Three projects. `offline` is route-stubbed — no real Swarm ID, no funded
 * Arkiv key, no network — and runs by default. `offline-dark` runs the exact
 * same specs with `colorScheme: "dark"` (H-27): the offline recipient path is
 * the one already free of real network/wallet dependencies, so it is the lane
 * that gets a dark pass — a regression that makes text unreadable in dark
 * mode now fails a command instead of waiting for someone to open the right
 * page on the right machine. `live`, tagged `@live` in the spec, needs a real
 * share link; it still runs by default too, but every test in it calls
 * `test.skip` when `SHARE_URL` is unset, so a plain `pnpm e2e` exercises it
 * not at all. Select it on purpose with
 * `SHARE_URL=... pnpm exec playwright test --project=live`.
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
  projects: [
    { name: "offline", grepInvert: /@live/ },
    { name: "offline-dark", grepInvert: /@live/, use: { colorScheme: "dark" } },
    { name: "live", grep: /@live/ },
  ],
})
