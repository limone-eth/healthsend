# H-65/H-67 — Lit Chipotle adapter live probe and offline proof

This records the outcome of `pnpm verify:chipotle-adapter-live`, the opt-in,
non-destructive live probe backing `lib/key-release/chipotle.ts`, and of
`pnpm verify:chipotle-adapter`, the offline proof against an injected fake
client. It is adapter-scoped evidence, like H-52's TACo equivalent
(`arkiv/evidence/taco-adapter-poc.md`): no Swarm upload, no Arkiv write, no
real held share, and — per this story's operator decision — no wiring into
the send/open path. That follows H-53's asset/grant split as a separate
story.

**The trust model, stated honestly:** Chipotle derives its encryption key
from a PKP inside a TEE — one enclave, attested by Lit, not a quorum of
independent operators voting on a threshold. Everything below describes an
enclave service, never a "decentralised", "trustless", or threshold system.

**H-67 update (2026-09-12):** H-65's HTTP client and Lit Action were
placeholders, built with no network access, and said so. This story rewrites
both against Lit's documented API, verified against
`https://api.chipotle.litprotocol.com/core/v1/openapi.json` and
`developer.litprotocol.com` (see `docs/stories/H-67.md` for the row-by-row
table). The sections below describe the **current, real-API** adapter; the
H-65 placeholder wire format it replaced is no longer in the codebase.

## What changed from H-65's placeholder

- **Base URL** is now the fixed, real `https://api.chipotle.litprotocol.com/core/v1`
  (`lib/key-release/chipotle.ts`'s `CHIPOTLE_API_BASE`), not an env var — Lit
  runs one Chipotle service, so there is nothing to override.
  `NEXT_PUBLIC_CHIPOTLE_ENDPOINT` is removed from `.env.example`.
- **Action invocation** is `POST /lit_action` with `{"ipfs_id": <cid>, "js_params": {...}}`
  — `code` only for the cache-miss retry H-69 added. Which code a usage key may
  run is Lit's rule, not verified by this app (review-8 F2, H-72). Auth is the
  `X-Api-Key` header.
- **The usage key ships to browsers** (`NEXT_PUBLIC_CHIPOTLE_USAGE_API_KEY`), so
  the account's safety depends on that key's scopes being execute-only for
  group 1.
- **Env vars renamed/added.** `NEXT_PUBLIC_CHIPOTLE_PKP_PUBLIC_KEY` is now
  `NEXT_PUBLIC_CHIPOTLE_PKP_ID`, matching `GET /list_wallets`' `id` field. A
  new `NEXT_PUBLIC_CHIPOTLE_GROUP_ID` was added — matching `GET /list_groups`'
  `id` field — because Lit's group-scoped permission model
  (`developer.litprotocol.com/architecture/groups`) needs it to check the
  single-action guarantee against real data (see below). This var was not
  named in the story's table; see this story's report, "Choices".
- **The single-action check now reads real group data.**
  `ensureSingleAuthorizedAction` calls `GET /list_actions?group_id=` and
  `GET /list_wallets_in_group?group_id=`, and fails closed if: the configured
  PKP is not a member of the group; the group permits more than one action;
  or the group permits *all* actions via the documented `0` wildcard in
  `cid_hashes_permitted` (`developer.litprotocol.com/architecture/groups`,
  "To permit all actions, include 0"). `list_actions` returns the **keccak256
  hash** of each permitted CID, not the raw CID
  (`developer.litprotocol.com/management/api_direct`, "Raw CID vs hashed
  CID"), so the adapter hashes its own configured `actionCid` the same way
  (`hashActionCid`, using `viem`'s `keccak256`/`stringToBytes`) to compare.
- **The Lit Action rewrite.** `chipotle-action.js` now defines
  `async function main({ pkpId, mode, ... })` that returns a value directly —
  Lit's current entry point convention
  (`developer.litprotocol.com/lit-actions/migration/changes`, "Breaking
  Change: Action Entry Point and Response") — instead of the old
  `(async () => {...})()` plus `Lit.Actions.setResponse`. Encryption/
  decryption now call the confirmed primitives `Lit.Actions.Encrypt({ pkpId,
  message })` and `Lit.Actions.Decrypt({ pkpId, ciphertext })` (both
  `Promise<string>`), replacing H-65's placeholder
  `chipotleTeeEncrypt`/`chipotleTeeDecrypt` names. The commitment check and
  Arkiv liveness check (`grantIsLive`, `buildArkivClause`) are unchanged —
  those were already verified against `@arkiv-network/sdk`'s own grammar.
- **A new script, `pnpm chipotle:print-cid`**
  (`scripts/chipotle-print-action-cid.mjs`), computes the action's real CID
  via `POST /get_lit_action_ipfs_id` and prints the two operator-run calls
  (`add_action`, `add_action_to_group`) that register it. It never calls
  those endpoints itself — they need the account key, which this repo's app
  and scripts never read.

## Live probe

**Command:** `RUN_CHIPOTLE_LIVE_PROBE=1 pnpm verify:chipotle-adapter-live`
**Date:** 2026-09-12 (UTC)

### What the probe does

1. Checks that `NEXT_PUBLIC_CHIPOTLE_ACTION_CID`, `NEXT_PUBLIC_CHIPOTLE_PKP_ID`,
   `NEXT_PUBLIC_CHIPOTLE_GROUP_ID`, and `NEXT_PUBLIC_CHIPOTLE_USAGE_API_KEY`
   are all set. Chipotle needs an account, a group, a published action, and a
   usage key before any network call can mean anything — see "Credentials"
   below.
2. Resolves `api.chipotle.litprotocol.com` in DNS.
3. Confirms `GET /version` answers HTTP (no auth needed).
4. Confirms the configured group permits **exactly one** action, matching
   the configured CID's hash, and that the configured PKP is a member of
   that group. A second, more permissive action on the same group — or a
   `0`-wildcard "permit all actions" entry — would bypass this adapter's gate
   entirely.
5. Invokes that action in `"release"` mode for a **fabricated** grant
   binding — a random grant id, owner, and expiry that cannot exist in
   Arkiv, wrapped in a correctly-computed commitment so the request passes
   this adapter's own client-side check and actually reaches the network. A
   correctly-behaving enclave must refuse. The script only accepts this as a
   genuine refusal when the response does not carry a network-failure
   signature (`ENOTFOUND`, `ECONNREFUSED`, `ECONNRESET`, `ETIMEDOUT`,
   `EAI_AGAIN`, `fetch failed`) — otherwise it is classified as an
   infrastructure block, exactly the refusal-vs-network-failure ambiguity
   `scripts/taco-adapter-live-probe.mjs` has to reason about for Porter.

### Observed stages

```
Chipotle adapter live probe — 2026-09-12T20:58:43.408Z
Base URL: https://api.chipotle.litprotocol.com/core/v1
Writes nothing to Arkiv. All inputs below are disposable.

BLOCKED at stage "credentials": Chipotle needs an account, a published action, a group, and a usage key.
Missing: NEXT_PUBLIC_CHIPOTLE_ACTION_CID, NEXT_PUBLIC_CHIPOTLE_PKP_ID, NEXT_PUBLIC_CHIPOTLE_GROUP_ID,
NEXT_PUBLIC_CHIPOTLE_USAGE_API_KEY. Create them at developer.litprotocol.com, then set these environment
variables.
```

**Classification: BLOCKED**, at stage `"credentials"`, exit code 3.

This worker's environment carries no `.env.local` and cannot read one if it
existed (see `docs/stories/H-67.md`, "Credentials" — this is the operator's
step). No further stage could honestly be attempted without those four
values — action CID, PKP ID, group ID, and usage key are all things the
operator's Lit account and this adapter's registered action produce.

**Mechanical check, separate from the real outcome above:** to confirm the
staging logic itself exercises the real network rather than short-circuiting,
the same probe was run twice more against the real base URL with fabricated
action/PKP/group/usage-key values:

```
stage 1/5  credentials configured — action CID, PKP, group, and usage key are all set
stage 2/5  endpoint resolves — api.chipotle.litprotocol.com -> 66.220.6.104
stage 3/5  endpoint answers HTTP — https://api.chipotle.litprotocol.com/core/v1

BLOCKED at stage "single-action": Chipotle /list_actions?group_id=999999&page_number=0&page_size=100 failed:
HTTP 500 list_actions failed: server returned an error response: error code 3: execution reverted, data:
"0xd4a84737132da1132de073055d34f47b729e08bde5fddd8f0a8cf2ad7d01879893d71cbd"
```

The same result was observed for `group_id=1` with the same fabricated usage
key. This confirms stages 2 and 3 make a real DNS lookup and a real HTTP
request, and that stage 4 reaches Lit's real chain-secured backend — a
fabricated usage key produces a genuine on-chain-execution revert, not a
generic "not found." `GET /version` was independently confirmed live via
`curl`:

```
$ curl -s https://api.chipotle.litprotocol.com/core/v1/version
{"name":"lit-api-server","version":"0.1.0","commit_version":"v1.1.10","submodule_versions":[]}
```

None of this is evidence about the operator's real account, group, or
action — it is only evidence that this adapter's HTTP client is talking to
the real, live Chipotle service and handling its real response shapes. The
credentials-blocked run above is the recorded outcome for this story.

### What this shows, honestly

- No claim is made here about the operator's actual Chipotle account, PKP,
  group, or action being reachable, because this worker has no credentials
  for them and cannot read `.env.local`.
- The wire format is now Lit's documented one, not a guess: `POST
  /lit_action` with `{ipfs_id, js_params}`, `X-Api-Key` auth, `GET
  /list_actions`/`GET /list_wallets_in_group` for the single-action check
  (returning hashed CIDs, hashed client-side to compare), and
  `Lit.Actions.Encrypt`/`Decrypt` inside the action. Every row was checked
  against the live OpenAPI spec and `developer.litprotocol.com`, not assumed
  — see `docs/stories/H-67.md`.
- **One documented gap remains, by design of Lit's own API, not this
  adapter's choice:** `list_actions` only returns metadata for actions
  actually registered via `add_action`. A group's `0`-wildcard entry in
  `cid_hashes_permitted` has no such registered metadata, so it is not
  guaranteed to appear as a literal `"0"` item in `list_actions`' response —
  there is no documented endpoint that exposes a group's raw
  `cid_hashes_permitted` array directly. `ensureSingleAuthorizedAction`
  checks for a literal zero-valued hash defensively, but this is the one
  property this adapter cannot fully verify from outside Lit's own contract
  state with the read endpoints Lit documents. Operators must never add `0`
  to `cid_hashes_permitted` for this group (per
  `developer.litprotocol.com/architecture/groups`). See this story's report,
  "Choices", for the full reasoning.
- **Credentials to create**, so an operator can re-run this probe to a real
  conclusion: a Lit Chipotle account, a PKP, a group containing that PKP and
  permitting exactly one action (the published CID of `chipotle-action.js`,
  registered via `pnpm chipotle:print-cid` plus the operator's own
  `add_action`/`add_action_to_group` calls), and a usage API key scoped to
  that group — never the account's master key. Set:
  - `NEXT_PUBLIC_CHIPOTLE_ACTION_CID`
  - `NEXT_PUBLIC_CHIPOTLE_PKP_ID`
  - `NEXT_PUBLIC_CHIPOTLE_GROUP_ID`
  - `NEXT_PUBLIC_CHIPOTLE_USAGE_API_KEY`
  - `NEXT_PUBLIC_CHIPOTLE_ENABLED=true`

### Reproduce

```bash
RUN_CHIPOTLE_LIVE_PROBE=1 pnpm verify:chipotle-adapter-live
```

Exit code `3` on `BLOCKED`, `0` on `LIVE` (a genuine refusal reached a real
enclave), `1` on `FAILED` (infrastructure responded but the adapter's
fail-closed contract was violated), `2` when skipped (missing
`RUN_CHIPOTLE_LIVE_PROBE=1`).

## Offline proof

**Command:** `pnpm verify:chipotle-adapter`
**Date:** 2026-09-12 (UTC)

Runs `scripts/chipotle-adapter-proof.mjs` against an injected fake
`ChipotleClient` that plays both the HTTP transport and the Lit Action's own
logic (`chipotle-action.js`'s commitment check and Arkiv liveness check),
hashing action CIDs the same way the real `list_actions` does. Every property
was confirmed red before its guard existed — the exact guard in
`lib/key-release/chipotle.ts` and the observed failure are recorded here, not
just the passing run.

### Properties proved, and their red-first evidence

**Binding refuses a substituted grant.** Guard: the commitment check at the
top of `releaseShare` in `lib/key-release/chipotle.ts`. With that check
removed, `pnpm verify:chipotle-adapter` failed:

```
AssertionError [ERR_ASSERTION]: The input did not match the regular expression /substituted grant/. Input:
'commitment does not match the supplied grant binding'
```

(The request still failed — the fake action's own mirrored commitment check
caught it — but the assertion that this must be refused **before any network
call** is exactly what the removed client-side check guaranteed; removing it
changes the observable behavior, which is what this proof pins down.)
Restored, `pnpm verify:chipotle-adapter` passes: "release() refuses a share
substituted onto a different grant, before invoking the action."

**Only one action may be permitted on the PKP's group, real data.** Guard:
`ensureSingleAuthorizedAction`, called from both `protectShare` and
`releaseShare`, now reading `getGroupAuthorization` (mirroring `GET
/list_actions` + `GET /list_wallets_in_group`). With the PKP-membership and
wildcard checks removed, the proof failed:

```
AssertionError [ERR_ASSERTION]: The input did not match the regular expression /wildcard/. Input:

'group 7 permits 1 action(s) (0); expected exactly one, matching the configured action bafyreiabc123realaction
(hash 0x419873c843c9a854ee42bdd0c2a2be13db8dd374eac4d534d0fcb852b9633966)'
```

This shows the wildcard case falling back to the generic "wrong number of
actions" message instead of naming the wildcard specifically — the two
guards are not redundant. Restored, all three single-action properties pass:
a second permitted action, an all-actions `0` wildcard, and a PKP absent from
the group are each detected and refused before any invocation, with zero
`invokeAction` calls made in every case.

**An expired (not-live) grant releases nothing.** Proved directly: a grant
absent from the fake Arkiv ledger — exactly what a pruned or never-created
entity looks like — is refused by the fake action's `grantIsLive` check
(mirroring `chipotle-action.js`), surfaced as `ChipotleUnavailableError`
whose message never contains the held share's hex.

**Nothing persists.** Two concurrent grants, protected and released in
sequence through the same provider instance, never leak each other's held
share — there is no module-level "last share" state to leak from.

### Full run

```
PASS  protect() then release() with the same live binding recovers the original share
PASS  release() refuses a share substituted onto a different grant, before invoking the action
PASS  release() refuses for a grant with no live Arkiv record, and never leaks the share
PASS  a second permitted action on the same group is detected and refused before any invocation
PASS  a group that permits all actions via the 0 wildcard is detected and refused
PASS  a PKP absent from the configured group is detected and refused before any invocation
PASS  the single-action check is cached across protect() and release()
PASS  a missing credential is refused as stage "credentials", never as denial
PASS  a disabled provider refuses both calls without any network activity
PASS  two concurrent grants never leak each other's held share; nothing is cached across calls

All checks passed.
```

### Reproduce

```bash
pnpm verify:chipotle-adapter
```
