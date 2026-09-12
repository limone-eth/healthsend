# Arkiv feedback — HealthSend (ETHRome 2026)

What worked, what got in our way, and what we would change. Each issue says what we expected, what
happened, how to reproduce it and what we did about it.

This file is Arkiv only. The full log, including Swarm ID issues, is [`../friction.md`](../friction.md);
section numbers below point into it.

**Versions:** `@arkiv-network/sdk@0.8.1`, `viem@2.56.3`, Node 24.15.0, Next.js 16.3.4.
**Network:** Tiramisu testnet, chain `7738577`.

## Surfaces we used

| Surface | How we used it | Issues below |
|---|---|---|
| TypeScript SDK | Writes with typed attributes and `atBlock` expiry; the dashboard's compound query; `getEntity` | 1, 2, 5, 7, 9 |
| Direct JSON-RPC | A Lit Action queries Tiramisu's RPC itself (`$owner`, `$expiresAt` predicates); e2e tests mock `arkiv_query` | — (worked) |
| Documentation | SDK README, type docs, network reference, "not a confidentiality layer" | 1, 3, 6, 8 |
| Hub | `hub.arkiv.network/ethrome` | — |
| Faucet | Funding the backend key that tops up per-user keys | 4 |
| Block Explorer | Transaction links in our evidence | 3, 9 |
| Network / RPC | Tiramisu HTTP RPC (no WebSocket) | 7 |

## What worked well

- **Typed attributes with compound filters.** Our dashboard filters on owner, namespace, kind,
  file type and a creation-time range in one query. That is the "index beside the file" role the
  docs describe, and it held up.
- **`ExpirationTime.atBlock` is the right primitive for a promise.** Once we pinned an absolute
  block, expiry happened exactly where we said. Mission 02 was then a before/after query with no
  delete call ([evidence](./evidence/mission-02-expiry.txt)).
- **Meta-predicates `$owner` and `$expiresAt` are powerful.** A third party (a Lit enclave action)
  checks "is this exact grant, by this owner, with this deadline, still live?" with one query and
  no trust in our servers.
- **The docs warned us about confidentiality.** "It is not a confidentiality layer" was correct;
  we just applied it too narrowly (issue 8).
- **Doc comments are unusually honest.** `ValueInput` and `CreateEntityReturnType.expiresAt` both
  state their sharp edges plainly. Our problem was that those sentences live only in type
  definitions (issues 1 and 5).

## Issues

### 1. A query predicate with the wrong type matches nothing, silently — SDK · high

- **Expected:** `eq("sender", me)` finds the entities written with `sender: addr(me)`, or throws.
- **Actual:** a bare string resolves to `str` and a bare bigint to `u256`. Our attributes were `addr`
  and `u64`. The query succeeds and returns `entities: []`, which looks exactly like "no data yet".
  The only warning is in the `ValueInput` type doc; the README's front-page example teaches the bare
  form.
- **Repro:** write an entity with `addr`/`u64` attributes, query with bare values, get zero rows.
- **Workaround:** tag every predicate like the write: `eq("sender", addr(me))`,
  `gte("created_at", u64(n))`.
- **Suggestion:** throw on a type mismatch, or warn in dev mode; at minimum, put the warning beside
  the README example. *(friction.md §1)*

### 2. Attribute-name validation passes names the engine rejects, and the error contradicts itself — SDK · high

- **Expected:** `validateAttributeName` rejects anything the engine will reject, before a
  transaction is sent.
- **Actual:** `createdAt` passes client validation, is sent, and reverts on-chain with
  `Ident32InvalidByte`. The decoded message says the charset includes `"A"-"Z"`, then rejects `"A"`
  at byte 7. The rule in practice is lowercase only.
- **Repro:** `createEntity` with an attribute named `createdAt`.
- **Workaround:** lowercase with underscores (`created_at`, `expires_block`).
- **Suggestion:** share one grammar between the validator, the engine and `explain()`, and say
  "lowercase letters". *(friction.md §9)*

### 3. The exported chain has no block explorer, so we guessed the wrong URL — SDK / docs · medium

- **Expected:** `tiramisu.blockExplorers.default.url`, like any viem chain.
- **Actual:** the field is omitted. We extrapolated `explorer.tiramisu.db-chain.testnet.arkiv.network`
  from the RPC host; it doesn't exist. The real host, `tiramisu.explorer.arkiv.network`, is only in
  the network reference.
- **Suggestion:** populate `blockExplorers.default`, a one-line change. *(friction.md §3)*

### 4. The faucet can't be scripted — Hub / faucet · high for our architecture

- **Expected:** a rate-limited HTTP claim, even behind an access key.
- **Actual:** an interactive wallet claim only. Two consequences:
  - Unattended expiry tests stop at "fund this address".
  - A per-user-key design (grants genuinely `ownedBy` each user) needs a server-side funder. Ours
    is `/api/fund`.
  The path of least resistance is one shared wallet owning everything, which makes `ownedBy`
  meaningless.
- **Suggestion:** `POST /faucet {address}`, rate-limited or key-gated. *(friction.md §5)*
- **Related:** the README's sample private key had a zero balance when we tried it. *(friction.md §4)*

### 5. A duration-based lifetime outlives the window you promised — SDK / docs · high, subtle

- **Expected:** `ExpirationTime.fromSeconds(120)` ends access about 120 seconds after the send.
- **Actual:** it sets a minimum lifetime resolved against the block the transaction lands in, so
  expiry drifts later. A share whose countdown had reached zero still opened at t+130s. The caveat
  is documented once, on `CreateEntityReturnType.expiresAt`.
- **Repro:** create with `fromSeconds(120)`, store `now + 120`, query at t+130s. The entity is still
  there.
- **Workaround:** read the head, pin `atBlock(head + ceil(ttl / 2))`, and store that height as an
  attribute.
- **Suggestion:** document the lower bound where the `from*` helpers are introduced, and advertise
  `atBlock` for deadlines. `fromSeconds` also rejects odd seconds; a `fromSecondsCeil` would help.
  *(friction.md §2, §11)*

### 6. SDK lineage is confusing to search — docs · low

`golem-base-sdk` → `arkiv-sdk` → `@arkiv-network/sdk`. Search results and generated snippets mix
all three, and our plan pinned `0.7.x` while `0.8.1` had a different `select()` surface.

- **Suggestion:** an "older names you may find" note at the top of the README. *(friction.md §6)*

### 7. No direct way to get an entity's creation transaction — SDK · low

- **Expected:** for submission evidence, get from an entity key to the transaction that created it.
- **Actual:** `getEntity` returns `creator` and `createdAt` (a block number) but no transaction
  hash. We had to `getLogs` over the creation block and match the entity key in each log.
  (Observed 2026-09-13 while collecting this submission's evidence.)
- **Suggestion:** expose `createdTxHash` on the entity, or document the log-scan recipe.

### 8. Expiry is not erasure, and the docs could say so in one sentence — docs · our mistake, worth preventing

- **What we believed:** a wrapped key stored in a grant is destroyed when the grant expires.
- **Actual:** `expires` removes the entity from queries. The transaction's calldata keeps the
  payload forever. We recovered a v1 payload from an expired grant (`scripts/payload-survives.mjs`).
- **Not an Arkiv bug:** "encrypt your own data before it goes in" is right. We put key material in
  beside the ciphertext, which is the case that sentence doesn't name.
- **Suggestion:** one sentence where `expires` is explained: *"expiration removes an entity from
  queries; it does not remove the transaction that created it, and payloads remain readable in
  chain history."* *(friction.md §13)*

### 9. The explorer was fine once found

Transaction pages at `https://tiramisu.explorer.arkiv.network/tx/<hash>` resolved for every hash we
cited. The only friction was discovering the host (issue 3).

## The single most important improvement

**Make a query predicate with the wrong type fail loudly (issue 1).** It is silent and looks like
empty data, and every newcomer hits it on their first query.
