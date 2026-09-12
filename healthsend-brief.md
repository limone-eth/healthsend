# HealthSend

**DocSend for health data — except there's no DocSend.**

Share your health data with a person or an AI assistant, scoped to exactly what they need, for exactly as long as the relationship lasts. Then it expires — enforced by cryptography, not by a company agreeing to stop serving it.

Target: ETHRome 2026 (Sept 11–13, Urbe Hub) — Swarm bounty ("Build an app where users own their data") + Arkiv bounty (Mission 02 "Built to expire" + Best Use of Arkiv automatically; Missions 01/03 dropped unless a clear product value-add appears).

---

## 1. The problem

Health data sharing today is permanent access for temporary relationships.

- A nutritionist you'll work with for twelve weeks gets a PDF of your labs that lives in her inbox forever.
- A lab that saw you once keeps your panel indefinitely.
- An AI assistant helping with this month's question either gets nothing, or gets your history pasted into a chat window — irreversibly, into a provider's storage.

Every recipient's access outlives the relationship it was granted for. The sender has no record of who can see what, no way to end access, and no way to give *less* than everything.

**The reframe:** expiry isn't a privacy feature bolted on. It's matching how long access lasts to how long the relationship lasts. The relationships around a person's health are bounded; the person is the only continuous thread between them. The data layer should reflect that.

## 2. The idea

A personal encrypted health archive the user owns, plus a "send" primitive: a scoped, de-identified, time-bound copy that a human or an AI agent can read until it expires — after which the decryption key is destroyed and the ciphertext is noise. No server decides who reads; no company has to keep a promise for the guarantee to hold.

Same primitive, two readers:

- **Human recipient** — WeTransfer-grade UX: open a link, see the data, no account, no wallet, no download button.
- **Agent recipient** — an MCP connection scoped and time-bound the same way. Lend your context to an assistant; get it back when the grant lapses.

## 3. Persona: Giulia

34, Rome. Two years of Oura data, blood panels from several labs, a thyroid condition she manages. Starting a twelve-week block with a nutritionist she found online and doesn't know. Uses an AI assistant daily and has never given it her health history, because pasting a thyroid panel into a chat feels irreversible.

Why she's right for the demo: her relationships are bounded (12-week coach, one-off lab, per-question assistant) and she is the only party who should hold the full record permanently.

## 4. Use cases

1. **Coach / nutritionist engagement** — share sleep, training, labs for 12 weeks. Access lapses on its own; no revocation chore.
2. **One-off second opinion** — anyone-with-link send, short window, de-identified panel.
3. **Assistant with borrowed context** — "sleep + training, two weeks." The model answers from real data without ever learning whose data it is; two weeks later the context is simply gone.

## 5. User flows

### 5.1 Sender (Giulia)

1. **Onboard (once).** Passkey via Swarm ID — no wallet, seed phrase, or Bee node. Provisions her long-lived archive batch (funded via Swarm desk gift codes during the hackathon; state this in the README).
2. **Import (once).** Drops in an Apple Health export + a lab PDF. Client-side: parse → split identifiers into their own bucket → encrypt → upload to Swarm. She sees six buckets: **labs, sleep, training, medications, notes** + **identity** (greyed out, never shared by default).
3. **Create a send.** The core screen. Nothing pre-selected — the work of the interface is choosing what to *include*. She ticks buckets, sets an end date (a date, not a slider — she's matching a real engagement), and picks a link mode (see 5.2). Under the hood: scoped copy of only those buckets, fresh ephemeral keypair, re-encrypted, uploaded on a batch sized to the window, grant written with the wrapped key and matching expiry. Ephemeral private key travels in the URL fragment — never to any server.
4. **Live view.** Active sends: recipient, scope, days remaining (real batch TTL, not a UI timer), and an access log she owns (who/when/how often). An audit trail, not analytics — no page-level tracking, no engagement heatmaps.
5. **End early (optional).** One button deletes the grant → wrapped key gone → ciphertext is noise. The default is that she never has to remember: it fails safe.

### 5.2 Human recipient (nutritionist)

Opens the link on her phone. No app, no wallet, no MetaMask.

Two link modes — presented as two options with different descriptions, **not** a use-count field, because the user is choosing between security properties:

- **Anyone with the link.** Opens instantly, no claim step. The link is the credential for its whole life; dies on expiry. For one-offs.
- **Claim on first open.** First open creates a passkey (one Face ID prompt); the ephemeral key re-wraps to it; the link burns; access binds to that device. Giulia sees who claimed and when. For ongoing relationships.

Optional PIN on either mode, delivered out-of-band (e.g. WhatsApp). It's transit hygiene against link interception — useful, especially against first-opener-wins on claim mode — but not a cryptographic boundary, and we don't pretend otherwise (see 9).

What she sees: a read-only page. Sleep and training over time, lab panels — **no name, no date of birth** (see 8). Scope label, expiry date, **no download button**. She received access, not a file. Twelve weeks later the same URL shows an expired state; nobody did anything.

### 5.3 Agent recipient (Claude via MCP)

Giulia connects her assistant with a scope + window (sleep + training, two weeks) — the same grant object with a different reader. On the web app this is a separate flow from human sends (same scoping screen, different recipient step: pairing code instead of link mode), producing the same grant shape.

**Distribution and install.** Ship as an `.mcpb` desktop-extension bundle (zip with local MCP server + manifest.json). Download, double-click, Claude Desktop installs it — no config editing, no OAuth, and Claude Desktop ships its own Node runtime so the user needs nothing installed. Transport is stdio.

**Pairing — the agent is just a third recipient type. No auth flow exists.**
1. First run, the local server generates its own keypair and displays a short pairing code.
2. Giulia enters the code in the web app, picks scope + window — the send screen she already knows.
3. The app wraps a fresh ephemeral key to the server's public key and writes the grant.
4. The server watches for grants addressed to its key, resolves the wrapped key, and generates its tool surface from the scope.

No OAuth server, no sessions, no accounts, no callbacks. **The grant is the authorization** — it carries identity (the server's key), scope (which tools exist), and expiry (when decryption stops working). The website never talks to Claude; Claude never talks to the website; the only channel between them is an encrypted grant only the paired server can open.

**Why not remote MCP (decided, don't reopen).** A remote custom connector is a public HTTPS endpoint with OAuth 2.1 (PKCE, token validation, audience binding) — and Claude connects to it *from Anthropic's cloud, even from Claude Desktop*. So a remote server must decrypt to serve, holds keys at request time, and can be compelled during the window: the DocSend gatekeeper wearing an MCP hat. Plus a compliant OAuth 2.1 implementation eats Saturday building the thing that weakens the story. Future "hosted tier" framing (README where-next only): remote server holds only the scoped, time-bound ephemeral key — trusted base grows from "your machine" to "your machine + our server, one slice, one window." Honest downgrade, clearly labeled, not weekend scope.

**Network topology — local ≠ offline.** The model never fetches anything; all networking is outbound from the local server:

```
Claude (model, Anthropic cloud)
        ↕  tool call / tool result (text only)
Claude Desktop (Giulia's machine)
        ↕  stdio
HealthSend MCP server (Giulia's machine)
        →  HTTPS out: Arkiv RPC (read grant)
        →  HTTPS out: Swarm gateway (fetch ciphertext)
        →  decrypt + aggregate locally
        ←  summary text only, back up the chain
```

No inbound URL, no hosting, no ports, no cert. Ciphertext travels gateway → her machine; only the finished summary enters the conversation. Never hand the model a gateway URL "to fetch itself": the content is encrypted (useless) and making it useful means putting key material into the conversation and provider storage. The model gets answers — never keys, never ciphertext.

**Behavioral rules (unchanged):**
- Server never holds the master key — only the grant's wrapped ephemeral key. Grant lapses → *cannot* decrypt, not "declines to."
- Scope enforced by the tool surface: `get_sleep_summary(period)`, `get_training_load(period)` generated from the grant at pairing. Out-of-scope buckets: no tool exists *and* the key doesn't decrypt them. Two boundaries, neither depending on model behavior.
- Aggregate before the model sees anything ("avg 6.2h, 4 nights <6h, trending down" — not 90 raw rows). Raw access, if ever, is a separate per-call-approved tool.
- After expiry: tools removed from the manifest so the model reports missing access — it must not confabulate. Test explicitly.

**Demo:** put the pairing on camera — double-click bundle, code appears, enter it in HealthSend, scope prompt, tools appear in Claude. Thirty seconds, and it answers the question every judge silently has: *how did the AI get access?* Demo is Claude Desktop specifically; say so in the README.

### 5.4 Accounts, multi-user, and data freshness

**Registration = Swarm ID. We keep no user database.** Any user signs up with a passkey (or Ethereum account) via Swarm ID; that identity is the account. Per-user archive keys derive from it, each user gets their own encrypted namespace: their own archive batch, their own bucket manifests, their own sends. Multi-device comes free — Swarm ID's cross-device sign-in unlocks the same archive anywhere. During the hackathon each new user's batch is funded from gift codes; production needs a funding story (fiat on-ramp to postage) that goes in where-next, not the weekend.

**Where per-user state lives (no backend):**
- Archive manifest → Swarm feed owned by the user's identity (points at current bucket blobs).
- Sends + access log → Arkiv entities `ownedBy` the user's key, HMAC-opaque attributes (feeds as fallback per §11).
- Login on a new device: passkey → unlock keys → resolve manifest → buckets and active sends render. No session store anywhere.

**Everyone is a full user.** A recipient who claims a send can later create her own archive under the same passkey — the nutritionist receiving fifteen sends and becoming a sender is the growth loop (§14), and the account model makes it a zero-step upgrade.

**Sharing fan-out.** One archive, many simultaneous sends, mixed recipients: N humans (link mode), M agents (pairing), each with independent scope, window, and ephemeral key. Ending or expiring one affects nothing else.

**Sends are snapshots — with refresh-on-import as the coach fix.** A scoped copy is made at share time, so new imports don't appear in existing sends. Correct for one-offs; wrong for a 12-week coaching engagement. The fix rides on where the master key already lives: at import time (the only moment plaintext + master key coexist, in her browser), the app also re-encrypts the new slice under each *active* send's existing ephemeral key and updates that scoped copy's feed head. No sync process, no server; grants and expiry untouched. Weekend plan: ship snapshots; add refresh-on-import if Saturday goes well; either way one README line stating which behavior shipped — "does the coach see new data?" is the question an actually-imagining-it judge asks.

## 6. Architecture

```
┌────────────────────────────────────────────────────────┐
│ CLIENT (browser / local MCP server)                    │
│ parse · de-identify · encrypt · key mgmt · aggregate   │
└─────────────┬──────────────────────────┬───────────────┘
              │ encrypted blobs          │ grants / index
              ▼                          ▼
┌───────────────────────┐   ┌───────────────────────────┐
│ SWARM                 │   │ ARKIV                     │
│ archive (long batch)  │   │ grant entities:           │
│ scoped copies         │   │ recipient · swarm hash ·  │
│ (per-share batches)   │   │ wrapped key · ExpiresIn   │
│ via Swarm ID gateway  │   │ + access-log entities     │
└───────────────────────┘   └───────────────────────────┘
```

**The webapp is hosted but nearly serverless.** We serve a static site; parse, de-identify, and encrypt run in the browser, and ciphertext goes browser → Swarm gateway directly. Our infrastructure never sees plaintext, keys, or a user database — state it in the README, because "we made a webapp" usually implies a database full of health data, and the point is that there isn't one. (Serving the static app *from* Swarm, Etherjot-style, is a nice-to-have strictly below the cut line.)

### How we use Swarm

- **Storage of all payloads.** Archive on one long-lived batch Giulia keeps funded; each send gets its own scoped copy on its own short batch sized to the window.
- **Swarm ID** for both sender and recipient identity: passkey sign-in, browser-signed postage stamps, public gateway — no Bee node anywhere in either flow. (If we use Bee-js anywhere instead, the bounty asks for one sentence on why.)
- **Per-share batch lapse as hygiene.** Deliberately not extended. This is real data-layer decay, but soft and probabilistic (see 9) — it's why scoped copies don't accumulate forever, not the security boundary.

### How we use Arkiv

- **Grant registry.** One entity per send: recipient key, Swarm hash, wrapped ephemeral key, `ExpiresIn` matching the share window. Pruned on expiry → wrapped key gone from the query surface.
- **Auto-expiring access without a revocation step** — `ExpiresIn` is a native primitive doing exactly what the product promises.
- **Queryable send history + access log** for Giulia's live view (owner-filtered queries).
- **Attribute privacy rule:** indexed attributes are publicly queryable, so nothing semantic goes in them. Sensitive attribute values are HMAC'd under a user-held key (equality lookups still work; the index is opaque to everyone else). Timestamps stay plaintext numeric for ordering/range. We only ever query our own data, so losing range queries on sensitive dimensions costs nothing.
- **Arkiv is additive, not load-bearing** (see 11): grants fall back to Swarm feeds if the testnet isn't up.

## 7. Cryptographic design

- **Archive:** encrypted client-side under keys derived from Giulia's Swarm ID identity. Master key never leaves her client.
- **Per-send:** fresh ephemeral keypair per send. Scoped buckets re-encrypted under it. The ephemeral private key exists only (a) in the URL fragment until claim/expiry, and (b) wrapped inside the grant.
- **Claim-on-first-open:** re-wrap ephemeral key to recipient's new passkey; burn the link key. Converts the credential from *bearer* to *device-bound*. Known weakness: first-opener-wins — an interceptor who opens first binds it to their device. Detectable (Giulia sees an unexpected claim), not preventable; PIN meaningfully mitigates.
- **Why not PIN-only:** client-side PIN checks are theatre (key is in the URL); server-side checks rebuild the DocSend gatekeeper we exist to remove; PIN-derived keys (~20 bits) are offline-brute-forceable against public ciphertext in seconds.
- **Expiry = key destruction.** Grant pruned/deleted → wrapping gone → ciphertext on Swarm is noise. Crisp and instant. This is the guarantee; batch lapse and Arkiv pruning are supporting decay.
- **Future (not weekend scope): threshold decryption.** Split the ephemeral key so the recipient's share alone is insufficient; the second share must be actively served and stops at expiry — expiry by algebra, not policy. Requires a live share-holder (our service, a client threshold network, or a DKG committee), which trades against the no-server premise. If attempted at all: agent path only, Sunday morning, only if ahead. Note: timelock encryption (drand/tlock) is the wrong tool — it prevents decryption *before* a time, not after.

## 8. De-identification (at upload, not at share time)

- Direct identifiers (name, DOB, IDs, provider refs) are stripped on import into an **identity bucket** that is never in scope by default. Every share is de-identified as a structural consequence — no transform to remember. Identity binds at grant time, in the grant; blob and identity travel separately.
- **What it buys:** a leaked screenshot is numbers without an owner, not a named panel. And the assistant path gets a real property: the model reasoning about her thyroid panel doesn't know whose thyroid it is.
- **What it doesn't:** the nutritionist necessarily knows it's Giulia; and health data is quasi-identifying regardless (a distinctive lab timeline re-identifies when matched against other data). The claim is *minimized direct identifiers*, never *anonymity*. Nobody says "anonymous" on stage.

## 9. The expiry model — exact guarantees

| Layer | Guarantee | Character |
|---|---|---|
| Grant deletion / Arkiv `ExpiresIn` | Wrapped key gone; no future decryption | **Hard, instant** — the core guarantee |
| Agent path | Reader can't hoard; context absent from next conversation | Near-hard for retrieval (see caveat) |
| Human path | No future access; view-only UX; de-identified payload | Soft during window (screenshots) |
| Swarm batch lapse | Chunks stop earning storage rewards; nodes *may* GC them; content moves to cache until overwritten | Soft, slow, probabilistic decay |

**Swarm batch facts (from docs, verified):**
- Batch TTL is a readable, deterministic value — the countdown in the UI is real, and we can size batches to windows in advance.
- Post-expiry, chunks *can* be garbage-collected — permission, not obligation; no documented lapse-to-unretrievable duration exists, because it isn't a rule.
- Accessed chunks move to the back of the deletion queue — heavy reading during the window extends afterlife. Backwards from what we want; another reason batch lapse is hygiene, not boundary.
- Anyone running a node can pin chunks regardless of GC.

**Agent-path caveat (retrieval vs disclosure):** expiry governs *future retrieval*, not *past disclosure*. What the model read in week one lives in that stored conversation indefinitely (Anthropic/OpenAI side). The surviving difference is real but narrower: the assistant never accumulates a growing archive — each conversation holds only what it pulled for that question. Aggregate-first (5.3) minimizes what any conversation ever contains.

**The claim we make, verbatim-ready:** *Expiry is cryptographically enforced against anyone who didn't capture both the ciphertext and the wrapped key during the grant window, and enforced by construction for agent retrieval. Against a recipient who archives both, no system without a live gatekeeper does better — and we chose not to have one.*

**What we never claim:** prevention of screenshots or copying by a live recipient; anonymity; deterministic byte-level deletion on Swarm; that "off Arkiv's query surface" provably means "off the DB-chain."

## 10. Implementation plan

**Stack:** browser app (React) + `@snaha/swarm-id` + Arkiv TS SDK; local MCP server in TypeScript (stdio) sharing the crypto/grant library with the web app; WebCrypto throughout; one Apple Health fixture + one lab-panel fixture (nobody is judging the parser — no general import work).

**Friday evening**
1. Gift codes at the Swarm desk *before anything else* — the one dependency with no workaround at midnight. Ask the mentors (@Riky0923, @yjkellyjoo, @rakymi) whether they'd shape the demo around batch TTL at all given post-expiry GC softness — a design opinion worth having early.
2. One team member at the Arkiv session (Friday 19:00, after the 18:30 opening) — a live Postgres→Arkiv migration that leaves us with the draft `/arkiv/schema.md` the bounty requires. Everyone else on item 3.
3. Archive path end-to-end with one fixture: parse → de-identify → encrypt → upload → hash → read in a second browser profile. If this round-trips before sleep, everything after is composition.

**Saturday**
4. Scoping UI over the fixed buckets (nothing pre-selected) + the grant object — **on Swarm feeds first**.
5. Recipient view (read-only page, scope label, countdown, no download).
6. Add Arkiv as the grant index once feeds work; make the live-view queries compound (§13). Mission 03 stays dropped unless the claim-watch conditions in §13 are met — nobody builds a general live dashboard.
7. MCP server: pairing-code flow, scope-generated tools, aggregate-first summaries; package as `.mcpb` and verify install on the actual demo machine (personal laptop / personal plan — org policy can block private extensions).
8. **Record the Mission 02 lapse demo on Saturday** (short `ExpiresIn`, same query before/after, no delete call) — a Saturday recording counts and it de-risks Sunday.
9. **By 20:00 (hard): the 10-minute Arkiv conversation, repo URL handed over.** Sign-offs cannot happen Sunday. friction.md entries logged all day as things break — a fifth of their score.
10. **Feature freeze Saturday night.**

**Sunday**
11. Morning: wind-forward rehearsal on both reader paths (one-click debug clock; `ExpiresIn` = 60s is fine and everyone knows it's fine); verify the model reports missing access rather than confabulating. *Only if genuinely ahead:* refresh-on-import (§5.4).
12. **Repo complete and pushed by 10:00** — README, `/arkiv/schema.md`, `friction.md`, everything scored. Judging window opens 10:30: walk each sponsor through the project; winners at the 15:00 closing. Nothing improves the repo after 10:00, so the last hour is rehearsal, not code.

**Cut list (pre-agreed):** general memory decomposition / indexing beyond the fixed buckets; recipient dashboards/charts; any import beyond fixtures; multi-assistant support beyond Claude Desktop stdio; threshold decryption in the general (human) case.

## 11. Risks

| Risk | Mitigation |
|---|---|
| Arkiv is live at the event but explicitly early — docs, faucet, API keys, SDK and explorer under test by 40 teams at once | Feeds fallback stays in place; roughness goes straight into friction.md (it's scored). Mission 02 needs only entity writes, queries and `ExpiresIn` — the smallest possible API surface. |
| Venue wifi dies mid-demo | Cached fixture + local gateway fallback (~20 min of work). Demo runs offline. |
| Scope creep (general indexing layer) | Cut list above; five buckets, full stop. |
| Model confabulates after expiry | Tools removed from manifest, not just erroring; tested explicitly. |
| `.mcpb` install blocked on demo machine (org extension policy) | Demo from a personal laptop on a personal plan; verify install Saturday, not Sunday. |
| First-opener-wins on claim links | PIN out-of-band; unexpected-claim visible in Giulia's live view. |

## 12. Demo script (90 seconds)

1. Giulia: tick sleep + training + labs, set 12 weeks, share. (Scoping screen visible — nothing pre-selected.)
2. Nutritionist's phone: link opens, data renders — no name on it.
3. Claude: connect (scope prompt on camera), ask "does my sleep debt explain my flat sessions?" — answered from her real data.
4. **Wind the clock** (one click).
5. Nutritionist's link: expired. Claude, same question: no context — cleanly reported, not refused, not invented.
6. **Last frame: Giulia's archive, untouched.** Her record survives; everyone else's access doesn't.

Don't demo the crypto. Demo the coach seeing the data, then not seeing it. Rehearse twice.

## 13. Bounty fit

**Swarm judging criteria, in their order:**
1. *Someone would want to use it* — permanent-access-for-temporary-relationships is a pain everyone in the room has felt; the wind-forward makes it visceral.
2. *Genuinely runs on Swarm* — every payload byte lives there; per-share batches are doing conceptual work, not checkbox work.
3. *UX makes sense* — WeTransfer-grade recipient flow; passkeys, no wallets anywhere.
4. *Uses Swarm ID* — both sides of every flow.

**Requirements checklist:** public repo (open-source license) · README: what it does + how to run · live demo · one line on where next.

**Arkiv bounty ($2,500 pool: 3 missions × $500 + $1,000 Best Use; one prize per team; USDC on Ethereum):**
- **Mission 01 (Decommission): skip.** Requires a pre-existing indexer to replace; they explicitly say don't invent one.
- **Mission 02 (Built to expire): our core demo.** "Something changes because data expired on its own, not because a job deleted it." Check = same query before/after the boundary, **no delete call in between** → the mission recording must show natural lapse, never the early-revoke button (which calls delete). Short lifetimes recommended; a Saturday recording counts. Optional cheap add: a "lease" toggle on agent grants (extend-on-activity, their second pattern).
- **Mission 03 (Live wire): dropped by default.** The general live dashboard is demo-ware — sends live for weeks, access events are rare, and nobody watches their sends page (the product answer would be notifications, which are out of scope). The one parked candidate with real product value: **claim-watch** — a short-lived subscription scoped to the send just created, open until it's claimed, which doubles as the first-opener-wins detection surface from §7 (an unexpected claim seen live is actionable; found on refresh days later it's forensics). Revisit only if the websocket endpoint is confirmed at the opening ceremony *and* Saturday is on schedule; otherwise no regret — one prize per team means missions are insurance, and 02 + Best Use is where the weekend lives.
- **Best Use narrative:** their "what Arkiv is not" section prescribes our architecture verbatim — index-beside-the-file (entity with hash + typed attributes, bytes elsewhere) and not-a-confidentiality-layer (encrypt before it goes in / store commitments). We decided both before reading it; say so.
- **Scoring (query depth 30 / evidence 20 / fit & trade-offs 20 / friction 20 / craft 10).** Query depth is our weak point — fix by making live-view queries compound: owner + type + numeric `expires_at` range ("expiring this week"); send-id + timestamp range + ordering (access log). HMAC'd equality still filters; plaintext numeric timestamps still range. §6's attribute rule *is* the fit-and-trade-offs answer.
- **Qualify:** tick Arkiv + name missions on the form · repo public with everything scored by **Sunday 10:00** · draft `/arkiv/schema.md` (their Friday 19:00 session produces it) · `friction.md` bug report (a fifth of the score — log as things break, not retrospectively) · **10-minute conversation + repo URL to the Arkiv team by Saturday 20:00** (cannot be done Sunday).
- **SDK:** `@arkiv-network/sdk` v0.7.x — *not* `arkiv-sdk` or `golem-base-sdk` (previous lineage). Rules: hub.arkiv.network/ethrome. People: Santiago @SantiagoDevRel (modelling, SDK, sign-offs), Shantelle @shantelleawo (prizes).

**Prize context:** €1,000 pool, two winners at €500; their sketch of the two ways to win — "the app we'd most want to keep using" and "most inventive use of Swarm" — and this is built to contend for the first while the batch-lapse + key-destruction design argues for the second.

## 14. Where next (the line the bounty asks for)

- **Threshold decryption with a live share-holder** — expiry by algebra for the human path too, and the honest trade-off it forces against the no-server premise. A real research direction, and grant-conversation material (the Swarm Foundation said post-event support talks are on the table).
- **The recipient's own agent** — a nutritionist's AI reading a shared bundle means the decrypting process runs on someone else's machine; the genuinely unsolved version.
- **Recipient growth loop** — a clinician who receives fifteen of these eventually wants the sending side (the WeTransfer lesson).
- **Regulatory posture** — time-bound, purpose-scoped disclosure with minimized identifiers and key destruction at the end is a strong GDPR story; still Article 9 special-category data, and this document is not legal advice.
- **Name check** — "HealthSend" is legible and ships as-is for the weekend; "-Send" on a document-sharing product sits close to Dropbox's DocSend mark, so revisit before anything post-hackathon.

## 15. Positioning, one breath

DocSend's control is server-side — revoked means DocSend agreed to stop serving it. Ours is cryptographic: no key, no read, nobody to ask. **DocSend for health data, except there's no DocSend.** And we stay *health*, not *documents* — generalize and you lose the bounded-relationship urgency that makes the demo land.
