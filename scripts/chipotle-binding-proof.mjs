/**
 * H-72 — review-8 F1's regression proof, adapted from review-8's
 * `scripts/r8-f1-commitment-bypass-proof.mjs`. Offline: no Lit, no Arkiv, no
 * chain.
 *
 * It runs the REAL `lib/key-release/chipotle-action.js` source inside a Node
 * `vm`, with a fake `Lit.Actions.Encrypt/Decrypt` (AES-GCM under a key that
 * stands in for the PKP) and a fake Arkiv RPC that answers the exact clause
 * the action renders, from an in-memory ledger that drops an entity once the
 * head passes its `$expiresAt` — the way Arkiv's current state does. The
 * sender's side runs the real `chipotle.ts`, `grant-package.ts`, `crypto.ts`
 * and `endSend` (`lib/sends.ts`).
 *
 * The attack (review-8 F1): someone who kept a Chipotle link unwraps the
 * outer link-secret seal, writes their own live Arkiv entity, and calls the
 * action directly with the ended share's Lit ciphertext plus their own
 * binding and a matching commitment. Before H-72 the action checked only
 * that the caller's binding matched the caller's commitment, then released.
 *
 * Every check below prints PASS or FAIL and the script exits 1 if any fail,
 * so the red run against the pre-H-72 action shows each gap by name.
 *
 * It also stands behind the end and expiry copy for a v3 share (F6):
 * `app/s/[key]/page.tsx`'s "This link just can’t open it any more" and
 * `components/remove-document-sheet-logic.ts`'s "so nobody can open it
 * again". Those sentences are true for a Chipotle share only while every
 * check here passes.
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { registerHooks } from "node:module"
import vm from "node:vm"

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (error) {
      if (!specifier.startsWith(".") || /\.[cm]?[jt]sx?$/.test(specifier)) throw error
      return nextResolve(`${specifier}.ts`, context)
    }
  },
})

const actionSource = readFileSync(new URL("../lib/key-release/chipotle-action.js", import.meta.url), "utf8")

// ---- fake Arkiv: current state only, answers only the exact rendered clause shape ----
let head = 1_000_000n
const ledger = [] // { app, kind, grant_id, owner, expiresAt: bigint, payload: object }
const CLAUSE =
  /^app = str\('([^']*)'\) AND kind = str\('([^']*)'\) AND grant_id = bytes32\((0x[0-9a-f]{64})\) AND \$owner = addr\((0x[0-9a-f]{40})\) AND \$expiresAt = u64\((\d+)\)$/
const arkivQueries = []

function toHexData(bytes) {
  return "0x" + Buffer.from(bytes).toString("hex")
}

async function fakeArkivFetch(url, init) {
  assert.equal(url, "https://rpc.tiramisu.db-chain.testnet.arkiv.network")
  const body = JSON.parse(init.body)
  const [clause, options] = body.params
  assert.equal(options.atBlock, undefined, "the action must never read Arkiv at a past block")
  arkivQueries.push(clause)
  const m = CLAUSE.exec(clause)
  if (!m) {
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32602, message: "parse" } }), { status: 200 })
  }
  const [, app, kind, grantId, owner, expiresAt] = m
  const hits = ledger.filter(
    (e) =>
      e.expiresAt > head &&
      e.app === app &&
      e.kind === kind &&
      e.grant_id === grantId &&
      e.owner === owner &&
      String(e.expiresAt) === expiresAt,
  )
  const select = options.select ?? { key: true }
  const data = hits.slice(0, Number(options.limit ?? "0xc8")).map((e) => ({
    ...(select.owner ? { owner: e.owner } : {}),
    ...(select.expiresAt ? { expiresAt: "0x" + e.expiresAt.toString(16) } : {}),
    ...(select.payload ? { payload: toHexData(new TextEncoder().encode(JSON.stringify(e.payload))) } : {}),
  }))
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { data, blockNumber: "0x" + head.toString(16) } }), {
    status: 200,
  })
}

// ---- fake Lit enclave: one PKP key, Encrypt/Decrypt, runs `main` from the real source ----
const pkpKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"])
const b64 = (u8) => Buffer.from(u8).toString("base64")
const Lit = {
  Actions: {
    async Encrypt({ message }) {
      const iv = crypto.getRandomValues(new Uint8Array(12))
      const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, pkpKey, new TextEncoder().encode(message)))
      return `${b64(iv)}.${b64(ct)}`
    },
    async Decrypt({ ciphertext }) {
      const [iv, ct] = ciphertext.split(".").map((s) => Buffer.from(s, "base64"))
      return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, pkpKey, ct))
    },
  },
}
const context = vm.createContext({ Lit, fetch: fakeArkivFetch, crypto, TextEncoder, TextDecoder })
vm.runInContext(actionSource, context)
async function runAction(jsParams) {
  context.__params = jsParams
  // JSON round trip: the response crosses from the vm's realm into this one, as it crosses HTTP for real.
  return JSON.parse(JSON.stringify(await vm.runInContext("main(__params)", context)))
}

const { generatePrivateKey, privateKeyToAccount } = await import("viem/accounts")
const { createChipotleKeyReleaseProvider, hashActionCid, __resetChipotleAdapterStateForTests } = await import(
  "../lib/key-release/chipotle.ts"
)
const { protectGrantShare, releaseGrantShare } = await import("../lib/grant-package.ts")
const { encodeGrantBinding, deriveGrantPackageKey, openBound, fromBase64Url, toHex, generateLinkSecret, splitContentKey, joinContentKey } =
  await import("../lib/crypto.ts")
const { endSend } = await import("../lib/sends.ts")

__resetChipotleAdapterStateForTests()
const CONFIG = { enabled: true, actionCid: "bafy-h72-binding-proof", pkpId: "0x" + "ab".repeat(20), groupId: "1", usageApiKey: "usage" }
const client = {
  async ping() {},
  async getGroupAuthorization() {
    return { hashedActionCids: [hashActionCid(CONFIG.actionCid)], pkpInGroup: true }
  },
  async invokeAction({ jsParams }) {
    return runAction(jsParams)
  },
  async getActionIpfsId() {
    throw new Error("not used")
  },
}
const provider = createChipotleKeyReleaseProvider({ client, config: CONFIG })

async function commitmentOf(binding) {
  const bytes = encodeGrantBinding({ ...binding, expiresBlock: BigInt(binding.expiresBlock) })
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
}

function randomHex(bytes) {
  return toHex(crypto.getRandomValues(new Uint8Array(bytes)))
}

/** A sender makes a v3 Chipotle share: protect, then write the entity the way `createThresholdGrant` does. */
async function makeShare({ owner, expiresBlock }) {
  const binding = { grantId: "0x" + randomHex(32), owner: owner.toLowerCase(), expiresBlock, ref: randomHex(32) }
  const contentKey = crypto.getRandomValues(new Uint8Array(32))
  const linkSecret = generateLinkSecret()
  const { heldShare } = await splitContentKey(contentKey, linkSecret)
  const release = await protectGrantShare(heldShare, linkSecret, binding, provider)
  const entity = {
    entityKey: "0x" + randomHex(32),
    app: "healthsend",
    kind: "grant",
    grant_id: binding.grantId,
    owner: binding.owner,
    expiresAt: expiresBlock,
    payload: { v: 3, ref: binding.ref, release: { ...release, grantId: binding.grantId } },
  }
  ledger.push(entity)
  return { binding, contentKey, linkSecret, heldShare, release, entity }
}

/** What anyone who kept the link can do offline: open the outer seal and read the Chipotle envelope. */
async function unwrapEnvelope(share) {
  const bindingBytes = encodeGrantBinding(share.binding)
  const outerKey = await deriveGrantPackageKey(share.linkSecret, bindingBytes)
  const envelopeBytes = await openBound(
    outerKey,
    { iv: fromBase64Url(share.release.iv), ciphertext: fromBase64Url(share.release.ciphertext) },
    bindingBytes,
  )
  return JSON.parse(new TextDecoder().decode(envelopeBytes))
}

/** An attacker-owned, live Arkiv entity (any funded key can write one — `/api/fund` pays the gas). */
function writeOwnEntity(binding, payloadRef = binding.ref) {
  ledger.push({
    app: "healthsend",
    kind: "grant",
    grant_id: binding.grantId,
    owner: binding.owner,
    expiresAt: BigInt(binding.expiresBlock),
    payload: { v: 3, ref: payloadRef, release: {} },
  })
}

function removeEntity(entity) {
  const i = ledger.indexOf(entity)
  if (i >= 0) ledger.splice(i, 1)
}

let failures = 0
async function check(name, fn) {
  try {
    await fn()
    console.log(`PASS  ${name}`)
  } catch (error) {
    failures++
    console.log(`FAIL  ${name}\n      ${String(error?.message ?? error).split("\n")[0]}`)
  }
}

/** Refused means `authorized: false` and no result — and, if a result came back anyway, say whether it opened the share. */
async function assertRefused(response, share) {
  if (response.authorized || response.result) {
    let reconstructed = false
    try {
      const stolenHeld = Uint8Array.from(Buffer.from(response.result, "base64"))
      reconstructed = toHex(await joinContentKey(stolenHeld, share.linkSecret)) === toHex(share.contentKey)
    } catch {
      // not a usable share
    }
    console.log(`      RESULT action response: ${JSON.stringify({ authorized: response.authorized, resultBytes: response.result ? Buffer.from(response.result, "base64").length : 0 })}`)
    console.log(`      RESULT Arkiv clause the action checked: ${arkivQueries.at(-1)}`)
    console.log(`      FAIL-OPEN the ended share's content key was reconstructed: ${reconstructed}`)
    throw new Error("the action released a held share it must refuse")
  }
  assert.equal(typeof response.error, "string", "a refusal names its reason")
}

const victim = privateKeyToAccount(generatePrivateKey())
const victimIdentity = { privateKey: generatePrivateKey(), address: victim.address }
const attackerOwner = "0x" + "ee".repeat(20)

// ---- 1. the honest path still works while the grant is live ----
const shareA = await makeShare({ owner: victim.address, expiresBlock: 1_000_900n })
await check("honest release works while the grant is live", async () => {
  const got = await releaseGrantShare(shareA.release, shareA.linkSecret, shareA.binding, provider)
  assert.deepEqual(got, shareA.heldShare)
})

// ---- 2. the sender ends the share with the real endSend; the honest link stops ----
await check("End access now (endSend) deletes the entity, confirms it is gone, and the honest link is refused", async () => {
  const result = await endSend(shareA.entity.entityKey, {
    getIdentity: async () => victimIdentity,
    async getGrant(entityKey) {
      const e = ledger.find((x) => x.entityKey === entityKey)
      return e ? { entityKey, payload: e.payload } : null
    },
    async deleteGrant({ entityKey }) {
      removeEntity(ledger.find((x) => x.entityKey === entityKey))
      return { txHash: "0x" + "cc".repeat(32) }
    },
    fetch: async () => {
      throw new Error("a v3 share must never reach the holder")
    },
    wait: async () => {},
  })
  assert.deepEqual(result, { status: "ended" })
  await assert.rejects(() => releaseGrantShare(shareA.release, shareA.linkSecret, shareA.binding, provider), /not live/)
})

// ---- 3. review-8 F1, exactly: a self-made live binding with a matching commitment ----
const envelopeA = await unwrapEnvelope(shareA)
console.log(`INFO  attacker unwrapped the ended share's Chipotle envelope; commitment = ${envelopeA.commitment.slice(0, 16)}…`)
await check("review-8 F1: the ended share's ciphertext with a self-made live binding and matching commitment is refused", async () => {
  const B = { grantId: "0x" + "99".repeat(32), owner: attackerOwner, expiresBlock: "5000000", ref: "00".repeat(32) }
  writeOwnEntity(B)
  const response = await runAction({
    pkpId: CONFIG.pkpId,
    mode: "release",
    ciphertext: envelopeA.ciphertext,
    commitment: await commitmentOf(B),
    grantId: B.grantId,
    owner: B.owner,
    expiresBlock: B.expiresBlock,
    ref: B.ref,
  })
  await assertRefused(response, shareA)
})

await check("a self-made live binding that copies the ended share's grant id and ref, under the attacker's own owner, is refused", async () => {
  const C = { ...shareA.binding, owner: attackerOwner, expiresBlock: "5000001" }
  writeOwnEntity(C)
  const response = await runAction({
    pkpId: CONFIG.pkpId,
    mode: "release",
    ciphertext: envelopeA.ciphertext,
    commitment: await commitmentOf(C),
    grantId: C.grantId,
    owner: C.owner,
    expiresBlock: C.expiresBlock,
    ref: C.ref,
  })
  await assertRefused(response, shareA)
})

await check("the ended share's ciphertext with its own honest binding (grant deleted) is refused", async () => {
  const response = await runAction({
    pkpId: CONFIG.pkpId,
    mode: "release",
    ciphertext: envelopeA.ciphertext,
    commitment: envelopeA.commitment,
    grantId: shareA.binding.grantId,
    owner: shareA.binding.owner,
    expiresBlock: shareA.binding.expiresBlock.toString(10),
    ref: shareA.binding.ref,
  })
  await assertRefused(response, shareA)
})

// ---- 4. caller-supplied fields never decide: a disagreeing binding is refused even for a live grant ----
const shareD = await makeShare({ owner: victim.address, expiresBlock: 1_000_900n })
const envelopeD = await unwrapEnvelope(shareD)
await check("a live share's ciphertext with a different, also-live binding (matching commitment) is refused", async () => {
  const E = { grantId: "0x" + "77".repeat(32), owner: attackerOwner, expiresBlock: "5000002", ref: shareD.binding.ref }
  writeOwnEntity(E)
  const response = await runAction({
    pkpId: CONFIG.pkpId,
    mode: "release",
    ciphertext: envelopeD.ciphertext,
    commitment: await commitmentOf(E),
    grantId: E.grantId,
    owner: E.owner,
    expiresBlock: E.expiresBlock,
    ref: E.ref,
  })
  await assertRefused(response, shareD)
})

// ---- 5. an expired grant is refused ----
const shareF = await makeShare({ owner: victim.address, expiresBlock: 1_000_050n })
await check("release works for a second share before its expiry block", async () => {
  const got = await releaseGrantShare(shareF.release, shareF.linkSecret, shareF.binding, provider)
  assert.deepEqual(got, shareF.heldShare)
})
await check("once the head passes the grant's expiry block, the honest link is refused", async () => {
  head = 1_000_051n
  try {
    await assert.rejects(() => releaseGrantShare(shareF.release, shareF.linkSecret, shareF.binding, provider), /not live/)
  } finally {
    head = 1_000_000n
    removeEntity(shareF.entity)
  }
})

// ---- 6. an owner-extended entity no longer matches the sealed expiry ----
const shareG = await makeShare({ owner: victim.address, expiresBlock: 1_000_700n })
await check("an entity whose expiry was extended past the sealed block is refused", async () => {
  shareG.entity.expiresAt = 1_009_999n
  const envelopeG = await unwrapEnvelope(shareG)
  const extended = { ...shareG.binding, expiresBlock: "1009999" }
  const response = await runAction({
    pkpId: CONFIG.pkpId,
    mode: "release",
    ciphertext: envelopeG.ciphertext,
    commitment: await commitmentOf(extended),
    grantId: extended.grantId,
    owner: extended.owner,
    expiresBlock: extended.expiresBlock,
    ref: extended.ref,
  })
  await assertRefused(response, shareG)
})

// ---- 7. the sealed ref must match the live entity's payload ----
const shareH = await makeShare({ owner: victim.address, expiresBlock: 1_000_800n })
await check("a live entity at the sealed grant id, owner and expiry whose payload names a different ref is refused", async () => {
  shareH.entity.payload = { ...shareH.entity.payload, ref: "ff".repeat(32) }
  await assert.rejects(() => releaseGrantShare(shareH.release, shareH.linkSecret, shareH.binding, provider), /ref/)
})

// ---- 8. a pre-H-72 ciphertext that carries no sealed binding fails closed ----
await check("a ciphertext protected before H-72 (bare payload, no sealed binding) is refused, even with its grant live", async () => {
  const binding = { grantId: "0x" + randomHex(32), owner: victim.address.toLowerCase(), expiresBlock: "1000900", ref: randomHex(32) }
  writeOwnEntity(binding)
  const legacyCiphertext = await Lit.Actions.Encrypt({ pkpId: CONFIG.pkpId, message: b64(new Uint8Array(32).fill(8)) })
  const response = await runAction({
    pkpId: CONFIG.pkpId,
    mode: "release",
    ciphertext: legacyCiphertext,
    commitment: await commitmentOf(binding),
    ...binding,
  })
  assert.equal(response.authorized, false, "an unsealed ciphertext must never release")
  assert.equal(response.result, undefined)
  assert.match(response.error, /sealed/)
})

// ---- 9. F6: the end and expiry copy these checks stand behind is the copy that ships ----
await check("the v3 end and expiry copy these checks make true is still the shipped copy", async () => {
  const recipientPage = readFileSync(new URL("../app/s/[key]/page.tsx", import.meta.url), "utf8")
  const removeSheet = readFileSync(new URL("../components/remove-document-sheet-logic.ts", import.meta.url), "utf8")
  assert.ok(recipientPage.includes("This link just can’t open it any more"))
  assert.ok(removeSheet.includes("so nobody can open it again"))
})

if (failures > 0) {
  console.log(`\n${failures} check(s) failed.`)
  process.exit(1)
}
console.log("\nAll checks passed.")
