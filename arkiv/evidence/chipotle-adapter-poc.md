# H-65 — Lit Chipotle adapter live probe and offline proof

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

## Live probe

**Command:** `RUN_CHIPOTLE_LIVE_PROBE=1 pnpm verify:chipotle-adapter-live`
**Date:** 2026-09-12 (UTC)

### What the probe does

1. Checks that `NEXT_PUBLIC_CHIPOTLE_ENDPOINT`, `NEXT_PUBLIC_CHIPOTLE_ACTION_CID`,
   `NEXT_PUBLIC_CHIPOTLE_PKP_PUBLIC_KEY`, and `NEXT_PUBLIC_CHIPOTLE_USAGE_API_KEY`
   are all set. Chipotle needs an account, a published action, and a usage
   key before any network call can mean anything — see "Credentials" below.
2. Resolves the endpoint's hostname in DNS.
3. Confirms the endpoint answers HTTP at all (any response, including an
   error status, counts — only a transport-level failure does not).
4. Confirms the configured PKP authorizes **exactly one** action, matching
   the configured action CID. A second, more permissive action on the same
   PKP would bypass this adapter's gate entirely — see
   `lib/key-release/chipotle.ts`'s module doc.
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
Chipotle adapter live probe — 2026-09-12T20:30:23.996Z
Writes nothing to Arkiv. All inputs below are disposable.

BLOCKED at stage "credentials": Chipotle needs an account, a published action, and a usage key.
Missing: NEXT_PUBLIC_CHIPOTLE_ENDPOINT, NEXT_PUBLIC_CHIPOTLE_ACTION_CID,
NEXT_PUBLIC_CHIPOTLE_PKP_PUBLIC_KEY, NEXT_PUBLIC_CHIPOTLE_USAGE_API_KEY.
Create them at developer.litprotocol.com, then set these environment variables.
```

**Classification: BLOCKED**, at stage `"credentials"`, exit code 3.

This is the outcome `docs/stories/H-65.md`'s "Credentials" section
anticipates: a worker cannot create a Lit account, mint a usage key, or
publish the immutable Lit Action this adapter needs. No further stage could
honestly be attempted without one — endpoint, action CID, and PKP are all
things an account produces, so there was no real hostname to resolve.

**Mechanical check, separate from the real outcome above:** to confirm the
staging logic itself actually exercises the network rather than short-circuiting,
the same probe was also run once against a live-but-wrong HTTPS endpoint
(`https://example.com`, with fabricated action/PKP/usage values):

```
stage 1/5  credentials configured — endpoint, action CID, PKP, and usage key are all set
stage 2/5  endpoint resolves — example.com -> 104.20.23.154
stage 3/5  endpoint answers HTTP — https://example.com

BLOCKED at stage "single-action": Chipotle rejected the authorized-actions lookup: HTTP 404
```

This confirms stages 2 and 3 make a real DNS lookup and a real HTTP request
(`example.com` is not Chipotle and correctly fails once the probe asks it
something only a real Chipotle endpoint could answer). It is not evidence
about Chipotle itself and is not the recorded outcome for this story — the
credentials-blocked run above is.

### What this shows, honestly

- No claim is made here about Chipotle's actual infrastructure, encryption
  model, or enclave attestation being reachable, because this session never
  got past the point of needing an account to find out.
- The wire format `lib/key-release/chipotle.ts`'s `createHttpChipotleClient`
  speaks (a POST per action invocation, a GET for authorized-actions lookup,
  bearer-token auth) is this adapter's own placeholder for what the research
  (`docs/research/threshold-expiry-alternatives.md`) describes only as
  "plain HTTP invocation" — this session had no network access to confirm
  the current request/response schema against `developer.litprotocol.com`.
  An operator setting up real credentials should expect to need to adjust
  this client to match Chipotle's actual API before the probe can progress
  past `"credentials"`.
- The Lit Action source (`lib/key-release/chipotle-action.js`) names the
  primitive it needs for "encrypt/decrypt under the PKP's TEE key" as
  `chipotleTeeEncrypt`/`chipotleTeeDecrypt` — these are **not** verified Lit
  Actions API calls. The exact primitive
  `developer.litprotocol.com/lit-actions/migration/encryption` documents
  could not be confirmed without network access in this session. Replace
  both before publishing the action for real use.
- The Arkiv liveness check inside that same action (`grantIsLive`,
  `buildArkivClause`) **is** verified: its query grammar is copied
  byte-for-byte from `@arkiv-network/sdk`'s own `render()`
  (`node_modules/@arkiv-network/sdk/src/query/expression.ts`), not
  approximated, and its endpoint matches `lib/arkiv.ts`'s resolved default.
- **Credentials to create**, so an operator can re-run this probe to a real
  conclusion: a Lit Chipotle account, a PKP restricted to exactly one
  authorized action (the published CID of `chipotle-action.js`), and a
  usage API key scoped to that PKP — never the account's master key. Set:
  - `NEXT_PUBLIC_CHIPOTLE_ENDPOINT`
  - `NEXT_PUBLIC_CHIPOTLE_ACTION_CID`
  - `NEXT_PUBLIC_CHIPOTLE_PKP_PUBLIC_KEY`
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
logic (`chipotle-action.js`'s commitment check and Arkiv liveness check).
Every property was confirmed red before its guard existed — the exact guard
in `lib/key-release/chipotle.ts` and the observed failure are recorded here,
not just the passing run.

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

**Only one action may use the PKP.** Guard: `ensureSingleAuthorizedAction`,
called from both `protectShare` and `releaseShare`. With that call removed
from `protectShare`, the proof failed:

```
AssertionError [ERR_ASSERTION]: The expression evaluated to a falsy value:
  assert.ok(caught instanceof ChipotleUnavailableError)
```

Restored, it passes: "a second authorized action on the same PKP is detected
and refused before any invocation," with zero `invokeAction` calls made.

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
PASS  a second authorized action on the same PKP is detected and refused before any invocation
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
