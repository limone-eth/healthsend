# TACo Expiring Grants PoC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Demonstrate one encrypted Swarm upload shared through two independent Arkiv grants whose key shares are protected by TACo, so an expired original link cannot obtain new decryption material while another live grant for the same upload still opens.

**Architecture:** Split the existing combined send into an in-memory encrypted asset and grant issuance. Each grant derives a different link share for the same asset content key, threshold-encrypts the complementary share under an Arkiv `arkiv_query` condition, then encrypts the resulting TACo message kit under a second link-derived key before publishing it in an Arkiv v3 payload. The browser fetches the one Swarm ciphertext and keeps released keys only in memory.

**Tech Stack:** Next.js 16.3 App Router, React 19, TypeScript, Web Crypto AES-256-GCM/HKDF, Swarm ID, Arkiv SDK 0.8.1, `@nucypher/taco` 0.6.0, ethers 5.7.2, Node proof scripts, Playwright.

**Spec:** `/Users/limone/Desktop/healthsend-single-upload-expiry-plan.md`; supporting protocol research: `/Users/limone/Desktop/threshold-expiry-alternatives.md`.

## Global Constraints

- Use synthetic files only. Current TACo documentation says active infrastructure, including testnets, is unsupported; never send real health data through Lynx.
- The PoC must use exactly one Swarm content upload for both grants. Arkiv transactions and TACo requests may occur per grant.
- Grant A and Grant B may expose the same complete bundle. File-, marker-, and date-level encryption are separate work.
- A fresh open must contact TACo. Never persist the content key, held share, link secret, unwrapped message kit, or plaintext in localStorage, sessionStorage, IndexedDB, Cache Storage, cookies, logs, or a database.
- The accepted promise is “block new unlocks after expiry, even with the original link.” Previously obtained keys or plaintext remain usable and must be described honestly.
- The TACo release condition must be immutable inside the message kit and bind `grant_id`, native Arkiv owner, and the original native Arkiv expiry block. It must query current state without `atBlock`.
- The outer link-secret encryption must cover the TACo message kit so a public crawler cannot prefetch held shares from every live grant.
- Arkiv unavailability, TACo unavailability, malformed responses, and uncertain current state must fail closed without releasing key material. They must render as retryable unavailability, not expiry.
- Existing v1 legacy and v2 Redis-holder links must remain readable. Keep the existing holder implementation until the PoC passes and a supported TACo network exists.
- Follow the repository's generated `AGENTS.md`: consult the bundled Next.js docs before changing App Router files. Route Handlers are request-time and uncached by default in this installed Next.js version.
- Pin `@nucypher/taco` to `0.6.0` and `ethers` to `5.7.2` for the PoC because the current TACo quick reference requires ethers v5. Do not float either dependency.
- Do not claim production readiness, secure erasure, recipient identity, or a currently supported decentralized service.

---

## File Map

- Create `lib/assets.ts`: pack, encrypt, and upload one reusable in-memory asset.
- Create `lib/grant-package.ts`: grant bindings, bound outer encryption, and package serialization.
- Create `lib/key-release/types.ts`: provider-neutral threshold-release contract.
- Create `lib/key-release/taco.ts`: browser-only TACo initialization, Arkiv condition construction, encryption, and release.
- Modify `lib/crypto.ts`: add domain-separated capsule wrapping and AEAD additional-data helpers.
- Modify `lib/arkiv.ts`: add v3 payload parsing, a random `grant_id` attribute, native owner/expiry selection, and exact-expiry creation.
- Modify `lib/sends.ts`: add grant issuance for an existing asset and v3 opening while preserving v1/v2 paths.
- Create `app/taco-poc/page.tsx`: synthetic one-upload/two-grant demonstration surface.
- Create `scripts/taco-package-proof.mjs`: offline package, binding, prefetch, and persistence proof.
- Create `scripts/taco-live-proof.mjs`: opt-in infrastructure probe using a real TACo cohort and disposable Arkiv entity.
- Modify `package.json`: pinned dependencies and proof commands.
- Modify `.env.example`: explicit PoC configuration.
- Modify `README.md`: run instructions, evidence language, and current TACo infrastructure warning.

---

### Task 1: Establish the key-release boundary and bound package format

**Files:**
- Create: `lib/key-release/types.ts`
- Create: `lib/grant-package.ts`
- Modify: `lib/crypto.ts`
- Create: `scripts/taco-package-proof.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `GrantBinding`, `ProtectedKeyShare`, `KeyReleaseProvider`, `protectGrantShare`, and `releaseGrantShare`.
- Consumes: existing `seal`, `open`, base64url helpers, and split-key functions from `lib/crypto.ts`.

- [ ] **Step 1: Write the failing offline proof**

Create `scripts/taco-package-proof.mjs` with a fake provider that records bindings and refuses an expired release:

```js
import assert from "node:assert/strict"

const { generateContentKey, generateLinkSecret, splitContentKey, joinContentKey } =
  await import("../lib/crypto.ts")
const { protectGrantShare, releaseGrantShare } = await import("../lib/grant-package.ts")

const ref = "ab".repeat(32)
const owner = `0x${"12".repeat(20)}`
const grantId = `0x${"34".repeat(32)}`
const binding = { grantId, owner, expiresBlock: 900n, ref }
const cek = generateContentKey()
const secret = generateLinkSecret()
const { heldShare } = await splitContentKey(cek, secret)

let live = true
const provider = {
  descriptor: { provider: "taco", domain: "lynx", ritualId: 27 },
  async protect(share, received) {
    assert.deepEqual(received, binding)
    return Uint8Array.from(share, byte => byte ^ 0xa5)
  },
  async release(ciphertext, received) {
    assert.deepEqual(received, binding)
    if (!live) throw new Error("grant condition failed")
    return Uint8Array.from(ciphertext, byte => byte ^ 0xa5)
  },
}

const protectedShare = await protectGrantShare(heldShare, secret, binding, provider)
assert.ok(!Buffer.from(protectedShare.ciphertext, "base64url").includes(Buffer.from(heldShare)))
assert.deepEqual(
  Buffer.from(await joinContentKey(await releaseGrantShare(protectedShare, secret, binding, provider), secret)),
  Buffer.from(cek),
)
live = false
await assert.rejects(releaseGrantShare(protectedShare, secret, binding, provider), /condition failed/)
await assert.rejects(
  releaseGrantShare(protectedShare, secret, { ...binding, grantId: `0x${"56".repeat(32)}` }, provider),
)
console.log("PASS  protected grant share is bound, link-wrapped, and release-gated")
```

- [ ] **Step 2: Add the proof command and verify it fails**

Add this script to `package.json`:

```json
"verify:taco-package": "node --experimental-strip-types scripts/taco-package-proof.mjs"
```

Run: `pnpm verify:taco-package`

Expected: FAIL because `lib/grant-package.ts` does not exist.

- [ ] **Step 3: Define the provider interface**

Create `lib/key-release/types.ts`:

```ts
export type GrantBinding = {
  grantId: `0x${string}`
  owner: `0x${string}`
  expiresBlock: bigint
  ref: string
}

export type ProtectedKeyShare = {
  provider: "taco"
  domain: "lynx"
  ritualId: number
  iv: string
  ciphertext: string
}

export interface KeyReleaseProvider {
  readonly descriptor: Pick<ProtectedKeyShare, "provider" | "domain" | "ritualId">
  protect(heldShare: Uint8Array, binding: GrantBinding): Promise<Uint8Array>
  release(protectedShare: Uint8Array, binding: GrantBinding): Promise<Uint8Array>
}
```

- [ ] **Step 4: Add domain-separated bound encryption**

In `lib/crypto.ts`, add `deriveGrantPackageKey`, `sealBound`, and `openBound`. Encode the binding canonically rather than serializing arbitrary objects:

```ts
const INFO_GRANT_PACKAGE = "healthsend/grant-package/v1"

export function encodeGrantBinding(binding: {
  grantId: string
  owner: string
  expiresBlock: bigint
  ref: string
}): Uint8Array {
  return new TextEncoder().encode(
    ["healthsend", "grant-binding", "v1", binding.grantId.toLowerCase(),
      binding.owner.toLowerCase(), binding.expiresBlock.toString(10), binding.ref.toLowerCase()].join("\n"),
  )
}

export async function deriveGrantPackageKey(secret: Uint8Array, bindingBytes: Uint8Array) {
  const material = await crypto.subtle.importKey("raw", secret as BufferSource, "HKDF", false, ["deriveBits"])
  const bits = await crypto.subtle.deriveBits({
    name: "HKDF",
    hash: "SHA-256",
    salt: bindingBytes as BufferSource,
    info: new TextEncoder().encode(INFO_GRANT_PACKAGE) as BufferSource,
  }, material, 256)
  return new Uint8Array(bits)
}
```

Use AES-GCM's `additionalData` in `sealBound` and `openBound`; never reuse the existing unbound `seal` call for the outer package.

- [ ] **Step 5: Implement package protection and release**

Create `lib/grant-package.ts`. `protectGrantShare` calls the provider first, then outer-encrypts its result using the link secret. `releaseGrantShare` authenticates and unwraps the outer package before calling the provider:

```ts
export async function protectGrantShare(
  heldShare: Uint8Array,
  linkSecret: Uint8Array,
  binding: GrantBinding,
  provider: KeyReleaseProvider,
): Promise<ProtectedKeyShare> {
  const bindingBytes = encodeGrantBinding(binding)
  const tacoBytes = await provider.protect(heldShare, binding)
  const key = await deriveGrantPackageKey(linkSecret, bindingBytes)
  const sealed = await sealBound(key, tacoBytes, bindingBytes)
  return {
    ...provider.descriptor,
    iv: toBase64Url(sealed.iv),
    ciphertext: toBase64Url(sealed.ciphertext),
  }
}
```

Validate `provider`, `domain`, `ritualId`, IV length, decoded ciphertext length, grant-ID length, owner shape, and positive expiry before performing cryptography.

- [ ] **Step 6: Run the proof and existing crypto checks**

Run: `pnpm verify:taco-package && pnpm verify:crypto`

Expected: both commands print only PASS results and exit 0.

- [ ] **Step 7: Commit the boundary**

```bash
git add package.json lib/crypto.ts lib/key-release/types.ts lib/grant-package.ts scripts/taco-package-proof.mjs
git commit -m "feat: define bound threshold grant packages"
```

---

### Task 2: Add an Arkiv v3 grant whose TACo policy cannot be extended or substituted

**Files:**
- Modify: `lib/arkiv.ts`
- Create: `scripts/arkiv-taco-condition-proof.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `GrantBinding` and `ProtectedKeyShare` from Task 1.
- Produces: `ThresholdGrantPayload`, `buildGrantBinding`, `createThresholdGrant`, and authoritative native owner/expiry fields on `Grant`.

- [ ] **Step 1: Write the failing condition proof**

Create a proof that captures the exact `arkiv_query` condition description without touching a network:

```js
import assert from "node:assert/strict"
const { buildArkivGrantQuery } = await import("../lib/arkiv.ts")

const binding = {
  grantId: `0x${"34".repeat(32)}`,
  owner: `0x${"12".repeat(20)}`,
  expiresBlock: 900n,
  ref: "ab".repeat(32),
}
const request = buildArkivGrantQuery(binding)
assert.equal(request.method, "arkiv_query")
assert.ok(request.params[0].includes(`grant_id = bytes32(${binding.grantId})`))
assert.ok(request.params[0].includes(`$owner = addr(${binding.owner})`))
assert.ok(request.params[0].includes("$expiresAt = u64(900)"))
assert.equal("atBlock" in request.params[1], false)
assert.deepEqual(request.params[1].select, { owner: true })
assert.equal(request.query, "$.data[0].owner")
assert.equal(request.expected, binding.owner)
console.log("PASS  condition pins grant id, owner, original expiry, and current Arkiv state")
```

Add `verify:taco-condition` to `package.json`, run it, and expect a missing-export failure.

- [ ] **Step 2: Add the v3 payload and grant binding fields**

Extend the Arkiv types without changing v1/v2 parsing:

```ts
export type ThresholdGrantPayload = {
  v: 3
  ref: string
  release: ProtectedKeyShare & { grantId: `0x${string}` }
}

export type Grant = {
  // existing fields
  owner: string
  expiresBlock: number
  payload: GrantPayload | LegacyGrantPayload | ThresholdGrantPayload
}
```

For v3, read `owner` and `expiresAt` from the entity's native selected fields. Reject a v3 entity when custom `sender`/`expires_block` disagree with native owner/expiry; do not silently choose one.

- [ ] **Step 3: Construct the exact current-state Arkiv request**

Add `buildArkivGrantQuery(binding)` returning:

```ts
{
  endpoint: ARKIV_RPC,
  method: "arkiv_query",
  params: [
    `app = str('healthsend') AND kind = str('grant') AND ` +
      `grant_id = bytes32(${binding.grantId}) AND ` +
      `$owner = addr(${binding.owner}) AND $expiresAt = u64(${binding.expiresBlock})`,
    { select: { owner: true }, limit: "0x1" },
  ],
  query: "$.data[0].owner",
  expected: binding.owner.toLowerCase(),
}
```

Require `NEXT_PUBLIC_ARKIV_RPC` to be an explicit HTTPS URL for TACo mode. Do not use an API key in the URL or TACo condition because the endpoint is embedded in permanent ciphertext.

- [ ] **Step 4: Create one final grant transaction**

Add `createThresholdGrant` accepting an already computed `expiresBlock`, a random 32-byte `grantId`, and a complete v3 payload. Write `grant_id: bytes32(grantId)` and set `expires: ExpirationTime.atBlock(expiresBlock)`. Set `flags: { permissionlessExtension: false }`.

Do not mark the entity `readonly` as an expiry guarantee: Arkiv readonly entities can still be extended, transferred, and deleted. The condition's native `$expiresAt = originalBlock` predicate makes any extension fail rather than prolong release.

- [ ] **Step 5: Select native metadata on reads**

Change both list and single-grant reads to select `owner: true` and `expiresAt: true`:

```ts
.select({ key: true, owner: true, expiresAt: true, attributes: true, payload: true })
```

Keep `getGrant` returning `null` only for `NoEntityFoundError`. Preserve transport and malformed-payload failures.

- [ ] **Step 6: Run proofs**

Run: `pnpm verify:taco-condition && pnpm verify:revoke && pnpm verify:expiry 20`

Expected: the offline condition and revoke proofs pass; the live expiry proof passes when Arkiv is reachable.

- [ ] **Step 7: Commit the schema**

```bash
git add package.json lib/arkiv.ts scripts/arkiv-taco-condition-proof.mjs
git commit -m "feat: add Arkiv-bound threshold grants"
```

---

### Task 3: Implement the TACo browser adapter behind an availability gate

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `.env.example`
- Create: `lib/key-release/taco.ts`
- Create: `scripts/taco-adapter-proof.mjs`

**Interfaces:**
- Consumes: `GrantBinding`, `KeyReleaseProvider`, and `buildArkivGrantQuery`.
- Produces: `createTacoKeyReleaseProvider()` and `probeTacoInfrastructure()`.

- [ ] **Step 1: Install pinned dependencies**

Run:

```bash
pnpm add @nucypher/taco@0.6.0 ethers@5.7.2
```

Expected: exact versions appear in `package.json`; `pnpm-lock.yaml` changes.

- [ ] **Step 2: Document public PoC configuration**

Add to `.env.example`:

```dotenv
# Synthetic-data TACo PoC only. Current TACo docs say no supported active infrastructure.
NEXT_PUBLIC_TACO_ENABLED=false
NEXT_PUBLIC_TACO_DOMAIN=lynx
NEXT_PUBLIC_TACO_RITUAL_ID=27
NEXT_PUBLIC_TACO_COORDINATION_RPC=https://polygon-amoy.drpc.org
# Optional comma-separated override; omit to use the SDK's domain discovery.
NEXT_PUBLIC_TACO_PORTER_URIS=
```

All values are intentionally public configuration. Do not introduce a TACo private key or Arkiv access key in `NEXT_PUBLIC_*` variables.

Also add the missing static type-check command to `package.json` because later verification steps invoke it:

```json
"typecheck": "tsc --noEmit"
```

- [ ] **Step 3: Write a failing adapter proof with injected SDK functions**

In `scripts/taco-adapter-proof.mjs`, inject fake `initialize`, `encrypt`, `decrypt`, and `ThresholdMessageKit` functions. Assert that:

- initialization occurs once across two providers;
- `protect` passes a `JsonRpcCondition` whose endpoint, method, params, JSONPath, and expected owner match Task 2;
- `protect` serializes with `messageKit.toBytes()`;
- `release` deserializes with `ThresholdMessageKit.fromBytes()`;
- `release` calls `decrypt` without a caller-selected condition or historical Arkiv block;
- a failed decrypt is returned as a typed unavailable/denied error without the held share.

Run it and expect a missing-module failure.

- [ ] **Step 4: Implement the adapter using the official API**

Create `lib/key-release/taco.ts` as a client-only module. The concrete calls are:

```ts
import {
  conditions,
  decrypt,
  domains,
  encrypt,
  initialize,
  ThresholdMessageKit,
} from "@nucypher/taco"
import { ethers } from "ethers"

const provider = new ethers.providers.JsonRpcProvider(config.coordinationRpc)
const domain = domains.DEVNET
const condition = new conditions.base.jsonRpc.JsonRpcCondition({
  endpoint: request.endpoint,
  method: request.method,
  params: request.params,
  query: request.query,
  returnValueTest: { comparator: "==", value: request.expected },
})
const signer = new ethers.Wallet(encryptorPrivateKey, provider)
const messageKit = await encrypt(provider, domain, heldShare, condition, config.ritualId, signer)
const protectedBytes = messageKit.toBytes()

const restored = ThresholdMessageKit.fromBytes(protectedBytes)
const heldShare = await decrypt(provider, domain, restored, undefined, config.porterUris)
```

Call `initialize()` through one module-level memoized promise. Validate the domain rather than accepting arbitrary strings. The encryptor signing key comes from the existing sender identity only at grant creation; it is not stored in the payload.

- [ ] **Step 5: Add a non-secret infrastructure probe**

`probeTacoInfrastructure` should initialize the SDK, call the configured coordination RPC, resolve the ritual through the same `encrypt` path only when given a disposable held share and disposable condition, and classify failures as:

```ts
type TacoProbeResult =
  | { status: "available"; domain: "lynx"; ritualId: number }
  | { status: "unavailable"; stage: "initialize" | "coordination" | "encrypt" | "porter"; message: string }
```

Never convert failure to a fake success or silently use Redis.

- [ ] **Step 6: Run adapter and static checks**

Run: `pnpm verify:taco-adapter && pnpm typecheck && pnpm lint`

Expected: all exit 0.

- [ ] **Step 7: Commit the adapter**

```bash
git add package.json pnpm-lock.yaml .env.example lib/key-release/taco.ts scripts/taco-adapter-proof.mjs
git commit -m "feat: add gated TACo key release adapter"
```

---

### Task 4: Separate the one-time asset upload from per-recipient grants

**Files:**
- Create: `lib/assets.ts`
- Modify: `lib/sends.ts`
- Create: `scripts/single-upload-grants-proof.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `EncryptedAsset`, `createEncryptedAsset`, and `createThresholdSend`.
- Consumes: `createThresholdGrant`, `protectGrantShare`, sender identity, and the TACo adapter.

- [ ] **Step 1: Write the failing one-upload/two-grant proof**

Use injected functions and counters:

```js
let uploads = 0
let grants = 0
const asset = await createEncryptedAsset(
  [{ name: "synthetic.csv", type: "text/csv", size: bytes.length,
     arrayBuffer: async () => bytes.buffer }],
  { uploadEncryptedBlob: async () => ({ reference: "ab".repeat(32), tagUid: 1 }),
    onUpload: () => uploads++ },
)
const a = await createThresholdSend(asset, { recipientLabel: "Doctor A", ttlSeconds: 30 }, deps)
const b = await createThresholdSend(asset, { recipientLabel: "Doctor B", ttlSeconds: 300 }, deps)
grants += Number(Boolean(a.entityKey)) + Number(Boolean(b.entityKey))
assert.equal(uploads, 1)
assert.equal(grants, 2)
assert.equal(a.swarmRef, b.swarmRef)
assert.notEqual(new URL(a.url).hash, new URL(b.url).hash)
```

Run and expect a missing-module/export failure.

- [ ] **Step 2: Implement one-time asset creation**

Create `lib/assets.ts`:

```ts
export type EncryptedAsset = {
  ref: string
  contentKey: Uint8Array
  fileKind: FileKind
  fileCount: number
  labelSource: string
}

export async function createEncryptedAsset(files: File[]): Promise<EncryptedAsset> {
  // pack once, generate one CEK, AES-GCM seal once, upload once
}
```

The type is intentionally not serializable and has no persistence helper. Keep the CEK in component/process memory only. Zero temporary plaintext/key arrays on best-effort cleanup where practical, without claiming JavaScript memory erasure.

- [ ] **Step 3: Implement per-grant issuance**

Add `createThresholdSend(asset, params, deps)` to `lib/sends.ts`:

1. obtain identity and current Arkiv block;
2. compute one absolute `expiresBlock`;
3. generate `grantId`, link secret, and held share;
4. build `GrantBinding` with the same owner/ref/expiry written to Arkiv;
5. TACo-protect and outer-wrap the held share;
6. create one final v3 Arkiv entity;
7. return a link using that entity key and link secret.

No `/api/holder/share` preflight or handoff occurs in this path. Preserve the existing `createSend` function unchanged for v2 compatibility.

- [ ] **Step 4: Prevent mismatched bindings**

Before returning the URL, assert that the created entity reports the expected owner and expiry. Treat mismatches as a failed grant and do not produce a link. The already-uploaded asset remains reusable.

- [ ] **Step 5: Run single-upload and regression proofs**

Run:

```bash
pnpm verify:single-upload-grants
pnpm verify:crypto
pnpm verify:revoke
pnpm verify:holder
```

Expected: exactly one mocked upload, two grants, distinct fragments, and all existing proofs pass.

- [ ] **Step 6: Commit asset/grant separation**

```bash
git add package.json lib/assets.ts lib/sends.ts scripts/single-upload-grants-proof.mjs
git commit -m "feat: issue many grants from one Swarm asset"
```

---

### Task 5: Open v3 links through TACo without persistent browser storage

**Files:**
- Modify: `lib/sends.ts`
- Modify: `app/s/[key]/page.tsx`
- Create: `scripts/taco-unlock-proof.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: v3 grant payloads, `releaseGrantShare`, and `createTacoKeyReleaseProvider`.
- Produces: v3 handling in `openSend` with existing `OpenedSend | OpenFailure` results.

- [ ] **Step 1: Write the failing unlock proof**

Inject `getGrant`, `getCurrentBlock`, `releaseGrantShare`, and `fetchBlobFromGateway`. Cover these cases explicitly:

- live v3 grant reconstructs the CEK and decrypts the bundle;
- missing/expired Arkiv entity never calls TACo;
- head at `expiresBlock` never calls TACo;
- TACo condition denial maps to `expired` only after an authoritative Arkiv not-found/head-boundary result;
- TACo/RPC/network errors map to retryable `unavailable`;
- altered grant ID, owner, expiry, ref, IV, or ciphertext fails before plaintext;
- v1 and v2 paths remain unchanged.

Run and expect the v3 case to fail.

- [ ] **Step 2: Add a distinct v3 branch to `openSend`**

The new branch must:

```ts
const binding = {
  grantId: grant.payload.release.grantId,
  owner: grant.owner as `0x${string}`,
  expiresBlock: BigInt(grant.expiresBlock),
  ref: grant.payload.ref,
}
const heldShare = await releaseGrantShare(
  grant.payload.release,
  linkSecret,
  binding,
  createTacoKeyReleaseProvider(),
)
contentKey = await joinContentKey(heldShare, linkSecret)
```

Keep the v3 branch in browser code so the released share and CEK do not pass through a HealthSend API route.

- [ ] **Step 3: Keep keys ephemeral in application code**

Search the diff for browser persistence APIs:

```bash
git diff -- lib app | rg "localStorage|sessionStorage|indexedDB|caches\.open|document\.cookie"
```

Expected: no new matches in the v3 creation/opening path. Existing share-history metadata may remain; it must contain no secret, key share, message kit, or plaintext.

- [ ] **Step 4: Preserve honest error copy**

Update `app/s/[key]/page.tsx` only where needed so unavailable infrastructure says the grant could not be checked/opened and offers retry. Expired copy appears only after Arkiv confirms absence or the current head reaches the bound block.

- [ ] **Step 5: Run unlock and UI regressions**

Run: `pnpm verify:taco-unlock && pnpm e2e && pnpm typecheck && pnpm lint`

Expected: all pass; existing v1/v2 Playwright cases remain green.

- [ ] **Step 6: Commit v3 opening**

```bash
git add package.json lib/sends.ts app/s/[key]/page.tsx scripts/taco-unlock-proof.mjs
git commit -m "feat: open threshold grants through TACo"
```

---

### Task 6: Add the synthetic one-upload/two-grant PoC page

**Files:**
- Create: `app/taco-poc/page.tsx`
- Create: `app/taco-poc/taco-poc-client.tsx`
- Create: `e2e/taco-poc.spec.ts`

**Interfaces:**
- Consumes: `createEncryptedAsset`, `createThresholdSend`, and connection state from `lib/swarm.ts`.
- Produces: an isolated developer demonstration; it does not replace `/new`.

- [ ] **Step 1: Write the failing Playwright test**

Mock Swarm, Arkiv, and TACo boundaries. The test must assert the visible sequence and counters:

```ts
test("one asset creates two independently expiring links", async ({ page }) => {
  await page.goto("/taco-poc")
  await page.getByRole("button", { name: "Create synthetic asset" }).click()
  await expect(page.getByText("Swarm uploads: 1")).toBeVisible()
  await page.getByRole("button", { name: "Grant A · 30 seconds" }).click()
  await page.getByRole("button", { name: "Grant B · 5 minutes" }).click()
  await expect(page.getByText("Arkiv grants: 2")).toBeVisible()
  await expect(page.getByText("Same Swarm reference")).toBeVisible()
})
```

Run: `pnpm exec playwright test e2e/taco-poc.spec.ts`

Expected: FAIL with `/taco-poc` not found.

- [ ] **Step 2: Add a server page and client boundary**

Following the installed Next.js App Router rules, keep the route page server-renderable and put browser crypto/Swarm operations in `taco-poc-client.tsx` under `"use client"`:

```tsx
import TacoPocClient from "./taco-poc-client"

export default function TacoPocPage() {
  return <TacoPocClient />
}
```

- [ ] **Step 3: Implement the demonstration state machine**

Use a generated CSV containing only synthetic values. Disable grant buttons until the asset is uploaded. Hold `EncryptedAsset` in React state/ref; never serialize it. Show:

- TACo disabled/unavailable status before creating anything;
- upload count and Swarm reference;
- two independently selectable TTLs;
- two share links with the identical reference and distinct entity keys/fragments;
- explicit text: “Closing or refreshing this page discards the in-memory asset key; the PoC cannot issue another grant afterward.”

Do not add real file selection to this page.

- [ ] **Step 4: Fail without falling back**

When TACo cannot initialize, encrypt, or reach a cohort, stop before creating a grant and render the failing stage. Do not call `/api/holder/share` and do not produce a link.

- [ ] **Step 5: Run page tests and build**

Run:

```bash
pnpm exec playwright test e2e/taco-poc.spec.ts
pnpm typecheck
pnpm lint
pnpm build
```

Expected: all pass; the build reports `/taco-poc` without importing browser-only TACo code into the server bundle.

- [ ] **Step 6: Commit the PoC surface**

```bash
git add app/taco-poc e2e/taco-poc.spec.ts
git commit -m "feat: demonstrate one upload with two TACo grants"
```

---

### Task 7: Prove the live boundary or record an infrastructure block

**Files:**
- Create: `scripts/taco-live-proof.mjs`
- Modify: `package.json`
- Create: `arkiv/evidence/taco-poc.md`

**Interfaces:**
- Consumes: deployed Arkiv RPC, configured TACo domain/ritual/Porter, synthetic held share, and Task 2 condition builder.
- Produces: reproducible evidence with a strict `live`, `blocked`, or `failed` conclusion.

- [ ] **Step 1: Add an explicitly opt-in command**

Add:

```json
"verify:taco-live": "node --experimental-strip-types scripts/taco-live-proof.mjs"
```

The script must require `RUN_TACO_LIVE_PROOF=1`; without it, print configuration and exit 2. It must refuse input files and generate random/synthetic bytes internally.

- [ ] **Step 2: Implement staged evidence**

Record timestamps and these stages without logging secrets:

```txt
1 coordination RPC reachable
2 configured ritual active
3 disposable Arkiv grant created
4 held share encrypted under JsonRpcCondition
5 live grant releases held share
6 Arkiv grant absent at/after boundary
7 original link inputs cannot obtain a new held share
```

Print only hashes of the held share/message kit/link secret. Never print the material itself.

- [ ] **Step 3: Classify outcomes honestly**

- `LIVE`: all seven stages pass through TACo nodes.
- `BLOCKED`: the documented infrastructure is unavailable before a threshold release; include exact endpoint/stage/error and link the current warning.
- `FAILED`: infrastructure responded but the Arkiv condition, binding, expiry, or decryption behaved incorrectly.

Do not make `BLOCKED` exit 0. Use exit 3 so CI and demos cannot mistake it for a successful threshold proof.

- [ ] **Step 4: Run the live proof**

Run:

```bash
RUN_TACO_LIVE_PROOF=1 pnpm verify:taco-live
```

Expected today: either `LIVE` with all seven stages, or `BLOCKED` because TACo's current documentation says no active supported infrastructure. A timeout is `BLOCKED`, not evidence of expiry.

- [ ] **Step 5: Save the evidence**

Write `arkiv/evidence/taco-poc.md` with the exact command, UTC date, package versions, Arkiv entity/transaction links, Swarm reference, TACo domain/ritual, stage results, and final classification. Redact all fragment secrets and key material.

- [ ] **Step 6: Commit the evidence harness**

```bash
git add package.json scripts/taco-live-proof.mjs arkiv/evidence/taco-poc.md
git commit -m "test: add live TACo expiry evidence"
```

---

### Task 8: Document scope, verify regressions, and review claims

**Files:**
- Modify: `README.md`
- Modify: `docs/research/single-upload-expiry-review.md`
- Modify: `docs/research/threshold-expiry-alternatives.md`

**Interfaces:**
- Consumes: final live-proof classification and all implemented commands.
- Produces: reviewer- and demo-ready documentation that matches observed behavior.

- [ ] **Step 1: Update the README architecture**

Document v3 as experimental and gated by `NEXT_PUBLIC_TACO_ENABLED`. State:

```md
One encrypted Swarm asset can back multiple Arkiv grants. Each grant protects a
different complementary key share under its own TACo condition and link secret.
Expiry blocks new key releases. It cannot revoke a key or plaintext already obtained.
```

Keep the existing v1/v2 explanation and migration behavior.

- [ ] **Step 2: Publish only the observed TACo status**

If Task 7 is `LIVE`, name the tested domain, ritual, date, and synthetic-data limitation. If it is `BLOCKED`, state that the integration is implemented and offline-proven but no live threshold claim is made. Do not describe old ritual metadata as proof that nodes currently operate.

- [ ] **Step 3: Run the complete local verification once**

Run:

```bash
pnpm verify:taco-package
pnpm verify:taco-condition
pnpm verify:taco-adapter
pnpm verify:single-upload-grants
pnpm verify:taco-unlock
pnpm verify:crypto
pnpm verify:revoke
pnpm verify:holder
pnpm e2e
pnpm typecheck
pnpm lint
pnpm build
git diff --check
```

Expected: all local/offline commands pass. `verify:taco-live` is intentionally separate because external infrastructure is not a deterministic CI dependency.

- [ ] **Step 4: Audit the diff for forbidden persistence and overclaims**

Run:

```bash
git diff | rg -n "localStorage|sessionStorage|indexedDB|Cache Storage|erased|destroyed|production.ready|recipient identity"
```

Review every match. Existing metadata-only local history is allowed; no v3 secret or plaintext persistence is allowed. Replace unsupported claims with the exact tested statement.

- [ ] **Step 5: Commit documentation**

```bash
git add README.md docs/research/single-upload-expiry-review.md docs/research/threshold-expiry-alternatives.md
git commit -m "docs: record TACo PoC guarantees and limits"
```

---

## Definition of Done

- The PoC page performs one Swarm upload and creates two v3 Arkiv entities referencing it.
- Each entity contains a separately protected TACo message kit hidden by its link secret.
- Grant conditions bind random grant ID, native owner, and the original native expiry block against current Arkiv state.
- Before expiry, both original links can request their held shares and open the synthetic bundle when TACo infrastructure is available.
- After Grant A expires, its untouched original link cannot obtain a new held share; Grant B continues to open from the same Swarm reference.
- Refreshing the sender PoC page discards the asset CEK and prevents further grant creation from that session.
- No v3 keys, shares, fragments, message kits, or plaintext are stored persistently by HealthSend.
- Existing v1/v2 links and holder proofs remain green.
- The evidence distinguishes a real multi-node result from an infrastructure-blocked integration.
- Documentation says that previously delivered keys/plaintext remain usable and that TACo is not currently a supported production dependency.

## Explicitly Deferred

- Production health data and a production TACo deployment.
- Self-hosting a TACo cohort, DKG contracts, and Porter.
- Selective file/marker/date component encryption inside the single asset.
- Durable owner-key recovery and cross-device resharing after browser refresh.
- Replacing or deleting Redis holder routes.
- Four-digit PIN rate limiting and access logs.
- Remote MCP/OAuth integration with Claude.
- Cryptographic recipient identity beyond possession of the complete link.
