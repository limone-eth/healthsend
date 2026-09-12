import { defineConfig, devices } from "@playwright/test"
import { checkoutId, isOwnedByCheckout, resolveServerTarget } from "./lib/e2e-server-select.ts"

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
 *
 * ## The server this suite talks to
 *
 * `reuseExistingServer: true` used to be unconditional, and with several
 * git worktrees on this machine that is a silent correctness hole: a
 * `pnpm dev` left running in *any* checkout owns port 3000, and every other
 * worktree's `pnpm e2e` then attaches to it and tests that checkout's code
 * while reporting green for its own branch. It is not a flake — it passes,
 * confidently, on the wrong tree.
 *
 * So reuse is opt-in, explicit, and now checked rather than assumed: naming
 * a server with `BASE_URL` is not by itself proof that the server belongs to
 * this checkout. `lib/e2e-server-select.ts` only allows reuse when a marker
 * left by a previous *confirmed* start on that port (see
 * `e2e/helpers/global-setup.ts`) names this checkout's own working directory.
 * Anything else — no marker, a foreign checkout's marker, nothing listening
 * at all — refuses to reuse, and Playwright then tries to start its own
 * server on that port, which fails loudly if something else still holds it.
 * With `BASE_URL` unset, reuse is never even considered. Run a worktree on
 * its own port:
 *
 *     BASE_URL=http://localhost:3100 pnpm e2e
 *
 * `resolveServerTarget` also refuses an https `BASE_URL` outright: the local
 * server this suite starts is a plain `next dev`, which cannot serve TLS, so
 * pointing at an https origin — including a real deployment — must fail
 * loudly instead of silently starting an incompatible server.
 */
const baseURLInput = process.env.BASE_URL ?? "http://localhost:3000"
const { url: baseURL, port } = resolveServerTarget(baseURLInput)
const reuseExistingServer = Boolean(process.env.BASE_URL) && isOwnedByCheckout(port, checkoutId())

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  globalSetup: "./e2e/helpers/global-setup.ts",
  use: {
    baseURL,
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: `pnpm dev --port ${port}`,
    url: baseURL,
    reuseExistingServer,
    timeout: 60_000,
  },
  projects: [
    { name: "offline", grepInvert: /@live/ },
    { name: "live", grep: /@live/ },
  ],
})
