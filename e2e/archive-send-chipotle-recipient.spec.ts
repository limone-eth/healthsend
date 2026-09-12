import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import path from "node:path"
import { expect, test } from "@playwright/test"
import {
  generateContentKey,
  generateLinkSecret,
  packEntityKey,
  seal,
  splitContentKey,
  toBase64Url,
} from "@/lib/crypto"
import { packEnvelope, type PackedFile } from "@/lib/envelope"
import { protectGrantShare } from "@/lib/grant-package"
import { createChipotleKeyReleaseProvider, hashActionCid, __resetChipotleAdapterStateForTests } from "@/lib/key-release/chipotle"
import { CHIPOTLE_TEST_ENV } from "./helpers/chipotle-test-config"
import { mockArkiv, mockChipotle, mockSwarmGateway } from "./helpers/network"

/**
 * H-69's own e2e evidence: a recipient opens a v3, Chipotle-protected grant
 * through a mocked Chipotle endpoint — `lib/key-release/chipotle.ts`'s real
 * `createHttpChipotleClient`, unmodified, run inside the actual browser page,
 * against Playwright route stubs rather than Lit's real service.
 *
 * The fixture's protected share is built once, offline, in this file's own
 * Node process (the same "sender" step `createSendFromArchive`'s Chipotle
 * branch performs — see `scripts/archive-send-chipotle-proof.mjs`), using
 * the real `createChipotleKeyReleaseProvider` against a fake client. The
 * *recipient* side, exercised here, is the real thing end to end: the
 * browser's own `openSend` reads the grant from a mocked Arkiv, then calls
 * the real Chipotle adapter, which calls `mockChipotle`'s stubbed endpoint.
 *
 * `NEXT_PUBLIC_CHIPOTLE_*` for the dev server this suite talks to are set in
 * `playwright.config.ts`'s `webServer.env`, from the same
 * `./helpers/chipotle-test-config.ts` constants this file mocks against —
 * one shared module, since the config and this spec run in the same test
 * process but the actual `next dev` server is a separate one, spawned with
 * these values baked into its own environment.
 */

const TEST_ACTION_CID = CHIPOTLE_TEST_ENV.NEXT_PUBLIC_CHIPOTLE_ACTION_CID
const TEST_PKP_ID = CHIPOTLE_TEST_ENV.NEXT_PUBLIC_CHIPOTLE_PKP_ID
const TEST_USAGE_KEY = CHIPOTLE_TEST_ENV.NEXT_PUBLIC_CHIPOTLE_USAGE_API_KEY
const TEST_GROUP_ID = CHIPOTLE_TEST_ENV.NEXT_PUBLIC_CHIPOTLE_GROUP_ID

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64")
}
function fromBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64"))
}

/**
 * A fake `ChipotleClient` used only to build this test's fixture, offline —
 * an XOR-only stand-in for `Lit.Actions.Encrypt`, the same style
 * `scripts/chipotle-adapter-proof.mjs` uses. It never runs inside the
 * browser; `mockChipotle` (which the recipient's real adapter actually
 * talks to) performs the identical transform so the two sides agree.
 */
function buildFixtureChipotleProvider() {
  // A fresh instance in this Node process, not the browser's — but the
  // single-action cache is a module-level `Map`, so a distinct config key
  // (`groupId: "1"`, matching what `playwright.config.ts` sets for the real
  // browser-side adapter) still needs its own resolution here.
  __resetChipotleAdapterStateForTests()
  return createChipotleKeyReleaseProvider({
    config: { enabled: true, actionCid: TEST_ACTION_CID, pkpId: TEST_PKP_ID, groupId: TEST_GROUP_ID, usageApiKey: TEST_USAGE_KEY },
    client: {
      async ping() {},
      async getGroupAuthorization() {
        return { hashedActionCids: [hashActionCid(TEST_ACTION_CID)], pkpInGroup: true }
      },
      async invokeAction({ jsParams }) {
        const input = jsParams.mode === "protect" ? (jsParams.payload as string) : (jsParams.ciphertext as string)
        return { authorized: true, result: toBase64(Uint8Array.from(fromBase64(input), (b) => b ^ 0x5a)) }
      },
      async getActionIpfsId() {
        return TEST_ACTION_CID
      },
    },
  })
}

test("a recipient opens a v3 grant through a mocked Chipotle endpoint", async ({ page, context }) => {
  const pdfBytes = readFileSync(path.join(process.cwd(), "fixtures", "patient-summary.pdf"))
  const packed: PackedFile[] = [
    { header: { name: "patient-summary.pdf", mime: "application/pdf", size: pdfBytes.length }, body: pdfBytes },
  ]
  const envelope = packEnvelope(packed)
  const contentKey = generateContentKey()
  const sealed = await seal(contentKey, envelope)
  const blob = new Uint8Array(sealed.iv.length + sealed.ciphertext.length)
  blob.set(sealed.iv, 0)
  blob.set(sealed.ciphertext, sealed.iv.length)
  const reference = createHash("sha256").update(blob).digest("hex")

  const linkSecret = generateLinkSecret()
  const { heldShare } = await splitContentKey(contentKey, linkSecret)

  const entityKeyHex = "0x" + "9d".repeat(32)
  const owner = "0x" + "55".repeat(20)
  const currentBlock = 1_000_000
  const expiresBlock = currentBlock + 500
  const binding = { grantId: ("0x" + "66".repeat(32)) as `0x${string}`, owner: owner as `0x${string}`, expiresBlock: BigInt(expiresBlock), ref: reference }

  const fixtureProvider = buildFixtureChipotleProvider()
  const protectedShare = await protectGrantShare(heldShare, linkSecret, binding, fixtureProvider)

  await mockArkiv(context, {
    kind: "found-v3",
    entityKeyHex,
    owner,
    reference,
    release: { ...protectedShare, grantId: binding.grantId },
    expiresBlock,
    currentBlock,
  })
  await mockChipotle(context, {
    actionCid: TEST_ACTION_CID,
    pkpId: TEST_PKP_ID,
    arkivLedger: new Map([[binding.grantId.toLowerCase(), { owner, expiresBlock: expiresBlock.toString() }]]),
  })
  await mockSwarmGateway(context, reference, blob)

  await page.goto(`/s/${packEntityKey(entityKeyHex)}#${toBase64Url(linkSecret)}`)

  // The PDF path: an iframe fed a blob URL, exactly like
  // `archive-send.spec.ts`'s equivalent v2 assertion.
  const frame = page.locator("iframe")
  await expect(frame).toBeVisible()
  await expect(async () => {
    const src = await frame.getAttribute("src")
    expect(src).toMatch(/^blob:/)
  }).toPass()
  await expect(page.getByText("This link has expired")).toHaveCount(0)
  await expect(page.getByText("Temporarily unavailable")).toHaveCount(0)
})
