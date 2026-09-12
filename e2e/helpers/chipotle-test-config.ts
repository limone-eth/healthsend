/**
 * The fake `NEXT_PUBLIC_CHIPOTLE_*` values this suite's dev server runs
 * under (see `playwright.config.ts`'s `webServer.env`) and that
 * `archive-send-chipotle-recipient.spec.ts` mocks Lit's endpoint to match.
 *
 * One shared module rather than duplicated literals in both files: a
 * Playwright config and a spec run in the same test process, but the actual
 * `next dev` server they start is a separate one, spawned with these values
 * baked into its env — there is no other way to keep the two in sync than
 * importing the same constants into both places.
 */
export const CHIPOTLE_TEST_ENV = {
  NEXT_PUBLIC_CHIPOTLE_ENABLED: "true",
  NEXT_PUBLIC_CHIPOTLE_ACTION_CID: "bafyreih69chipotletestactioncid",
  NEXT_PUBLIC_CHIPOTLE_PKP_ID: "0x" + "44".repeat(20),
  NEXT_PUBLIC_CHIPOTLE_GROUP_ID: "1",
  NEXT_PUBLIC_CHIPOTLE_USAGE_API_KEY: "h69-test-usage-key",
}
