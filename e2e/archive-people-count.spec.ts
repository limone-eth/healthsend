import { test, expect } from "@playwright/test"
import { mockGrantEntity, mockGrantList, signInAsSender, MOCK_CURRENT_BLOCK } from "./helpers/sender-sign-in"

/**
 * R3-008 — the archive's focus surface (`app/(sender)/page.tsx`'s `FocusSurface`)
 * counted live grants and called the number "people". Two active shares to the
 * same recipient read "2 people can see part of your archive", and a lone
 * share read the ungrammatical "One person see part of it" on mobile.
 *
 * `grant.recipient` is the sender's own HMAC of the recipient label
 * (`blindAttribute`, lib/crypto.ts) — deterministic per label, so two grants
 * naming the same recipient carry the identical blinded string without this
 * test (or the app) ever decrypting who they are. Both fixtures below use
 * `recipientBlind: "same-recipient"` for exactly that reason.
 */

const twoGrantsOneRecipient = [
  mockGrantEntity({
    entityKeyHex: "0x" + "01".repeat(32),
    expiresBlock: MOCK_CURRENT_BLOCK + 500_000,
    recipientBlind: "same-recipient",
  }),
  mockGrantEntity({
    entityKeyHex: "0x" + "02".repeat(32),
    expiresBlock: MOCK_CURRENT_BLOCK + 600_000,
    recipientBlind: "same-recipient",
  }),
]

test("desktop — two shares to one recipient read as one person, not two", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await signInAsSender(page.context())
  await mockGrantList(page.context(), twoGrantsOneRecipient)
  await page.goto("/")

  await expect(page.getByText("One person can see part of your archive")).toBeVisible()
  await expect(page.getByText(/\d+ people can see part of your archive/)).toHaveCount(0)
})

test("mobile — a lone share reads with correct singular/plural grammar", async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 800 })
  await signInAsSender(page.context())
  await mockGrantList(page.context(), [
    mockGrantEntity({
      entityKeyHex: "0x" + "03".repeat(32),
      expiresBlock: MOCK_CURRENT_BLOCK + 500_000,
      recipientBlind: "solo-recipient",
    }),
  ])
  await page.goto("/")

  await expect(page.getByText("One person sees part of it")).toBeVisible()
  await expect(page.getByText("One person see part of it")).toHaveCount(0)
})
