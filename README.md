# HealthSend

**Share health data with someone for exactly as long as you mean to. Then the key is gone.**

A first scaffold, focused on the two integrations that carry the idea: **Swarm**
for storage and identity, **Arkiv** for grants that expire on their own.

**Live: [healthsend.vercel.app](https://healthsend.vercel.app)** · Built at ETHRome 2026.

Sending needs a Swarm ID with a postage batch. *Receiving needs nothing at all* —
open a share link in a private window and you are the recipient.

---

## The one-paragraph version

You sign in with a Swarm ID passkey. You pick one or more documents — a lab PDF,
a sleep export, the consult note — and a window — two minutes, twelve weeks, whatever matches the real relationship. The
file is encrypted in your browser and the ciphertext goes straight to Swarm. The
key that opens it is split in two: half travels in the URL fragment of the link
you send, half is written into an Arkiv grant that carries an expiry. The
recipient opens the link with no account and no wallet; the two halves meet in
their browser and nowhere else. When the window closes, the grant lapses, its
half of the key leaves the index, and what is left on Swarm is noise — to them,
to a later visitor, and to us.

Nobody revokes anything. No job runs. The access simply runs out.

## Why this shape

Health data sharing today is permanent access for a temporary relationship. A
nutritionist you work with for twelve weeks has your labs in her inbox forever.
The usual fix is a company that promises to stop serving the file — which is a
promise, and a gatekeeper, and something that can be compelled.

So the design constraint was: **no gatekeeper anywhere, including us.** That rules
out an access check on a server, which in turn is what forces expiry to be key
destruction rather than a policy decision. Arkiv's native entity lifetime turns
out to be exactly that primitive, which is why the grant registry is the load-
bearing piece rather than a nice-to-have index.

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

**Both halves are required.** Keep the link forever and you still cannot read
anything after the grant expires. Scrape every Arkiv entity and you have wrapped
keys that are indistinguishable from random without the fragments.

### What we never claim

Expiry governs *future retrieval*, not *past disclosure*. A recipient who
screenshots the page during the window keeps the screenshot; a recipient who
archives both the ciphertext and the wrapped key before expiry keeps their
access. No system without a live gatekeeper does better, and we chose not to have
one. What we do guarantee is that nobody who did not capture both halves during
the window can ever read the document, and that includes us.

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

**Swarm.** Every payload byte lives there; our origin never sees plaintext, a
content key, or a link secret, and there is no user database anywhere in this
app. Swarm ID is both sides of identity — the sender signs in with a passkey and
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
