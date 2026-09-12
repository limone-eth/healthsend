# HealthSend

**Share health data with someone for exactly as long as you mean to.**

A first scaffold, focused on the two integrations that carry the idea: **Swarm**
for storage and identity, **Arkiv** for grants that expire on their own.

**Live: [healthsend.vercel.app](https://healthsend.vercel.app)** · Built at ETHRome 2026.

### See it without installing anything

**[Open a live send →](https://healthsend.vercel.app/s/0xa894be7a22e8b17db0d3ce49a5126fb39199c49f58ff26be670197cb1893ebb3#ugjTYmA8gV5bdy6hLXNGxc3g3_bRQEy-0a2tA_3XPww)**

Three synthetic health documents — a lab panel, a consult note, a sleep export —
shared for seven days from 12 September 2026. No account, no wallet, no
extension. Open it in a private window and you are the recipient.

Two things to notice: the countdown comes from a real block height rather than
being invented in the page, and there is no download button anywhere. When the
window closes the same URL shows an expired state and nobody will have done
anything.

> It dies earlier if the postage batch behind it lapses first — which is the
> layered decay described in [§9 of the brief](./healthsend-brief.md), visible in
> the wild. Sending needs a Swarm ID with a batch; *receiving needs nothing*.

---

## The one-paragraph version

You sign in with a Swarm ID passkey. You pick one or more documents — a lab PDF,
a sleep export, the consult note — and a window — two minutes, twelve weeks, whatever matches the real relationship. The
file is encrypted in your browser and the ciphertext goes straight to Swarm. The
key that opens it is split in two: half travels in the URL fragment of the link
you send, half is written into an Arkiv grant that carries an expiry. The
recipient opens the link with no account and no wallet; the two halves meet in
their browser and nowhere else. When the window closes, the grant lapses and its
half of the key leaves Arkiv's index, so the ordinary reader — the one who opens
the link a month later — finds nothing to open.

Nobody revokes anything. No job runs. The access simply runs out.

That last sentence is the honest one. The stronger version we believed for most
of a day — that expiry *destroys* the key — is **false**, and
[we prove it is false below](#what-expiry-does-and-does-not-do).

## Why this shape

Health data sharing today is permanent access for a temporary relationship. A
nutritionist you work with for twelve weeks has your labs in her inbox forever.
The usual fix is a company that promises to stop serving the file — which is a
promise, and a gatekeeper, and something that can be compelled.

So the design constraint was: **no gatekeeper anywhere, including us.** There is
no server of ours in the read path at all, and so nothing we could be compelled
to keep serving. Arkiv's native entity lifetime ends availability without anyone
deciding to, which is why the grant registry is load-bearing rather than a
nice-to-have index.

What it does *not* do is destroy anything, and that difference matters enough to
have [its own section](#what-expiry-does-and-does-not-do).

## How it works

```
  Browser (sender)
    │  encrypt envelope under a fresh content key (AES-256-GCM)
    ├──────────────► Swarm          ciphertext, via the Swarm ID iframe's own
    │                               browser-signed postage stamp
    │
    │  wrap content key under HKDF(link secret, swarm ref)
    └──────────────► Arkiv          grant entity: swarm ref + wrapped key
                                    + typed attributes + `expires`

  Link:  https://…/s/<entityKey>#<linkSecret>
                                   └── never sent to any server

  Browser (recipient, no account)
    ◄───── Arkiv    read grant → wrapped key      (gone once it expires)
    ◄───── Swarm    read ciphertext by hash       (public gateway)
           decrypt locally, render in place
```

**Both halves are required.** A link with no grant opens nothing; a grant with no
link is indistinguishable from random. Neither half is useful alone.

## What expiry does and does not do

We got this wrong the first time, and the correction is the most useful thing in
this repository, so it is stated plainly rather than buried.

**What we believed:** the wrapped key lives only in the grant, so when the grant
expires the key is destroyed and the ciphertext on Swarm becomes permanently
unopenable — even to us.

**What is actually true:** Arkiv entities are created by transactions, and the
payload travels in the transaction's calldata. Expiry prunes the entity from the
*live query surface*. It does not, and cannot, remove the transaction. The
wrapped key stays public and permanent in chain history.

Check it against a grant of ours that has already expired:

```bash
node scripts/payload-survives.mjs \
  0xb7f157f7d615379a5fc06cb499fc49aa49814edb776c7eae6dfa3544f34411a6 \
  0x5f9b5f13eaed3e43f3c8903c865248e05546cb9e2dea72e60d6e86ca12b1e905
```

```
status   gone from the query surface

PAYLOAD RECOVERED FROM CALLDATA:
  {"v":1,"ref":"demo-swarm-reference","wrap":{"iv":"x","ct":"y"}}
```

So the real guarantee is narrower than the one we set out to build:

| Claim | True? |
|---|---|
| The document is encrypted client-side, and no server of ours receives plaintext | **Yes** |
| Neither the link nor the grant alone reveals anything | **Yes** |
| After expiry, an ordinary reader opening the link finds nothing | **Yes** |
| After expiry, someone who archived the public payload and *later* obtains the link can still decrypt | **Yes — this is the hole** |
| Expiry destroys the key | **No** |

The archiving attack needs no privilege and no foresight about which link to
target: the payload is public and enumerable while the grant lives, and permanent
in calldata afterwards. Only the fragment is scarce. The two halves need never be
captured at the same time, which is what our original claim assumed.

Arkiv's own documentation says this in advance — *"it is not a confidentiality
layer… encrypt your own data before it goes in."* We did encrypt the document
before it went in. The mistake was putting the **wrapped key** in as well, and
assuming pruning was erasure.

**What would fix it** — and, just as usefully, what would not.

*Not* Swarm ACT. We reached for it first and it is ruled out explicitly: bee-js
states that *"updating the grantees list to remove a public key will not revoke
access to the content retroactively"*, and Swarm's access-control design keeps
historical versions precisely so a grantee can still fetch what they were once
authorised for. A former grantee need not even have downloaded during the window.
ACT would add another permanent envelope, not an expiring one.

*Not* letting the postage batch lapse either. That removes the incentive to keep
serving chunks; it is not an obligation on anyone to erase bytes, and an
archivist needs no key to keep a copy of ciphertext.

What is left is a live holder: keep the key material out of public storage
entirely and behind a party that can refuse — a threshold share, ideally split
across an independent quorum — with Arkiv holding only a commitment and the typed
attributes, the role its own docs describe. That trades against the no-server
premise, which is exactly the unresolved tension
[§7 of the brief](./healthsend-brief.md) flags.

And it is worth being precise about what even that buys. It does **not** expire
access already obtained: a recipient who opened the document keeps whatever their
browser received, and no design changes that. What it does buy is that a fragment
leaking *after* expiry — an old bookmark, a forwarded message, a stale backup —
becomes useless. That is a real gain, and it is narrower than "the key is gone".

### What we never claimed

Expiry governs *future retrieval*, not *past disclosure*. A recipient who
screenshots the page during the window keeps the screenshot. No system without a
live gatekeeper does better, and we chose not to have one.

## Why Swarm and Arkiv, and not a database

The fair challenge to any project like this is: *you could build this with Postgres
and S3 in an afternoon.* True — and the difference is whether the guarantee rests
on our **behaviour** or on the **structure**. "We promise to stop serving" is what
the incumbent already offers.

Three properties decide whether the product is honest, and a gatekeeper needs
**both the right to decide and the means to act**. Split those and nobody is one.

- **Custody** — we never hold the documents.
- **Authority** — we do not decide whether access is still valid, and anyone can
  check who does.
- **Expiry** — access can actually end.

Every combination of the three components, scored the same way:

| # | Architecture | Custody | Authority | Expiry | What it really is |
|---|---|:--:|:--:|:--:|---|
| 1 | Postgres + S3 | ❌ | ❌ | ✅ | The incumbent. It works, and it is what we exist to replace. |
| 2 | Swarm only | ✅ | — | ❌ | Permanent sharing. The link is the key, forever. |
| 3 | Arkiv + S3 | ❌ | ✅ | ✅ | Expiry works — because *we* delete the object. Good governance over data we should not hold. |
| 4 | KV only | ❌ | ❌ | ✅ | Row 1 with extra steps. |
| 5 | **Swarm + Arkiv** — *what ships today* | ✅ | ✅ | ❌ | Best custody, no working expiry. See the section above. |
| 6 | Swarm + KV | ✅ | ❌ | ✅ | It expires — on **our** timer. A gatekeeper with good manners. |
| 7 | Arkiv + KV + S3 | ❌ | ✅ | ✅ | Governance right, custody wrong. |
| 8 | **Swarm + Arkiv + KV** | ✅ | ✅ | ✅ | The only row with all three. |

### Why Swarm rather than S3

- **We hold zero copies of anything.** With S3 we would be the custodian of an
  encrypted health-document corpus — breachable, subpoenable, acquirable.
  Compromising HealthSend entirely does not reach the documents.
- **The archive outlives us.** Shut the project down and the documents are still
  retrievable by hash, still the sender's. On S3 they die when the bill stops.
  That is "users own their data" as a fact rather than a slogan.
- **Reads do not touch our infrastructure** — a recipient fetches ciphertext from
  a public gateway. Our availability surface stays as small as it can be.

### Why Arkiv rather than a table with an `expires_at` column

This is the load-bearing one, and row 6 is the honest way to see it: Swarm plus a
KV *does* expire. The difference is **who answers the question**.

With an `expires_at` column, "has this expired?" is a question **we** answer. We
can extend it, be compelled to extend it, or answer wrongly through a bug, and
nobody outside can tell. With Arkiv:

- **Expiry is publicly verifiable.** The holder queries a public chain — and so
  can the recipient, the sender, or a court.
- **We cannot extend access.** Grants are `ownedBy` the sender's key, derived from
  their Swarm ID. We cannot forge, backdate, or quietly un-expire one.
- **The sender audits their own history** without trusting an API of ours.
- **Expiry is the trigger, not a status field.** In row 8 the holder refuses
  because Arkiv says the grant is gone, which is what makes a key unreconstructable.

So the KV ends up with **capability but no authority**; Arkiv has **authority but
no capability**. That separation is the whole argument, and a single database
cannot express it — because it would be *our* database.

### The cost, stated plainly

Row 8 buys expiry with **fragility**. If the KV is unreachable, live sends stop
working early — the one failure rows 2 and 5 never have. The sender loses nothing
(they hold the master key and the plaintext, and can re-share), but a recipient's
valid link can break, so that state must read *"temporarily unavailable"* and
never *"expired"*.

That is not a defect to engineer away. **If nothing can break access, nothing can
end it** — they are the same mechanism. Rows 2 and 5 cannot be shut down, which is
exactly why they cannot expire.

Deletion is also only as good as the provider's: a TTL removes the key, and we do
not claim the bytes are provably gone from every disk. It is categorically better
than a key published to a public chain forever, and that is the honest comparison.

> **Status: row 8 is built and deployed.** New sends split the content key and
> publish no key material at all. Check any grant's transaction yourself:
>
> ```bash
> node scripts/payload-survives.mjs <txHash>
> ```
>
> A v1 grant returns *"this grant published KEY MATERIAL"*. A v2 grant returns
> *"no key material"* — the payload is still in calldata and always will be, but
> it carries a Swarm reference and a SHA-256 commitment, and neither
> reconstructs anything.
>
> v1 links still open and still cannot expire. They degrade honestly rather than
> vanishing, and the script tells you which kind you are looking at.

## Running it

```bash
pnpm install
cp .env.example .env.local     # then fill in ARKIV_FUNDER_PRIVATE_KEY
pnpm doctor                    # checks every external dependency, names the fix
pnpm dev
```

`pnpm doctor` is the fastest way to find out what is missing — it checks the
Arkiv RPC, the funder account's balance, the Swarm download gateway and the
Swarm ID origin, and prints the specific fix for whichever one is failing.

Two external dependencies. Neither can be scripted, so both are worth doing first.

### 1. Test GLM, for writing grants

Arkiv writes are chain transactions, so the key in `ARKIV_FUNDER_PRIVATE_KEY`
needs gas. The faucet pays **the wallet you connect** — there is no field to type
an address into — so the trick is to connect the funder key itself rather than
claim somewhere else and forward:

1. Import the `ARKIV_FUNDER_PRIVATE_KEY` from `.env.local` into MetaMask as a new
   account. It is a throwaway testnet key; that is what it is for.
2. Add the Tiramisu network:
   - Network name: `Tiramisu`
   - RPC: `https://rpc.tiramisu.db-chain.testnet.arkiv.network`
   - Chain ID: `7738577`
   - Symbol: `GLM`
   - Explorer: `https://tiramisu.explorer.arkiv.network`
3. Go to [hub.arkiv.network/faucet](https://hub.arkiv.network/faucet), connect
   that account, claim. One claim per wallet per cooldown window.
4. `pnpm doctor` — it should now report the funder's balance.

The GLM lands exactly where `/api/fund` expects it, with nothing to forward.

### 2. A postage batch on your Swarm ID, for uploading

The sign-in panel shows `canUpload: false` until the signed-in identity holds
one. Swarm ID calls these **drives**.

**At ETHRome:** the Swarm Foundation desk at Urbe Hub hands out **gift codes**
that cover storage for the whole weekend, specifically so nobody has to acquire
xBZZ or xDAI first. That is the intended path and it takes a minute. Mentors
`@Riky0923`, `@yjkellyjoo` and `@rakymi` are in the Swarm topic of the ETHRome
group chat, and [discord.ethswarm.org](https://discord.ethswarm.org) otherwise.

**Otherwise:** buy a drive inside the [Swarm ID app](https://swarm-id.snaha.net),
which needs xBZZ on Gnosis Chain.

Running your own subsidised gateway is the third option and the reason
`NEXT_PUBLIC_SWARM_SUBSIDISED_GATEWAY` exists, but it means running a funded Bee
node — not a weekend job. Leave it unset.

### Testing the recipient path

The recipient path is deliberately stateless — no login, no wallet, nothing in
local storage. Two ways to prove it.

**Automated**, in a fresh browser context, which is a guest window you can re-run:

```bash
pnpm e2e                                    # states needing no setup
SHARE_URL='http://localhost:3000/s/0x…#…' pnpm e2e   # plus a real link
```

The live tests assert every document in a bundle renders, that no sign-in is ever
offered, that the context holds no cookies, and that no download control exists
anywhere on the page.

**By hand**, which is what convinces a room:

1. Create a send and copy the link.
2. Open a **guest** or private window (Chrome: profile menu → Guest).
3. Paste the link. It should render the document with a live countdown.
4. Wait out a two-minute window, reload, and the same URL shows the expired
   state. Nothing was deleted in between.

If step 3 fails but the sender's dashboard shows the grant, the usual cause is
Swarm propagation — the ciphertext has not reached the public gateway yet. Give
it a few seconds.

## Verifying the claims

Two things here are worth not taking on faith.

**The split key actually splits.** No network required:

```bash
pnpm verify:crypto
```

Round-trips a document through the real sender and recipient paths, then checks
the cases the product depends on failing: a wrong link secret does not unwrap the
key, a wrapped key does not transfer to a different Swarm reference, the filename
is not recoverable from the stored bytes, and a blinded attribute is stable under
one user's key while colliding with nobody else's.

**Grants expire on their own.** Needs a funded key:

```bash
pnpm verify:expiry 60
```

Writes one grant with a 60-second lifetime, runs the sender's compound query,
waits, and runs the **identical** query again. No delete call appears anywhere in
the script. Output is the before count, the after count, and a pass/fail.

A recorded run against Tiramisu is committed at
[`arkiv/evidence/mission-02-expiry.txt`](./arkiv/evidence/mission-02-expiry.txt),
with the entity key and transaction hash so it can be checked on the explorer:

```
BEFORE   query returns 1 row(s)
         t+56s rows=1
         t+66s rows=0
AFTER    query returns 0 row(s)

PASS  the grant expired on its own.
getEntity(0x5f9b5f13ea…) -> not found
```

## Layout

```
lib/crypto.ts     the split-key scheme; the expiry guarantee lives here
lib/envelope.ts   the bundle format — N files, one sealed blob; names inside it
lib/swarm.ts      Swarm ID for the sender, public gateway for the recipient
lib/arkiv.ts      grant entities, typed attributes, the dashboard query
lib/identity.ts   every key derived from the Swarm ID; no user database
lib/sends.ts      create a send / open a send, end to end
app/page.tsx      sender: sign in, upload, share, watch it expire
app/s/[key]/      recipient: no account, renders in place, no download button
app/api/fund/     gas top-ups for user-derived keys — the only server code
                  (see "Why there is a server at all")
arkiv/schema.md   entity model, the attribute-privacy rule, trade-offs
friction.md       what broke and what we suggest
scripts/          doctor (preflight), verify:crypto, verify:expiry
e2e/              Playwright recipient tests, run in a clean browser context
```

## How a user's keys are made

No key in this app is stored anywhere. There are two families, and they are
different on purpose.

**Identity keys — derived, stable, reproducible.** Everything hangs off the Swarm
ID the user signed in with:

```ts
const arkivSeed = await deriveAppSecret("healthsend/arkiv/v1")
const blindKey  = await deriveAppSecret("healthsend/blind/v1")

const privateKey = keccak256(arkivSeed)          // a valid secp256k1 scalar
const address    = privateKeyToAccount(privateKey).address
```

`deriveAppSecret` computes `HMAC(appSecret, label)` **inside the Swarm ID
iframe**, where `appSecret` never leaves the trusted context. It is deterministic
for a given identity, origin and label, so the same passkey on a second device
reproduces the same Arkiv key and finds the same sends waiting. That is what lets
this app have no user database at all: there is nothing to look up, because the
key is a function of the identity.

**Per-send keys — random, never derived.** One fresh pair per send:

```ts
const contentKey = randomBytes(32)   // encrypts the bundle
const linkSecret = randomBytes(32)   // lives only in the URL fragment
const kek        = HKDF(linkSecret, salt = swarmRef, info = "healthsend/grant/v1")
const wrapped    = seal(kek, contentKey)   // this is what the grant stores
```

These are deliberately *not* derived from the identity. If they were, a
compromised identity would retroactively open every send ever made. Fresh
randomness makes each send independent of the user's identity and of every other
send.

> ⚠️ **App secrets are scoped to identity *and origin*.** `http://localhost:3000`
> and `https://healthsend.vercel.app` derive **different** Arkiv keys from the
> same passkey. Sends made on one origin do not appear in the other's dashboard,
> and each origin's key needs funding separately. This is good isolation and a
> bad demo surprise — pick one origin and rehearse on it.
>
> Connecting on a new origin also adds a one-time **"Check storage"** step in the
> Swarm ID consent screen, which grants the iframe first-party storage access. Do
> it once before you present rather than discovering it on stage.

## Why there is a server at all

The app has exactly one server route, `/api/fund`, and it exists for a single
reason worth stating plainly.

Writing a grant to Arkiv is a chain transaction, so it costs gas. Each user's
grant key is **derived from their own Swarm ID** (`deriveAppSecret`), which is
what makes grants genuinely `ownedBy` the sender — and what makes the dashboard's
ownership filter mean something rather than being decoration. But a freshly
derived key holds no GLM, and the Arkiv faucet is an interactive wallet claim
with no HTTP API, so nothing can top it up automatically.

That leaves three options, and the trade is the interesting part:

| Approach | Cost |
|---|---|
| User brings a funded key | Defeats the premise — we promised no wallet, no seed phrase. |
| One shared app wallet signs every grant | Every grant is `ownedBy` **us**. "Users own their data" becomes false, and the ownership query is theatre. |
| **Server funds the user's own key** | One server route, and gas is centralised. What we chose. |

So `/api/fund` buys back user-owned keys at the price of a faucet we run. It
moves gas and nothing else: it never sees a document, a content key, a link
secret, or a filename. Our infrastructure still cannot read anything a user
sends, which is the property the whole design exists to protect.

It is hackathon scaffolding and is marked as such in the code. In production this
becomes a fiat on-ramp to the user's own key and the route stops existing. Note
also that deployed publicly it is an **open faucet** — anyone can POST an address
and receive testnet gas. It keeps a reserve so it cannot be fully drained
mid-demo, but it is not rate limited and we do not pretend otherwise.

## Provenance — what was built when

Built at ETHRome 2026 (Friday 11 September 18:00 – Sunday 13 September 10:00).
Stating this plainly because the rules are strict about it:

- **All code in this repository was written during the hackathon.** The git
  history is the record; nothing was pre-written and dropped in.
- **Two planning documents predate the event**, both written on 3 September and
  both prose rather than code: [`healthsend-brief.md`](./healthsend-brief.md)
  (the product brief) and [`DESIGN.md`](./DESIGN.md), along with a Pencil design
  file. They are included so the thinking behind the build is inspectable rather
  than hidden. No code, schema or configuration came from them.

If a judge considers the brief enough to make this a pre-existing project, treat
this section as the declaration the rules ask for — but the honest summary is
that the weekend produced everything that runs.

## Where this is going

**Onboarding.** First run still costs a trip through Swarm ID's own windows, and
two of the three context switches we started with were our own bugs (now fixed).
What remains is not fixable from a dApp — the proxy iframe delegates no WebAuthn
permission, and no API exists to mint an account. The design we would build is a
self-hosted identity layer on a same-site subdomain, which removes the boundary
without letting the app touch the seed. Written up in full, including why "just
use Privy" does not work, in [`docs/identity-and-onboarding.md`](./docs/identity-and-onboarding.md).

The brief this scaffold came from ([`healthsend-brief.md`](./healthsend-brief.md))
covers the rest: a personal encrypted archive split into buckets with
de-identification at import, claim-on-first-open links that bind to a device, and
an MCP server that makes an AI assistant a third recipient type — same grant
object, same expiry, tools that stop existing when the window closes.

## Notes on the two integrations

**Swarm.** Every payload byte lives there. No server of ours receives plaintext,
a content key, or a link secret — there is no upload endpoint and no user
database. To be exact, we do serve the JavaScript that handles those values in
the browser, so this is a claim about our servers rather than a proof against a
malicious build of the client. Swarm ID is both sides of identity — the sender signs in with a passkey and
signs their own postage stamps in the browser; the recipient needs no identity at
all and reads by content hash from a public gateway. No Bee node of ours.

**Arkiv.** The index beside the file, never the file: the entity holds the Swarm
hash, the wrapped key and the typed attributes we filter on, and the bytes stay
on Swarm. The dashboard is a compound filter over owner, namespace, kind, file
type and a time range rather than a lookup by id. Attribute values that would
disclose something are HMAC'd under a user-held key, so equality lookups keep
working while the public index stays opaque. And `expires` is doing the actual
work of the product — see [`arkiv/schema.md`](./arkiv/schema.md) for why the
grant is the only place the wrapped key exists.
