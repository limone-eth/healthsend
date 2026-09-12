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
 * `chipotle.ts`'s `invokeAction` calls this action by **`ipfs_id`**, never
 * `code`, and passes `js_params` as this function's single argument.
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
 * `ARKIV_RPC_ENDPOINT` is hardcoded, not taken from `jsParams`, and this is
 * the single most important line in this file: if the endpoint were caller
 * supplied, anyone who could invoke this action directly (bypassing
 * `chipotle.ts` entirely — nothing stops that, since the action is public
 * once its `ipfs_id` and a usage key are known) could point "Arkiv" at a
 * server they control that always answers "still live" and defeat every
 * property below it. The same reasoning is why `grantId`/`owner`/
 * `expiresBlock` are cross-checked against `commitment` before this action
 * ever queries Arkiv: `chipotle.ts`'s own commitment check (`releaseShare`,
 * "refusing a substituted grant") is not a trust boundary by itself, because
 * it is bypassable the same way. This action re-does that check because it
 * is the one place a bypass cannot skip it.
 */

// Must equal lib/arkiv.ts's resolveConditionEndpoint() default, which is
// NEXT_PUBLIC_ARKIV_RPC / ARKIV_CHAIN.rpcUrls.default.http[0] — see
// .env.example. Keep in sync by hand; there is no shared import to enforce it.
const ARKIV_RPC_ENDPOINT = "https://rpc.tiramisu.db-chain.testnet.arkiv.network"
const ARKIV_APP = "healthsend"
const ARKIV_KIND = "grant"

/** Mirrors lib/crypto.ts's encodeGrantBinding. Keep the two in sync by hand. */
function encodeGrantBindingBytes(grantIdHex, ownerHex, expiresBlockDecimalString, refHex) {
  const canonical = [
    "healthsend",
    "grant-binding",
    "v1",
    grantIdHex.toLowerCase(),
    ownerHex.toLowerCase(),
    expiresBlockDecimalString,
    refHex.toLowerCase(),
  ].join("\n")
  return new TextEncoder().encode(canonical)
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")
}

/**
 * Mirrors lib/arkiv.ts's buildArkivGrantQuery, current-state only — never
 * atBlock, for the same reason that file gives: a historical read must never
 * be able to satisfy this condition. `addr(...)` is rendered all-lowercase
 * deliberately: the SDK's own `addr()` parser accepts all-lowercase input
 * "as-is" with no checksum required (`src/attr/values.ts`), so this avoids
 * needing an EIP-55 checksum implementation inside the action.
 */
function buildArkivClause(grantIdHex, ownerHex, expiresBlockDecimalString) {
  return (
    `app = str('${ARKIV_APP}') AND kind = str('${ARKIV_KIND}') AND ` +
    `grant_id = bytes32(${grantIdHex.toLowerCase()}) AND ` +
    `$owner = addr(${ownerHex.toLowerCase()}) AND ` +
    `$expiresAt = u64(${expiresBlockDecimalString})`
  )
}

async function grantIsLive(grantIdHex, ownerHex, expiresBlockDecimalString) {
  const clause = buildArkivClause(grantIdHex, ownerHex, expiresBlockDecimalString)
  const request = {
    jsonrpc: "2.0",
    id: 1,
    method: "arkiv_query",
    params: [clause, { select: { owner: true }, limit: "0x1" }],
  }
  const res = await fetch(ARKIV_RPC_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  })
  if (!res.ok) throw new Error(`Arkiv query failed: HTTP ${res.status}`)
  const json = await res.json()
  const returnedOwner = json && json.result && json.result.data && json.result.data[0] && json.result.data[0].owner
  return typeof returnedOwner === "string" && returnedOwner.toLowerCase() === ownerHex.toLowerCase()
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
async function main({ pkpId, mode, commitment, grantId, owner, expiresBlock, ref, payload, ciphertext }) {
  try {
    if (mode !== "protect" && mode !== "release") {
      return { authorized: false, error: `unknown mode "${mode}"` }
    }

    // The commitment check runs for both modes, and before anything else:
    // it is what stops a caller from pairing this ciphertext with a
    // different grantId/owner/expiresBlock than it was protected for. See
    // the module doc.
    const expectedCommitment = await sha256Hex(encodeGrantBindingBytes(grantId, owner, expiresBlock, ref))
    if (expectedCommitment !== commitment) {
      return { authorized: false, error: "commitment does not match the supplied grant binding" }
    }

    if (mode === "release") {
      const live = await grantIsLive(grantId, owner, expiresBlock)
      if (!live) {
        return { authorized: false, error: "grant is not live" }
      }
    }

    if (mode === "protect") {
      const encryptedCiphertext = await Lit.Actions.Encrypt({ pkpId, message: payload })
      return { authorized: true, result: encryptedCiphertext }
    }

    const plaintext = await Lit.Actions.Decrypt({ pkpId, ciphertext })
    return { authorized: true, result: plaintext }
  } catch (error) {
    return { authorized: false, error: error instanceof Error ? error.message : String(error) }
  }
}
