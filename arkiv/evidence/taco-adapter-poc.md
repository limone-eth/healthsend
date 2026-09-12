# H-52 — TACo adapter live probe

This records one run of `pnpm verify:taco-adapter-live`, the opt-in,
non-destructive probe of live TACo infrastructure that backs
`lib/key-release/taco.ts`. It is adapter-scoped evidence, not the full
asset/grant demo: no Swarm upload, no Arkiv write, no real held share. That
fuller demo lands with asset/grant issuance (H-53/H-54) and will get its own
evidence file.

**Command:** `RUN_TACO_LIVE_PROBE=1 pnpm verify:taco-adapter-live`
**Date:** 2026-09-12 (UTC)
**Package versions:** `@nucypher/taco@0.6.0`, `ethers@5.7.2` (pinned, per the
TACo PoC plan's Global Constraints)
**Domain / ritual:** `lynx` / ritual id `27`
**Coordination RPC:** `https://polygon-amoy.drpc.org`

## What the probe does

1. `initialize()` the SDK.
2. Confirm the coordination RPC answers (`eth_chainId`).
3. Build the exact `arkiv_query` `JsonRpcCondition` `buildArkivGrantQuery`
   produces (Task 2 / H-51), bound to a **fabricated** grant id that cannot
   exist in Arkiv, and encrypt a disposable 32-byte share under it. A
   success here proves DKG ritual 27 is active and resolvable on-chain.
4. Resolve the Porter cohort's configured URI list. This step only resolves
   strings — a hardcoded default plus an optional static-config fetch — it
   never contacts a node, so it is not by itself evidence of reachability.
5. Attempt `decrypt()` against the message kit from step 3. Because the
   condition names a grant Arkiv has no record of, a correctly-behaving
   cohort must refuse. The script only accepts this as a genuine refusal
   when the rejection does **not** carry a network-failure signature
   (`ENOTFOUND`, `ECONNREFUSED`, `ECONNRESET`, `ETIMEDOUT`, `EAI_AGAIN`) —
   otherwise it is classified as an infrastructure block, because
   `@nucypher/taco` aggregates per-node network errors and per-node
   condition-refusals into the same message shape (see
   `ERR_DECRYPTION_FAILED` in the SDK's `tdec.js`), so the two cannot be told
   apart from the message text alone once a real node has actually answered.

## Observed stages

```
stage 1/5  initialize — ok
stage 2/5  coordination RPC reachable — chainId 80002
stage 3/5  ritual 27 resolved — disposable share encrypted under a real Arkiv-shaped condition (873 bytes)
stage 4/5  Porter URI list resolved — 1 URI(s) (not yet contacted)

BLOCKED at stage "porter": getaddrinfo ENOTFOUND porter-lynx.nucypher.io
```

**Classification: BLOCKED**, at the Porter stage, exit code 3.

## What this shows, honestly

- The Polygon Amoy coordination chain and DKG ritual 27 **are** currently
  reachable and active: encryption against the ritual's real public key
  succeeded. This is a narrower, more specific claim than "TACo works" — it
  is on-chain coordination state, not the off-chain decryption cohort.
- The configured Porter host, `porter-lynx.nucypher.io`, does not resolve in
  DNS at all. No node was contacted, so this run gives no signal — positive
  or negative — about condition evaluation, threshold behavior, or release
  correctness. It is an infrastructure block, exactly the outcome the TACo
  PoC plan's Global Constraints call the current expected case ("no
  supporting mainnet infrastructure... testnets explicitly unsupported").
- No `NEXT_PUBLIC_TACO_PORTER_URIS` override was attempted: no other
  known-good Lynx Porter host is documented anywhere this session could
  verify, so trying alternates would have been guessing at URLs, which this
  session does not do.
- This run is **not** a live threshold-release proof: it never reaches the
  point of testing whether a live, real grant releases correctly, only
  whether an absent one is correctly refused — and even that refusal could
  not be confirmed as genuine rather than a network failure. A green run
  that never reached a Porter node proves nothing about release itself; see
  H-34.

## Reproduce

```bash
RUN_TACO_LIVE_PROBE=1 pnpm verify:taco-adapter-live
```

Exit code `3` on `BLOCKED`, `0` on `LIVE` (a genuine refusal reached at
least one node), `1` on `FAILED` (infrastructure responded but the adapter's
fail-closed contract was violated — e.g. the cohort released for a grant
Arkiv has no record of), `2` when the run is skipped (missing
`RUN_TACO_LIVE_PROBE=1`, or misconfigured).
