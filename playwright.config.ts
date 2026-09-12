import { defineConfig, devices } from "@playwright/test"

/**
 * The recipient is the thing worth testing in a browser, and the thing worth
 * testing about the recipient is that they arrive with *nothing*: no Swarm ID,
 * no wallet, no stored session. Playwright gives each test a fresh context by
 * default, which is a guest window that can be re-run.
 *
 * Two projects. `offline` is route-stubbed — no real Swarm ID, no funded
 * Arkiv key, no network — and runs by default. `live`, tagged `@live` in the
 * spec, needs a real share link; it still runs by default too, but every
 * test in it calls `test.skip` when `SHARE_URL` is unset, so a plain
 * `pnpm e2e` exercises it not at all. Select it on purpose with
 * `SHARE_URL=... pnpm exec playwright test --project=live`.
 *
 * There is no `offline-dark` project (H-27) any more: the app has one
 * palette (H-40), so running every spec twice under a forced dark
 * `colorScheme` would only double the run time, not the coverage.
 * `e2e/contrast.spec.ts` still forces `colorScheme: "dark"` on itself, as
 * the regression guard for that exact palette staying put under the OS
 * condition that used to change it.
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
    { name: "live", grep: /@live/ },
  ],
})
