# HealthSend

**Share health data through a link with a verifiable expiry.**

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
> the wild. Sending needs a Swarm ID with a batch; *the recipient needs no account
> or wallet*.

---

## The one-paragraph version

You sign in with a Swarm ID passkey. You pick one or more documents — a lab PDF,
a sleep export, the consult note — and a window — two minutes, twelve weeks,
whatever matches the real relationship. The file is encrypted in your browser and
the ciphertext goes straight to Swarm. A fresh content key is split into two
shares: one is derived from the secret in the link's URL fragment, and the other
is stored under a TTL by HealthSend's key-share holder. The Arkiv grant carries
the Swarm reference, a SHA-256 commitment and the expiry, but no key material.
The recipient opens the link with no account and no wallet. Their browser reads
the live grant, proves possession of the fragment to the holder, and reconstructs
the content key locally. When the window closes, the grant lapses and the holder
refuses its share, so the ordinary reader — the one who opens the link a month
later — finds nothing to open.

Nobody has to revoke anything. No cleanup job runs. The access window runs out.

That last sentence is the honest one. The stronger version we believed for most
of a day — that expiry of an Arkiv grant *destroys* the key — is **false**, and
[we prove it is false below](#what-expiry-does-and-does-not-do).

## Why this shape

Health data sharing today is permanent access for a temporary relationship. A
nutritionist you work with for twelve weeks has your labs in their inbox forever.
The usual fix is a company that promises to stop serving the file — which is a
promise, and a gatekeeper, and something that can be compelled.

So the constraint that ships is narrower: **we never hold the documents, and no
one component has both the key and the expiry authority.** There is a server of
ours in the read path. It is the key-share holder, and it keeps one share under a
TTL. The other share is derived from the URL fragment, so the holder cannot
open the document by itself. The holder checks Arkiv before every unlock; Arkiv
sets the public lifetime but holds no secret.

That trade is deliberate and [stated plainly below](#the-cost-stated-plainly): the
holder can fail or be compelled to serve, and its deletion guarantee is only as
good as its storage provider. Neither its refusal nor its later TTL deletion can
erase a copy that a recipient already made. That difference matters enough to
have [its own section](#what-expiry-does-and-does-not-do).

## Who this is for, and how it reaches its first 100 users

Two concrete situations, not a persona sheet:

- **A bounded engagement.** Someone starting a twelve-week block with a nutritionist or
  coach sends sleep, training and lab data through a link set to twelve weeks. The
  retrieval window matches the plan instead of a revocation nobody remembers to do.
- **A one-off consult.** Someone getting a second opinion sends a lab panel to a
  specialist they don't have an ongoing relationship with, for a short window. Afterward,
  the ordinary share link cannot retrieve the panel again. The specialist can still keep
  anything they received while the link was open. A de-identified version of this send —
  so the specialist sees the panel without the name on it — is designed but **not built**;
  today's send shares the document as uploaded.

**The distribution path.** The link needs no app and no account to open, so it travels
over whatever channel the two people already use to talk — WhatsApp, email, a patient
portal message. That is the entire install step, and it is exactly what the demo link at
the top of this README exercises: open it, no sign-in offered, and the same link stops
retrieving the documents after expiry. It does not erase a screenshot or any other copy
made while the link was live. There is no separate app to distribute.

The first 100 users are expected to come from the recipient side, not from outbound
marketing. Sending needs only a Swarm ID passkey — no wallet, no seed phrase (see
[Running it](#running-it)) — so a nutritionist or specialist who receives one send from one
client is one passkey sign-in away from becoming a sender to their own client list. A
practitioner who typically holds 15-30 concurrent clients is worth more, as a channel,
than any single acquisition tactic available to a weekend hackathon project. The plan is
therefore to onboard a handful of independent coaches and specialists directly and let
each practitioner's own roster be the multiplier — a mechanism that can be checked against
the running app today, rather than a projection that has to be taken on faith.

**What this is not, yet.** This is a hackathon build on a testnet. Sending still needs a
Swarm storage drive and a funded Arkiv key, both handled today by hackathon-specific paths
— gift codes at the Swarm desk, a faucet claim, and the `/api/fund` route described in
[Why there is a server at all](#why-there-is-a-server-at-all) — none of which is a
production onboarding flow. Turning "the first 100 users" from a hackathon plan into a
claim about real people needs the funding story already flagged in
[Where this is going](#where-this-is-going), and the de-identification step named above
shipped rather than designed.

## How it works

```
  Browser (sender)
    │  encrypt envelope under a fresh content key (AES-256-GCM)
    ├──────────────► Swarm          ciphertext, via the Swarm ID iframe's own
    │                               browser-signed postage stamp
    │
    │  split content key; keep the link secret in the URL fragment
    ├──────────────► Arkiv          grant: Swarm ref + SHA-256 commitment
    │                               + typed attributes + `expires`; no key material
    └──────────────► holder         held share + commitment, stored under a TTL

  Link:  https://…/s/<entityKey>#<linkSecret>
                                   └── the fragment itself never reaches a server

  Browser (recipient, no account)
    ◄───── Arkiv    read live grant and its commitment
    ◄───── holder   prove link possession → held share (only while grant is live)
    ◄───── Swarm    read ciphertext by hash (public gateway)
           derive the link share, join the two shares, decrypt locally
```

**Both shares are required.** The URL fragment derives one; the holder stores the
other. The Arkiv grant contains neither share: its commitment lets the holder
check a derived proof, and its lifetime determines whether the holder serves.
The holder cannot decrypt with the values it sees, and the link alone cannot
decrypt without the holder.

Today, possession of the link is the recipient's only credential. A separate
four-digit PIN and a claim-on-first-open lock to one device are designed but
**not built**.

## What expiry does and does not do

We got this wrong the first time, and the correction is the most useful thing in
this repository, so it is stated plainly rather than buried.

**What we believed:** the wrapped key lives only in the grant, so when the grant
expires the key is destroyed and the ciphertext on Swarm becomes permanently
unopenable — even to us.

**What was actually true of v1:** Arkiv entities are created by transactions,
and the payload travels in the transaction's calldata. Expiry prunes the entity from the
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

So v1's real guarantee was narrower than the one we set out to build:

| Claim | True? |
|---|---|
| The document is encrypted client-side, and no server of ours receives plaintext | **Yes** |
| Neither the URL fragment nor the public v1 grant payload alone reveals plaintext | **Yes** |
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

**What fixed it** — and, just as usefully, what would not.

*Not* Swarm ACT. We reached for it first and it is ruled out explicitly: bee-js
states that *"updating the grantees list to remove a public key will not revoke
access to the content retroactively"*, and Swarm's access-control design keeps
historical versions precisely so a grantee can still fetch what they were once
authorised for. A former grantee need not even have downloaded during the window.
ACT would add another permanent envelope, not an expiring one.

*Not* letting the postage batch lapse either. That removes the incentive to keep
serving chunks; it is not an obligation on anyone to erase bytes, and an
archivist needs no key to keep a copy of ciphertext.

The deployed fix is a live holder: keep the key material out of public storage
and behind a party that can refuse, with Arkiv holding only a commitment and the
typed attributes. HealthSend currently uses one holder; the independent
threshold quorum we would prefer is designed but **not built**. This trades
against the no-server premise, which is exactly the tension
[§7 of the brief](./healthsend-brief.md) flags.

And it is worth being precise about what even that buys. It does **not** expire
access already obtained: a recipient who opened the document keeps whatever their
browser received, and no design changes that. After Arkiv expiry, the shipped
holder route refuses retrieval immediately. The held share remains in storage for
a one-hour grace period, so direct access to that store plus the fragment can
still reconstruct the key during that hour. After the TTL removes the share, a
fragment that leaks later — an old bookmark, a forwarded message, a stale backup
— is useless, subject to the provider deletion caveat below. That is a real gain,
and it is narrower than "the key is gone".

### What we never claimed

Expiry governs *future retrieval*, not *past disclosure*. A recipient who
screenshots the page during the window keeps the screenshot. No expiry design can
revoke bytes a recipient already received. The live holder controls later key
retrieval; it does not control copies already made.

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
| 5 | **Swarm + Arkiv** — *superseded v1* | ✅ | ✅ | ❌ | Best custody, no working expiry. See the section above. |
| 6 | Swarm + KV | ✅ | ❌ | ✅ | It expires — on **our** timer. A gatekeeper with good manners. |
| 7 | Arkiv + KV + S3 | ❌ | ✅ | ✅ | Governance right, custody wrong. |
| 8 | **Swarm + Arkiv + KV** — *what ships today* | ✅ | ✅ | ✅ | The only row with all three. |

### Why Swarm rather than S3

- **We hold zero copies of anything.** With S3 we would be the custodian of an
  encrypted health-document corpus — breachable, subpoenable, acquirable.
  Compromising HealthSend entirely does not reach the documents.
- **The archive outlives us.** Shut the project down and the documents are still
  retrievable by hash, still the sender's. On S3 they die when the bill stops.
  That is "users own their data" as a fact rather than a slogan.
- **Ciphertext reads do not touch our infrastructure** — a recipient fetches the
  encrypted blob from a public gateway. The separate holder call serves only a
  random-looking key share, but it is still part of the read path.

### Why Arkiv rather than a table with an `expires_at` column

This is the load-bearing one, and row 6 is the honest way to see it: Swarm plus a
KV *does* expire. The difference is **who answers the question**.

With an `expires_at` column, "has this expired?" is a question **we** answer. We
can extend it, be compelled to extend it, or answer wrongly through a bug, and
nobody outside can tell. With Arkiv:

- **Expiry is publicly verifiable.** The holder queries a public chain — and so
  can the recipient, the sender, or a court.
- **We cannot extend the Arkiv grant.** Grants are `ownedBy` the sender's key,
  derived from their Swarm ID. We cannot forge, backdate, or quietly un-expire one.
- **The sender audits their own history** without trusting an API of ours.
- **Expiry is the trigger, not a status field.** In row 8 the holder refuses
  because Arkiv says the grant is gone, which is what makes a key unreconstructable.

So the KV ends up with **capability but no authority**; Arkiv has **authority but
no capability**. That separation is the whole argument, and a single database
cannot express it — because it would be *our* database.

### The cost, stated plainly

Row 8 buys expiry with **fragility**. If the KV is unreachable, live sends stop
working early — the one failure rows 2 and 5 never have. The Arkiv grant and
Swarm ciphertext remain, but the recipient cannot reconstruct the key. A valid
link can therefore break, so that state must read *"temporarily unavailable"*
and never *"expired"*.

That is not a defect to engineer away. **If nothing can break access, nothing can
end it** — they are the same mechanism. Rows 2 and 5 cannot be shut down, which is
exactly why they cannot expire.

Deletion is also only as good as the provider's: a TTL removes the holder's
share, and we do not claim its bytes are provably gone from every disk. It is
categorically better than key material published to a public chain forever, and
that is the honest comparison.

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
> Legacy v1 links still open while their grants are live, for backward
> compatibility. They still cannot provide expiry against an archived payload,
> and the script tells you which kind you are looking at.

## Running it

```bash
pnpm install
cp .env.example .env.local
# add ARKIV_FUNDER_PRIVATE_KEY, KV_REST_API_URL and KV_REST_API_TOKEN
pnpm doctor
pnpm dev
```

`pnpm doctor` checks the Arkiv RPC, the funder account's balance, the Swarm
download gateway and the Swarm ID origin. It does **not** check the holder. A
working v2 send also needs a Redis REST endpoint in `KV_REST_API_URL` and its
token in `KV_REST_API_TOKEN`; without them the handoff route returns 501.

Two sender prerequisites cannot be scripted, so both are worth doing first.

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

Round-trips a bundle through the encryption and envelope code, then checks both
the current split-key scheme and the legacy v1 scheme. For v2 it proves that the
fragment and holder share reconstruct the key, that the holder's own view does
not, and that the on-chain commitment carries no key material. The v1 check stays
in place to reproduce the archived-payload defect rather than hide it. The script
also checks that filenames are absent from stored bytes and that a blinded
attribute is stable under one user's key but differs under another key.

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
lib/crypto.ts     current split-key and legacy v1 primitives
lib/envelope.ts   the bundle format — N files, one sealed blob; names inside it
lib/swarm.ts      Swarm ID for the sender, public gateway for the recipient
lib/arkiv.ts      v2 grants: Swarm ref, commitment, typed attributes, expiry
lib/holder-store.ts
                  held shares under TTL, plus the access log
lib/identity.ts   identity keys derived from Swarm ID; no user database
lib/sends.ts      create a send / open a send, end to end
app/page.tsx      sender: sign in, upload, share, watch it expire
app/s/[key]/      recipient: no account, renders in place, no download button
app/api/holder/   four holder routes: share, unlock, revoke, access log
app/api/fund/     gas top-ups for user-derived keys — hackathon scaffolding
arkiv/schema.md   the superseded v1 model and the expiry discovery
friction.md       what broke and what we suggest
scripts/          doctor, crypto and expiry verification
e2e/              Playwright recipient tests, run in a clean browser context
```

## How a user's keys are made

No identity key or complete content key is stored by HealthSend. The holder stores
one random-looking share per send under a TTL; neither that share nor the derived
auth key can reconstruct the content key. There are two key families, and they
are different on purpose.

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

**Per-send keys — random, never derived from the identity.** One fresh pair per
send:

```ts
const contentKey = randomBytes(32)   // encrypts the bundle
const linkSecret = randomBytes(16)   // lives only in the URL fragment
const { heldShare, commitment } = await splitContentKey(contentKey, linkSecret)

// heldShare + commitment go to /api/holder/share under a TTL
// { v: 2, ref: swarmRef, authCommitment: commitment } goes to Arkiv
```

`splitContentKey` derives one share and a separate auth key from the link secret.
It XORs the content key with the link share to make `heldShare`, which the holder
stores. On open, the holder compares the SHA-256 commitment after it checks that
the Arkiv grant is live. The auth key proves possession of the link but cannot
reconstruct the content key. The Arkiv grant carries no share and no key.

These values are deliberately *not* derived from the identity. If they were, a
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

The app has five server API routes. Four implement the live key-share holder; the
fifth, `/api/fund`, tops up user-derived Arkiv keys with testnet gas. Neither role
receives a document, a complete content key, a link secret, or a filename.

The holder is the deliberate read-path dependency that makes v2 expiry work:

- The sender calls `/api/holder/share` after its Arkiv grant exists. The route
  stores the first held share under a TTL.
- `/api/holder/unlock` checks that the grant is live, verifies a proof derived
  from the URL fragment, returns the held share, and tries to record the served
  unlock.
- `/api/holder/revoke` deletes the held share after a sender signature.
- `/api/holder/access-log` returns the served-unlock times after the same kind of
  sender proof.

The TTL lasts one hour beyond the requested window, so it cannot end a valid
send before Arkiv does. The Arkiv check blocks retrieval after the grant lapses;
the later TTL removes the share from the holder. The revoke and access-log
backends exist, but their sender controls are **not built**.

The funder route solves a different problem. Writing a grant to Arkiv is a chain
transaction, so it costs gas. Each user's grant key is **derived from their own
Swarm ID** (`deriveAppSecret`), which is what makes grants genuinely `ownedBy`
the sender — and what makes the dashboard's ownership filter mean something
rather than being decoration. But a freshly derived key holds no GLM, and the
Arkiv faucet is an interactive wallet claim with no HTTP API, so nothing can top
it up automatically.

That leaves three options, and the trade is the interesting part:

| Approach | Cost |
|---|---|
| User brings a funded key | Defeats the premise — we promised no wallet, no seed phrase. |
| One shared app wallet signs every grant | Every grant is `ownedBy` **us**. "Users own their data" becomes false, and the ownership query is theatre. |
| **Server funds the user's own key** | One funding route, and gas is centralised. What we chose. |

So `/api/fund` buys back user-owned keys at the price of a faucet we run. It
moves gas and nothing else: it never sees a document, a content key, a link
secret, or a filename.

It is hackathon scaffolding and is marked as such in the code. The intended
production replacement is a fiat on-ramp to the user's own key; it is **not
built**. Note also that deployed publicly this route is an **open faucet** —
anyone can POST an address and receive testnet gas. It keeps a reserve so it
cannot be fully drained mid-demo, but it is not rate limited and we do not
pretend otherwise.

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
covers the rest. Archive records and de-identification of labelled identifiers at
import exist in code, but no application screen uses that archive yet. Detection
beyond those labelled patterns is designed but **not built**. A separate PIN,
claim-on-first-open locking to one device, and an MCP server for expiring AI tools
are also designed but **not built**.

## Notes on Swarm and Arkiv

**Swarm.** Every payload byte lives there. No server of ours receives plaintext,
a content key, or a link secret — there is no upload endpoint and no user
database. To be exact, we do serve the JavaScript that handles those values in
the browser, so this is a claim about our servers rather than a proof against a
malicious build of the client. Swarm ID is both sides of identity — the sender signs in with a passkey and
signs their own postage stamps in the browser; the recipient needs no identity at
all and reads by content hash from a public gateway. No Bee node of ours.

**Arkiv.** The index beside the file, never the file: a v2 entity holds the Swarm
hash, a SHA-256 auth commitment and the typed attributes we filter on. It holds
no key material; the encrypted bytes stay on Swarm and the held share stays with
the holder. The dashboard is a compound filter over owner, namespace, kind, file
type and a time range rather than a lookup by id. Attribute values that would
disclose something are HMAC'd under a user-held key, so equality lookups keep
working while the public index stays opaque. `expires` removes the grant from the
live query surface, and the holder uses that public result to decide whether to
serve its share. [`arkiv/schema.md`](./arkiv/schema.md) preserves the superseded
v1 model and the expiry mistake; `GrantPayload` in [`lib/arkiv.ts`](./lib/arkiv.ts)
is the current v2 shape.
