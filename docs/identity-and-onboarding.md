# Identity and onboarding — where this goes next

A record of what we found about sign-up friction, what we tried, and the design
we would build next. Written during ETHRome 2026; nothing here shipped.

## The problem

On an origin a user has not used before, first run costs three browser contexts:

1. Click connect in the app.
2. A Swarm ID window opens for consent.
3. It shows **"⚠ Check storage"**, which opens a *third* tab on
   `swarm-id.snaha.net` to establish first-party storage.
4. Approve the account.
5. Return to the app.

For a product whose claim is "a passkey, no wallet, no seed phrase", that reads
like connecting a wallet — the comparison it is trying to win.

## What we already fixed

Two of the original symptoms were **our** bugs, not the platform's:

- We drove `connect()` from our own button. Under partitioned storage that opens
  the auth popup from the top level, so `window.opener` is not the iframe and the
  `setSecret` handover has nowhere to land (snaha/swarm-id#613). The proxy's own
  button, rendered via `containerId`, opens it from inside the iframe and works
  everywhere.
- We rendered that container only in the signed-out branch, so signing in
  unmounted it and destroyed the iframe. Everything after failed with
  `Iframe not initialized`.

With both fixed, sign-in is one popup and survives a reload. What remains is the
storage grant and the passkey ceremony, both inside Swarm ID's own UI.

## What we cannot fix from a dApp

Verified against `@snaha/swarm-id@0.4.1`:

- **The proxy iframe delegates no WebAuthn permission.** It is built with `src`
  and styles only — no `allow="publickey-credentials-create"`. Passkey creation
  inside the frame is impossible regardless of what the embedding page does.
- **There is no in-page option.** `ConnectOptions` exposes exactly one field:
  `popupMode: "popup" | "window"`.
- **A dApp cannot create or install an account.** The whole
  `ParentToIframeMessage` vocabulary is `parentIdentify`, `checkAuth`, `connect`,
  `disconnect` plus data operations. `setSecret` belongs to
  `PopupToIframeMessage` — the *same-origin* handover. The vault lives on
  `swarm-id.snaha.net` and only their auth UI can write it.

Filed upstream as a feature request, with the Storage Access API as the fix for
the third tab.

## Why "just use Privy" is not the answer

The intuition is sound: register with Privy using a device passkey, then mint a
Swarm ID from that account. `AccessMethodSchemaV1` even supports it in principle
— every account is a BIP-39 seed, and `{ type: "eth-wallet", encryptionSalt }` is
simply a different lock on the same vault.

It does not work, for two reasons:

1. **No channel.** Per the message protocol above, a dApp cannot install an
   account into the hosted proxy. There is no API to mint one.
2. **It would not save the ceremony anyway.** A user registering with Privy via a
   device passkey has already done a passkey ceremony. Swarm ID's native flow is
   the same ceremony. The tabs do not come from the passkey — they come from the
   cross-site boundary and storage partitioning, which Privy does not touch.

Privy would add a login system in front of an existing one.

## The design we would build

**Self-host the Swarm ID stack on a same-site subdomain.**

The repo is Apache-2.0 and `initProxy` is documented as "called from HTML page",
so the proxy is self-hostable by design. Serve it, and the `ui/` auth app, from
`id.healthsend.app` embedded in `healthsend.app`:

| Property | Why it follows |
|---|---|
| No storage partitioning | Chrome partitions by top-level **site**. A same-site subdomain is not a third-party context, so the "Check storage" tab disappears. |
| Vault still isolated | A different **origin** keeps its own storage. Our app's JavaScript still cannot read the seed. |
| Passkeys work across both | One RP ID (`healthsend.app`) covers the app and the identity subdomain. |
| Any access method | We own the auth UI, so passkey, Privy, email or password are all open. |

That keeps the property that makes the design honest — the dApp cannot touch the
seed — while removing the boundary that costs the tabs.

### What it would cost

- **A security-critical fork.** Seed vaults and key derivation, tracking a
  repository that moves fast. Bugs there lose data irrecoverably.
- **Portability.** Passkeys bind to the RP ID, so accounts created on our origin
  are not the same credentials as ones on `swarm-id.snaha.net`. Users could not
  bring an existing Swarm ID, nor take ours elsewhere. We would become the
  identity provider — which is an ownership *downgrade*, and has to be weighed
  against the onboarding win rather than assumed to beat it.
- **Backup and recovery** become ours.

### What it would not change

Nothing about the data. Identity and storage are separate layers:

- Ciphertext goes browser → Bee API → **the Swarm network**, addressed by content
  hash and kept alive by the user's own postage batch.
- Gateways are entry points, not storage. Both are environment variables; swap
  either and the data is unaffected.

Self-hosting identity moves where the *seed* lives. The blobs are already where
they should be.
