/**
 * The immutable Lit Action that gates release of a Chipotle-protected key
 * share. This is the ONLY action that may be permitted to use its PKP's
 * group — `lib/key-release/chipotle.ts`'s `ensureSingleAuthorizedAction`
 * refuses to operate if a second, more permissive action is ever found
 * permitted on the same group, or if the group permits all actions via the
 * `0` wildcard (see that file's module doc). Once published to IPFS and
 * registered by its CID (`POST /add_action`, `POST /add_action_to_group` —
 * see `scripts/chipotle-print-action-cid.mjs`), this source must never
 * change: a mutable action would let whoever controls the pin rewrite the
 * release rule for every share already protected under it.
 *
 * Written against Lit's current Actions entry point
 * (`developer.litprotocol.com/lit-actions/migration/changes`, "Breaking
 * Change: Action Entry Point and Response"): an `async function main(...)`
 * that returns a value directly — no `Lit.Actions.setResponse`, no IIFE.
 * `chipotle.ts`'s `invokeAction` calls this action by **`ipfs_id`** — `code`
 * only for its one cache-miss retry — and passes `js_params` as this
 * function's single argument.
 *
 * This file is plain JS, not TypeScript: Lit Actions execute as standalone
 * JS in a sandboxed runtime and cannot import this repo's modules. Two
 * pieces of logic are therefore deliberately duplicated rather than
 * imported, and a comment marks each one so it is found the next time the
 * source of truth changes:
 *
 *   - `encodeGrantBindingBytes` mirrors `lib/crypto.ts`'s `encodeGrantBinding`.
 *   - `buildArkivClause` mirrors `lib/arkiv.ts`'s `buildArkivGrantQuery` — the
 *     exact query-language grammar (`app = str('healthsend') AND ...`) comes
 *     from `@arkiv-network/sdk`'s own `render()`
 *     (`node_modules/@arkiv-network/sdk/src/query/expression.ts`), copied
 *     here byte-for-byte rather than approximated, because a wrong grammar
 *     fails closed (matches nothing) while a *subtly* wrong one could match
 *     something unintended.
 *
 * `ARKIV_RPC_ENDPOINT` is hardcoded, not taken from `jsParams`: if the
 * endpoint were caller supplied, anyone who could invoke this action directly
 * (bypassing `chipotle.ts` entirely — nothing stops that, since the action is
 * public once its `ipfs_id` and a usage key are known) could point "Arkiv" at
 * a server they control that always answers "still live".
 *
 * The same caller controls every other `js_params` field, so none of them may
 * decide a release either (review-8 F1, docs/stories/H-72.md). `protect` seals
 * the grant binding — `grantId`, `owner`, `expiresBlock`, `ref` — inside the
 * Lit ciphertext, next to the share. `release` decrypts first, reads the
 * binding back out of the ciphertext, and checks Arkiv for exactly that
 * grant. A caller who kept a link and writes their own live Arkiv entity gets
 * nothing: the ciphertext still names the original grant, and that grant is
 * gone. Caller-supplied binding fields and `commitment` are still accepted,
 * so the adapter's request shape is unchanged, but they can only cause a
 * refusal: any that disagree with the sealed binding are refused. A
 * ciphertext protected before bindings were sealed carries none and is
 * refused outright.
 */

// Must equal lib/arkiv.ts's resolveConditionEndpoint() default, which is
// NEXT_PUBLIC_ARKIV_RPC / ARKIV_CHAIN.rpcUrls.default.http[0] — see
// .env.example. Keep in sync by hand; there is no shared import to enforce it.
const ARKIV_RPC_ENDPOINT = "https://rpc.tiramisu.db-chain.testnet.arkiv.network"
const ARKIV_APP = "healthsend"
const ARKIV_KIND = "grant"

/** The version of the `{ v, binding, payload }` plaintext `protect` seals. */
const SEALED_VERSION = 1

// Mirror lib/grant-package.ts's validateBinding, lowercased. Every value
// rendered into the Arkiv clause below has passed one of these first.
const GRANT_ID_PATTERN = /^0x[0-9a-f]{64}$/
const OWNER_PATTERN = /^0x[0-9a-f]{40}$/
const EXPIRES_BLOCK_PATTERN = /^[1-9][0-9]*$/
const REF_PATTERN = /^[0-9a-f]{64}$/

/** A canonical, validated binding, or `null` for anything malformed. */
function normaliseBinding(grantId, owner, expiresBlock, ref) {
  if (typeof grantId !== "string" || typeof owner !== "string" || typeof expiresBlock !== "string" || typeof ref !== "string") {
    return null
  }
  const binding = { grantId: grantId.toLowerCase(), owner: owner.toLowerCase(), expiresBlock, ref: ref.toLowerCase() }
  if (
    !GRANT_ID_PATTERN.test(binding.grantId) ||
    !OWNER_PATTERN.test(binding.owner) ||
    !EXPIRES_BLOCK_PATTERN.test(binding.expiresBlock) ||
    !REF_PATTERN.test(binding.ref)
  ) {
    return null
  }
  return binding
}

/** Mirrors lib/crypto.ts's encodeGrantBinding. Keep the two in sync by hand. */
function encodeGrantBindingBytes(binding) {
  const canonical = [
    "healthsend",
    "grant-binding",
    "v1",
    binding.grantId,
    binding.owner,
    binding.expiresBlock,
    binding.ref,
  ].join("\n")
  return new TextEncoder().encode(canonical)
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")
}

function hexToBytes(hex) {
  if (typeof hex !== "string" || !/^0x([0-9a-fA-F]{2})*$/.test(hex)) throw new Error("not 0x-prefixed hex data")
  const out = new Uint8Array((hex.length - 2) / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(2 + i * 2, 4 + i * 2), 16)
  return out
}

/**
 * Mirrors lib/arkiv.ts's buildArkivGrantQuery, current-state only — never
 * atBlock, for the same reason that file gives: a historical read must never
 * be able to satisfy this condition. `addr(...)` is rendered all-lowercase
 * deliberately: the SDK's own `addr()` parser accepts all-lowercase input
 * "as-is" with no checksum required (`src/attr/values.ts`), so this avoids
 * needing an EIP-55 checksum implementation inside the action.
 */
function buildArkivClause(binding) {
  return (
    `app = str('${ARKIV_APP}') AND kind = str('${ARKIV_KIND}') AND ` +
    `grant_id = bytes32(${binding.grantId}) AND ` +
    `$owner = addr(${binding.owner}) AND ` +
    `$expiresAt = u64(${binding.expiresBlock})`
  )
}

/**
 * Whether Arkiv's current state holds exactly the grant a sealed binding
 * names: the clause pins `grant_id`, `$owner` and `$expiresAt`, and the
 * returned entity's owner, expiry and payload `ref` are checked again here.
 * `ref` is not an Arkiv attribute on a grant (`lib/arkiv.ts`'s
 * `createThresholdGrant`), so it is read from the entity's payload.
 */
async function sealedGrantIsLive(binding) {
  const request = {
    jsonrpc: "2.0",
    id: 1,
    method: "arkiv_query",
    params: [buildArkivClause(binding), { select: { owner: true, expiresAt: true, payload: true }, limit: "0x1" }],
  }
  const res = await fetch(ARKIV_RPC_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  })
  if (!res.ok) throw new Error(`Arkiv query failed: HTTP ${res.status}`)
  const json = await res.json()
  if (json && json.error) throw new Error(`Arkiv query failed: ${json.error.message}`)
  const entity = json && json.result && Array.isArray(json.result.data) ? json.result.data[0] : undefined
  if (!entity) return { live: false, reason: "grant is not live" }
  if (typeof entity.owner !== "string" || entity.owner.toLowerCase() !== binding.owner) {
    return { live: false, reason: "grant is not live" }
  }
  if (typeof entity.expiresAt !== "string" || BigInt(entity.expiresAt).toString(10) !== binding.expiresBlock) {
    return { live: false, reason: "grant is not live" }
  }
  let grantPayload
  try {
    grantPayload = JSON.parse(new TextDecoder().decode(hexToBytes(entity.payload)))
  } catch {
    return { live: false, reason: "grant payload is unreadable" }
  }
  if (!grantPayload || typeof grantPayload.ref !== "string" || grantPayload.ref.toLowerCase() !== binding.ref) {
    return { live: false, reason: "grant payload names a different ref than the sealed binding" }
  }
  return { live: true }
}

/** The sealed `{ binding, payload }`, or `null` when the plaintext carries no valid sealed binding. */
function parseSealed(plaintext) {
  let parsed
  try {
    parsed = JSON.parse(plaintext)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== "object" || parsed.v !== SEALED_VERSION || typeof parsed.payload !== "string") return null
  if (!parsed.binding || typeof parsed.binding !== "object") return null
  const binding = normaliseBinding(parsed.binding.grantId, parsed.binding.owner, parsed.binding.expiresBlock, parsed.binding.ref)
  return binding ? { binding, payload: parsed.payload } : null
}

function refuse(error) {
  return { authorized: false, error }
}

async function protectSealed({ pkpId, commitment, grantId, owner, expiresBlock, ref, payload }) {
  const binding = normaliseBinding(grantId, owner, expiresBlock, ref)
  if (!binding) return refuse("grant binding is malformed")
  if (typeof payload !== "string") return refuse("payload must be a string")
  if ((await sha256Hex(encodeGrantBindingBytes(binding))) !== commitment) {
    return refuse("commitment does not match the supplied grant binding")
  }
  const message = JSON.stringify({ v: SEALED_VERSION, binding, payload })
  const encryptedCiphertext = await Lit.Actions.Encrypt({ pkpId, message })
  return { authorized: true, result: encryptedCiphertext }
}

async function releaseSealed({ pkpId, commitment, grantId, owner, expiresBlock, ref, ciphertext }) {
  if (typeof ciphertext !== "string" || ciphertext.length === 0) return refuse("ciphertext is missing")

  // Decrypt first: the binding that decides this release is the one sealed
  // inside the ciphertext. The plaintext never leaves this function unless
  // the liveness check below passes.
  const sealed = parseSealed(await Lit.Actions.Decrypt({ pkpId, ciphertext }))
  if (!sealed) {
    return refuse("ciphertext carries no sealed grant binding (protected before bindings were sealed) — refused")
  }
  const binding = sealed.binding

  // Caller-supplied fields never decide anything. Any that are present must
  // agree with the sealed binding, or the request is refused.
  if (
    (grantId !== undefined && String(grantId).toLowerCase() !== binding.grantId) ||
    (owner !== undefined && String(owner).toLowerCase() !== binding.owner) ||
    (expiresBlock !== undefined && String(expiresBlock) !== binding.expiresBlock) ||
    (ref !== undefined && String(ref).toLowerCase() !== binding.ref)
  ) {
    return refuse("supplied grant binding does not match the binding sealed in the ciphertext")
  }
  if (commitment !== undefined && commitment !== (await sha256Hex(encodeGrantBindingBytes(binding)))) {
    return refuse("supplied commitment does not match the binding sealed in the ciphertext")
  }

  const liveness = await sealedGrantIsLive(binding)
  if (!liveness.live) return refuse(liveness.reason)

  return { authorized: true, result: sealed.payload }
}

/**
 * `js_params` supplied by `chipotle.ts` (see `protectShare`/`releaseShare`)
 * arrive as this function's single argument: `pkpId`, `mode`, `commitment`,
 * `grantId`, `owner`, `expiresBlock` (decimal string), `ref`, and either
 * `payload` (protect, a string to encrypt) or `ciphertext` (release, the
 * string `Lit.Actions.Encrypt` returned earlier). The returned object
 * becomes the caller's `LitActionResponse.response` — see the module doc.
 * Never logs or returns the share outside `result`; on any refusal, `result`
 * is simply absent.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Lit's runtime calls this global by name; nothing in this file calls it.
async function main(params) {
  try {
    if (params.mode === "protect") return await protectSealed(params)
    if (params.mode === "release") return await releaseSealed(params)
    return refuse(`unknown mode "${params.mode}"`)
  } catch (error) {
    return refuse(error instanceof Error ? error.message : String(error))
  }
}
