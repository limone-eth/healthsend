/**
 * The immutable Lit Action that gates release of a Chipotle-protected key
 * share. This is the ONLY action that may be authorized to use its PKP —
 * `lib/key-release/chipotle.ts`'s `ensureSingleAuthorizedAction` refuses to
 * operate if a second, more permissive action is ever found authorized
 * against the same PKP (see that file's module doc). Once published to IPFS
 * and pinned, this source must never change: a mutable action would let
 * whoever controls the pin rewrite the release rule for every share already
 * protected under it.
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
 * once its CID and a usage key are known) could point "Arkiv" at a server
 * they control that always answers "still live" and defeat every property
 * below it. The same reasoning is why `grantId`/`owner`/`expiresBlock` are
 * cross-checked against `commitment` before this action ever queries Arkiv:
 * `chipotle.ts`'s own commitment check (`releaseShare`, "refusing a
 * substituted grant") is not a trust boundary by itself, because it is
 * bypassable the same way. This action re-does that check because it is the
 * one place a bypass cannot skip it.
 */

// Must equal lib/arkiv.ts's resolveConditionEndpoint() default, which is
// NEXT_PUBLIC_ARKIV_RPC / ARKIV_CHAIN.rpcUrls.default.http[0] — see
// .env.example. Keep in sync by hand; there is no shared import to enforce it.
const ARKIV_RPC_ENDPOINT = "https://rpc.tiramisu.db-chain.testnet.arkiv.network"
const ARKIV_APP = "healthsend"
const ARKIV_KIND = "grant"

function bytesToBase64(bytes) {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function base64ToBytes(value) {
  const binary = atob(value)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

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

function respond(authorized, extra) {
  Lit.Actions.setResponse({ response: JSON.stringify(Object.assign({ authorized }, extra || {})) })
}

/**
 * jsParams supplied by `chipotle.ts` (see `protectShare`/`releaseShare`)
 * arrive as bare globals in this scope: `mode`, `commitment`, `grantId`,
 * `owner`, `expiresBlock` (decimal string), `ref`, and either `payload`
 * (protect, base64) or `ciphertext` (release, base64).
 */
const go = async () => {
  try {
    if (mode !== "protect" && mode !== "release") {
      respond(false, { error: `unknown mode "${mode}"` })
      return
    }

    // The commitment check runs for both modes, and before anything else:
    // it is what stops a caller from pairing this ciphertext with a
    // different grantId/owner/expiresBlock than it was protected for. See
    // the module doc.
    const expectedCommitment = await sha256Hex(encodeGrantBindingBytes(grantId, owner, expiresBlock, ref))
    if (expectedCommitment !== commitment) {
      respond(false, { error: "commitment does not match the supplied grant binding" })
      return
    }

    if (mode === "release") {
      const live = await grantIsLive(grantId, owner, expiresBlock)
      if (!live) {
        respond(false, { error: "grant is not live" })
        return
      }
    }

    // --- The one step this file cannot verify without live Lit docs access ---
    //
    // Chipotle derives its encryption key from this PKP inside a TEE — see
    // docs/stories/H-65.md, "The trust model, stated honestly". The actual
    // Lit Actions primitive for "encrypt under this PKP's TEE key" /
    // "decrypt with this PKP's TEE key" could not be confirmed against
    // developer.litprotocol.com/lit-actions/migration/encryption in this
    // session — it had no network access to check current docs, and this
    // repo's own rules refuse to guess an API surface rather than a URL.
    // `chipotleTeeEncrypt`/`chipotleTeeDecrypt` name the operation this
    // action needs; they are not verified Lit Actions API calls. An operator
    // publishing this action for real must replace both with the confirmed
    // primitive first. See arkiv/evidence/chipotle-adapter-poc.md, "What
    // this does not prove."
    const outputBytes =
      mode === "protect"
        ? await chipotleTeeEncrypt(base64ToBytes(payload))
        : await chipotleTeeDecrypt(base64ToBytes(ciphertext))

    respond(true, { result: bytesToBase64(outputBytes) })
  } catch (error) {
    respond(false, { error: error instanceof Error ? error.message : String(error) })
  }
}

go()
