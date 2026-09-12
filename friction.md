# friction.md

Things that broke, confused us, or cost us time. Logged as they happened, not
reconstructed afterwards. Versions: `@arkiv-network/sdk@0.8.1`,
`@snaha/swarm-id@0.4.1`, `viem@2.56.3`, Node 24.15.0, Next.js 16.3.4.

---

## 1. Untyped query predicates match nothing, silently — Arkiv SDK

**Severity:** high. This is the one that would have cost us the demo.

Attributes are written with tagged constructors:

```ts
attributes: { sender: addr(me), createdAt: u64(BigInt(now)) }
```

The obvious way to query them back is with bare values, which is what the
README's own example does for a string attribute:

```ts
.where(eq("category", "documentation"))   // README
.where(eq("sender", me))                  // ours — returns nothing, ever
.where(gte("createdAt", BigInt(now)))     // ours — returns nothing, ever
```

A bare string resolves to `str` and a bare bigint to `u256`. Our attributes were
`addr` and `u64`. The mismatch is **not an error**: the query succeeds, returns
zero rows, and looks exactly like "you have no data yet".

We only caught it by reading the `ValueInput` doc comment, which states it
plainly: *"A type mismatch is not an error to the engine — it simply matches
nothing."* That sentence is load-bearing and it is buried in a type definition,
while the README's front-page example teaches the bare form.

**Repro:** write an entity with `addr`/`u64` attributes, query with bare values,
get `entities: []`.

**Fix on our side:** every predicate now carries the same tagged constructor as
the write — `eq("sender", addr(me))`, `gte("createdAt", u64(n))`.

**Suggestion:** make a type mismatch a thrown `InvalidPredicateError` rather than
an empty result. If that is too strict for a dynamic index, a dev-mode warning
when a predicate's type has no match in the queried attribute set would still
have saved us. Failing that: put the warning in the README beside the bare-value
example, not only in the type docs.

---

## 2. `ExpirationTime.fromSeconds` rejects odd numbers of seconds — Arkiv SDK

Lifetimes are counted in 2-second blocks, so `fromSeconds(n)` throws
`InvalidExpiryError` unless `n` is even. Reasonable, and the reasoning in the doc
comment is good — it refuses to silently round your `3` up to `4`.

The friction is that user-facing windows do not arrive pre-rounded. "One hour" is
fine; "the end of the consultation" computed as a delta is a coin flip. Every
caller has to reinvent the same `Math.ceil(n / BLOCK_TIME) * BLOCK_TIME`.

**Update:** we no longer use `fromSeconds` at all — see finding 11. Pinning an
absolute block with `atBlock` sidesteps this entirely, which is another argument
for making `atBlock` the advertised default for deadlines.

**Suggestion:** export `ExpirationTime.fromSecondsCeil(n)`, or mention the
rounding idiom in the README where `fromDays` is introduced.

---

## 3. The chain object has no block explorer, so we guessed wrong — Arkiv SDK

`tiramisu` from `@arkiv-network/sdk/chains` is a viem chain, and viem chains
carry an optional `blockExplorers` field. Tiramisu's is omitted.

We wanted to link a grant's transaction from the UI. With nothing in the chain
object, we extrapolated from the RPC hostname
(`rpc.tiramisu.db-chain.testnet.arkiv.network`) to
`explorer.tiramisu.db-chain.testnet.arkiv.network`. That host does not exist. The
real one is `tiramisu.explorer.arkiv.network`, a different shape entirely, and we
only found it in the docs' network reference.

**Cost:** a dead link that typechecked, built, and looked correct.

**Suggestion:** populate `blockExplorers.default` on the exported chain. It is a
one-line change and it makes `chain.blockExplorers.default.url` the single source
of truth, which is what every viem-based app already reaches for.

---

## 4. The README's sample private key is empty — Arkiv SDK

The README offers a key "for quick testing", hedged with *"funds may not always
be available"*. Its balance is `0`, so the quick-start path does not run.

We found it empty. One observation does not establish how often that is true, so
we will not claim it is empty *most* of the time — but a shared key that anyone
may drain is unreliable by construction, and an unfunded one sends a new
developer into debugging their own code when the real problem is a zero balance.
We burned a cycle confirming our transaction builder was fine before checking.

**Suggestion:** drop the shared key and make step one "claim at the faucet", or
have the example check its own balance and print the faucet URL when it is zero.

---

## 5. The faucet cannot be scripted, which blocks CI and first-run — Arkiv

`https://hub.arkiv.network/faucet` is a client-rendered page that requires an
interactive wallet claim ("one claim per wallet, per cooldown window"). Fetching
it without JS yields `Loading…`, and we found no documented HTTP endpoint — which
is not proof that none exists, only that a developer reading the docs will not
find one.

Two consequences:

1. Our end-to-end expiry test cannot run unattended. It stops with "fund this
   address" and a human has to go and click.
2. Our app derives a *per-user* Arkiv key from the user's Swarm ID, so grants are
   genuinely `ownedBy` the sender rather than by one shared app wallet. That
   design needs every new user's key to receive gas. With no programmatic faucet
   the only options are a server-side funder account (what we built, at
   `/api/fund`) or abandoning per-user ownership.

**Suggestion:** a rate-limited `POST /api/faucet {address}` — even one gated by
an access key from `/access-keys` — would make both unattended tests and
per-user-key architectures possible. As it stands the path of least resistance is
one shared wallet owning everything, which makes `ownedBy` meaningless and works
against the model Arkiv is showing off.

---

## 6. SDK lineage is confusing to search for — Arkiv

The package has been `golem-base-sdk`, then `arkiv-sdk`, now
`@arkiv-network/sdk`. Search results and model-generated snippets mix all three,
and the older ones are close enough to look plausible. Our own planning notes had
pinned `0.7.x`; `0.8.1` was current by the time we built, with a different
`select()` surface.

**Suggestion:** a short "older names you may find" note at the top of the README,
naming the deprecated packages, would cut a lot of wrong turns.

---

## 7. Swarm ID is browser-only in a way that bites SSR — `@snaha/swarm-id`

`new SwarmIdClient()` constructs an iframe, so importing the module at the top of
a Next.js App Router file breaks the server render. Expected for a browser SDK,
but the README's quick start is a bare top-level import with no note about
frameworks that render on a server — which is most of them now.

**Fix on our side:** dynamic `import()` inside a memoised accessor, guarded on
`typeof window`.

**Suggestion:** one line in the README, or ship a `"browser"` condition that
fails loudly with a useful message on the server instead of at iframe creation.

---

## 8. `canUpload` is the field that matters, and it is easy to miss

`connectionInfo.identity` being set does **not** mean the user can upload — they
also need a postage batch, or a subsidised gateway configured. The two states
look identical in a naive UI, so "signed in but every upload fails" is the
default first experience.

Credit where due: the SDK's own doc comment calls this out explicitly, and
`uploadUnavailableReason` tells you which case you are in. We would not have
guessed it from the type alone, and the comment is the only reason our sign-in
panel explains the situation instead of just failing.

---

## 9. Attribute names: client validation accepts what the engine rejects, and the error message contradicts itself — Arkiv SDK

**Severity:** high. Costs a reverted transaction, and the error sends you the wrong way.

We named two attributes `createdAt` and `expiresAt`. The SDK's own
`validateAttributeName` accepted both, the transaction was built and sent, and
the **engine** reverted it with `Ident32InvalidByte`. The SDK decoded that revert
into:

```
an attribute name holds "A" (0x41) at byte 7, which is outside the name charset
("A"-"Z", "a"-"z", "0"-"9", ".", "-" and "_", with a letter first)
```

Two separate problems, and the second is the expensive one:

1. **Client-side validation is more permissive than the engine.** `createdAt`
   passes `validateAttributeName` and fails on-chain. The whole point of a
   client-side name validator is to catch this before it costs a transaction.

2. **The error message states a charset that includes the very byte it is
   rejecting.** It says `"A"-"Z"` is allowed, then rejects `"A"` at byte 7. The
   string is a hardcoded constant in `explain()` (`dist/index.js`, `CHARSET`)
   rather than anything derived from the engine's actual grammar, so it drifted.

We lost time reading the message literally — if `A-Z` is legal, `A` at byte 7
cannot be the problem, so we looked for an encoding issue that did not exist. The
real rule appears to be **lowercase only**.

**Repro:** `createEntity` with an attribute named `createdAt`. It builds, sends,
and reverts.

**Fix on our side:** all attribute names are now lowercase with underscores
(`created_at`, `expires_at`). Our TypeScript field names stay camelCase; only the
on-chain names changed.

**Suggestion:** make `validateAttributeName` enforce exactly the engine's
grammar so this fails locally and for free, and derive the charset string in
`explain()` from the same source rather than hardcoding it. If uppercase really
is invalid, the message should say "lowercase letters" — as written it actively
misleads.

---

## 10. Sign-in appeared not to persist — **our bug, not the SDK's**

Recorded because it was logged here as an SDK problem first, and the correction
is the useful part.

**Symptom:** every page load showed the signed-out state, even with a live Swarm
ID session. Clicking "Continue with Swarm ID" fixed it, so it looked like the
session was not surviving a reload. The initial suspicion was third-party storage
partitioning — the cross-origin iframe unable to reach its own first-party
storage — which the SDK exporting `isStorageShared` and `markFirstPartyStorage`
seemed to support.

**Actual cause:** ours. Our `onConnectionChange` subscribed a listener but never
constructed `SwarmIdClient`, so the iframe was never mounted. Probing the page
found `document.querySelectorAll("iframe")` empty — nothing was there to report a
session, which settled it on its own. (We also checked
`document.hasStorageAccess()` and read `true` as ruling partitioning out. That
reasoning was wrong: the API reports the *calling document's* cookie access, and a
top-level `true` says nothing about a cross-origin frame. The empty iframe list
was the actual evidence.) Clicking connect "fixed" it only because `connect()`
constructs the client as a side effect.

**Fix:** subscribing now starts the client. An existing session is restored by
mounting the iframe, so a returning user lands signed in.

**The one fair note for the SDK:** a client that is never constructed is
indistinguishable, from the dApp's side, from a user who is signed out — both are
`{ canUpload: false }` with no identity. A distinct "not initialised" state, or a
dev-mode warning when `onConnectionChange` is subscribed before `initialize()`
resolves, would have pointed straight at this instead of at storage partitioning.

We left this entry in rather than deleting it: a bug report that turns out to be
the reporter's own mistake is worth the correction, and we would rather be
accurate than look thorough.

## 11. A duration-based lifetime outlives the window you promised — Arkiv SDK

**Severity:** high, and subtle — it looks like it works.

We sized grants with `ExpirationTime.fromSeconds(window)` and separately stored a
wall-clock `expires_at` attribute for display. In testing, a share whose countdown
had reached zero **still decrypted**: the entity was alive and still served the
wrapped key, so the recipient had genuine access past the stated window.

The cause is that a duration and a deadline are not the same thing:

- `fromSeconds(n)` sets `minLifetime`, which the engine resolves against the
  block the transaction **lands in**. The SDK's own doc on
  `CreateEntityReturnType.expiresAt` says it plainly — *"this is a lower bound:
  the real expiry is later by however many blocks passed between building and
  inclusion."*
- Block production is not a clock either, so `n / 2` blocks is only `n` seconds
  if the chain holds exactly 2s/block.

Both errors pushed the same way in our testing: **the enforced expiry ran later
than the promised one.** Being precise, the SDK's lower-bound guarantee is about
*block height*, not wall-clock — a chain running fast could in principle produce
the blocks sooner than the nominal 2s each and land the expiry early. What we
observed, and what the inclusion delay guarantees on its own, is drift the other
way. For a product whose claim is "access ends when I said it would", drifting
late is the direction that breaks it.

**Repro:** create with `fromSeconds(120)`, store `now + 120` as an attribute,
query at `t+130s`. The entity is still there.

**Fix on our side:** read the head, compute `expiresBlock = head + ceil(ttl /
BLOCK_TIME)`, pin it with `ExpirationTime.atBlock(...)`, and store that height as
the queryable attribute. Countdowns are computed from the remaining blocks rather
than from a wall-clock timestamp we invented.

Being honest about the limit of that: the remaining blocks are converted to
seconds *once* per read, and the recipient's countdown then ticks on `Date.now()`
without following the head. If the chain runs slow, a freshly loaded page can
still open a document another page has already declared expired. Pinning the
deadline removed the inclusion-delay drift; it did not make blocks equal seconds.

**Suggestion:** the lower-bound caveat is documented exactly once, on the return
type, and is easy to miss because `fromDays(30)` reads like a deadline. Say it
where the `from*` helpers are introduced too, or name them in a way that marks
them as floors (`atLeastDays`). For anyone whose expiry is a *promise* rather
than a hint, `atBlock` should be the advertised default.

---

## 12. Sign-up cannot be embedded, so every new user leaves the app — `@snaha/swarm-id`

**Severity:** medium as a bug, high as a product problem. This is the single
biggest source of friction in our funnel.

The SDK's pitch is that Swarm ID replaces wallets and seed phrases, and it does.
But the first-run flow still sends the user off-site:

1. Click connect in our app.
2. A Swarm ID tab opens for consent.
3. On a fresh origin, a **"⚠ Check storage"** step opens *a third tab* on
   `swarm-id.snaha.net` to establish first-party storage.
4. Approve the account.
5. Return to our app.

Three tabs and two context switches before a user has done anything. For a
product whose whole claim is "no wallet, no seed phrase, just a passkey", the
onboarding still feels like a wallet connect.

**Why it cannot be fixed on our side.** We checked whether the consent UI could
be embedded. The proxy iframe the SDK creates carries **no Permissions Policy
`allow` attribute** — no `publickey-credentials-create`, no
`publickey-credentials-get`. WebAuthn in a cross-origin iframe requires both the
embedder to delegate the permission *and* the frame to be allowed it, so passkey
creation inside the embedded frame is impossible as shipped. `ConnectOptions`
offers only `popupMode: "popup" | "window"` — a sized popup or a full tab. There
is no in-page option.

**What we did:** switched to `popupMode: "popup"`, which at least reads as a
dialog rather than a redirect. The storage step still opens its own tab.

**Suggestion, in order of value:**

1. Set `allow="publickey-credentials-create *; publickey-credentials-get *"` on
   the proxy iframe and offer an in-frame consent UI. The attribute is one line;
   the consent mode behind it is not, and we have not proven the whole flow works
   in-frame across browsers. Offered as a direction, not a patch.
2. Consider the **Storage Access API** (`document.requestStorageAccess()`) for
   the partitioning problem instead of a first-party tab visit — a permission
   prompt rather than a navigation. Its prompt behaviour and per-browser
   requirements would need testing; we are not claiming it removes the third tab
   for free.
3. Failing both, detect the fresh-origin case *before* the consent screen and do
   the storage step first, so the user crosses one boundary rather than two.

**Related observation, unresolved.** On `https://healthsend.vercel.app` we could
not complete the connect at all: the storage check kept re-presenting after the
first-party visit, where the identical flow succeeds on `http://localhost:3000`.
We suspect `vercel.app` being on the Public Suffix List interacts with storage
partitioning, but we have not proven it and are not reporting it as fact. Next
test is a non-PSL custom domain.

---

## 13. Expiry is not erasure, and we built a product on believing it was — Arkiv

**Severity:** none against Arkiv; total against us. The most useful thing we
learned all weekend, and the reason it belongs here is that the documentation
warned us and we still got it wrong.

We designed around this claim: the wrapped content key exists *only* inside the
grant entity, so when `expires` prunes the entity the key is destroyed and the
ciphertext on Swarm becomes permanently unopenable — including to us. That
sentence was in our README, our schema doc, and on the page recipients actually
see.

It is false. Entities are created by transactions, and the payload travels in the
transaction's calldata. `expires` prunes the entity from the **live query
surface**; it does not remove the transaction. We proved it against one of our
own expired grants:

```
$ node scripts/payload-survives.mjs 0xb7f157f7… 0x5f9b5f13…

entity   0x5f9b5f13eaed3e43f3c8903c865248e05546cb9e2dea72e60d6e86ca12b1e905
status   gone from the query surface

PAYLOAD RECOVERED FROM CALLDATA:
  {"v":1,"ref":"demo-swarm-reference","wrap":{"iv":"x","ct":"y"}}
```

The entity is gone. The wrapped key is not, and never will be.

**This is not an Arkiv bug.** Your own docs say *"it is not a confidentiality
layer. Entities are public and verifiable by design, so secrets and personal data
stay out. Store a hash or a commitment instead, or encrypt your own data before it
goes in."* We read that, encrypted the document before it went in — and then put
the wrapped **key** in beside it, which is the case the sentence does not quite
name.

**Where the documentation could stop the next team making this mistake:**

1. `expires` is described in terms of entities no longer showing up in queries.
   That is accurate and it is also exactly what a reader rounds to "gone". One
   sentence — *"expiration removes an entity from queries; it does not remove the
   transaction that created it, and payloads remain readable in chain history"* —
   would close the gap. It is the single highest-value sentence you could add.
2. The "not a confidentiality layer" warning is framed around *secrets in
   payloads*. The trap we fell into is subtler: correctly-encrypted data whose
   **key material** is in the payload, protected by a second factor held
   elsewhere. Worth naming, because "encrypt before it goes in" reads as
   permission to store the wrapper.
3. A note that `$payload` is carried in calldata, near the payload docs rather
   than only in the transaction decoder, would make the lifetime obvious to
   anyone reasoning about deletion.

**What we changed.** Rather than quietly restate the claim, the README now has a
section titled *What expiry does and does not do* with a table of what is and is
not true, the repro above, and the design that would actually fix it — keep the
wrapped key out of Arkiv and behind something that can stop answering (a
threshold share, or an ACT-gated blob with a revoked grantee list), leaving the
entity holding a commitment plus typed attributes. That is the role your docs
describe for the index, and we would have landed there had we read them better.

Mission 02 is unaffected: it asks that something in the app change because data
expired on its own, and that is precisely what still happens.

---

## 14. `buttonConfig` has no font option, so the connect button cannot match the page's typeface — `@snaha/swarm-id`

**Severity:** low. Cosmetic, and the story that surfaced it (H-73) only needed
the label text fixed; the mismatched font is a known, undocumented limit.

The sign-in button is painted inside the Swarm ID iframe (`CONNECT_CONTAINER_ID`
in `lib/swarm.ts`), and `buttonConfig` is the only way to style it from our
side. Its shape, read from the installed `@snaha/swarm-id@0.4.1` types
(`dist/types.d.ts`, `ButtonConfig`), is:

```ts
export interface ButtonConfig {
    connectText?: string;
    disconnectText?: string;
    loadingText?: string;
    backgroundColor?: string;
    color?: string;
    borderRadius?: string;
}
```

**Expected:** a `fontFamily` (or similar typography) field, so the button text
could be set to the app's UI face — `"Switzer", var(--font-figtree),
-apple-system, Helvetica, Arial, sans-serif` (`app/globals.css`, `--font-ui`).

**Actual:** no such field exists. `backgroundColor`, `color` and
`borderRadius` are the whole surface. The button's font is whatever the
iframe's own stylesheet sets, independent of the embedding page.

**Fix on our side:** none available. This is not a workaround we declined to
write — there is no documented hook to reach the iframe's font, and reaching
into its DOM or stylesheet from outside would break on the next SDK release
(and is exactly what `snaha/swarm-id#613`, cited elsewhere in this file, warns
against for the connect button specifically).

**Suggestion:** add `buttonConfig.fontFamily` (a CSS font-family string,
applied inside the iframe with the same graceful-fallback behaviour a
font-family stack already has) alongside the existing colour and radius
knobs.
