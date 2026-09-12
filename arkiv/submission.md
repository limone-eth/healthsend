# Arkiv submission — evidence index

HealthSend · https://healthsend.vercel.app · https://github.com/limone-eth/healthsend

Mission selected: **02 — Built to expire.** Also entered for Best Use of Arkiv.

## Wallets that create Arkiv entities

| Address | Role |
|---|---|
| `0x44757555aC73bdB24e8aB97041Aa4E4277480d3A` | **Demo sender (end user).** Derived from a Swarm ID passkey on `healthsend.vercel.app` (`deriveAppSecret("healthsend/arkiv/v1")` → `keccak256`). It creates and owns its own grants; ownership is never transferred. Every HealthSend user gets their own such key, per identity and per origin. |
| `0x3579286aFaEA0e68EC7F1B467652b1220f2D682C` | **Backend funder, and the Mission 02 test signer.** It tops up users' derived keys with testnet GLM (`/api/fund`) and never owns a user's grant. `scripts/expiry-demo.mjs` signs its recorded test grant with this key. |

## On-chain creation evidence (Tiramisu, chain 7738577)

| Entity | Created by | Creation transaction | State |
|---|---|---|---|
| `0xa894be7a22e8b17db0d3ce49a5126fb39199c49f58ff26be670197cb1893ebb3` | `0x44757555…80d3A` (demo sender) | [`0x630fc9bec57a791cad3db7de9c2e9a1f3b7414291964af006600575ada4436d7`](https://tiramisu.explorer.arkiv.network/tx/0x630fc9bec57a791cad3db7de9c2e9a1f3b7414291964af006600575ada4436d7) (block 351104) | **Live** until block 653502. It is the README's demo link: 3 files, `filetype=mixed`, blinded `recipient`/`label`. |
| `0x5f9b5f13eaed3e43f3c8903c865248e05546cb9e2dea72e60d6e86ca12b1e905` | `0x3579…682C` (funder / test signer) | [`0xb7f157f7d615379a5fc06cb499fc49aa49814edb776c7eae6dfa3544f34411a6`](https://tiramisu.explorer.arkiv.network/tx/0xb7f157f7d615379a5fc06cb499fc49aa49814edb776c7eae6dfa3544f34411a6) | **Expired on its own**, 60-second lifetime. Recorded run: [`arkiv/evidence/mission-02-expiry.txt`](./evidence/mission-02-expiry.txt). |

Every other HealthSend grant created during the weekend has already expired, which is the product working. Anyone can list what is live:

```js
publicClient.select({ key: true, owner: true, expiresAt: true, attributes: true })
  .where(and(eq("app", str("healthsend")), eq("kind", str("grant"))))
  .fetch()
```

## Mission 02 — how to reproduce

**1. The same query before and after natural expiry, with no delete call.** Needs a funded key in
`ARKIV_FUNDER_PRIVATE_KEY`:

```bash
pnpm verify:expiry 60     # scripts/expiry-demo.mjs
```

The script:
1. writes one grant pinned to expire 60 seconds out (`ExpirationTime.atBlock`);
2. runs the sender dashboard's compound query (`app`, `kind`, `sender`, `filetype`, `created_at` range, `ownedBy`);
3. waits;
4. runs the **identical** query again.

No delete call appears anywhere in the script. Recorded: `BEFORE 1 row` → `t+66s rows=0` → `AFTER 0 rows`,
then `getEntity → not found`.

**2. The resulting app change.** When the grant drops out of Arkiv, the share stops opening, and
nothing else has to happen:

1. At https://healthsend.vercel.app, sign in, add a PDF, and create a share with the **2 min** preset.
2. Open the link in a private window. The document renders, with a countdown read from the grant's `expires_block`.
3. Reload after two minutes. The page reads **"This link has expired"**. On **Your shares**, the share leaves the live list.

Where the change comes from:
- [`lib/arkiv.ts`](../lib/arkiv.ts): `createGrant` / `createThresholdGrant` pin the expiry with `atBlock`.
  `listGrants` is the dashboard's compound query, and `buildArkivGrantQuery` is the binding query with
  `$owner` and `$expiresAt`.
- [`lib/sends.ts`](../lib/sends.ts): `openSend` treats a missing grant as expired, never as an error.
- [`app/api/holder/unlock/route.ts`](../app/api/holder/unlock/route.ts): the holder checks that the grant is
  live before serving its half of the key.
- [`lib/key-release/chipotle-action.js`](../lib/key-release/chipotle-action.js): the Lit action queries Arkiv
  before releasing its half.
- [`app/s/[key]/page.tsx`](../app/s/%5Bkey%5D/page.tsx): the recipient's expired screen.
- [`e2e/recipient.spec.ts`](../e2e/recipient.spec.ts): "expired — the grant is gone", offline.

README sections:
- [Why Arkiv, and where it is in the code](../README.md#why-arkiv-and-where-it-is-in-the-code)
- [What expiry does and does not do](../README.md#what-expiry-does-and-does-not-do)
- [Verifying the claims](../README.md#verifying-the-claims)

Video timestamps: *added once the demo recording exists.*

## Known limitations

- **Expiry ends access, not existence.** Entity payloads stay in transaction calldata, and ciphertext
  stays on Swarm. That is why no key material ever goes into a grant.
- **Lit Chipotle shares.** Our own review found the Lit action can be fed a self-made live grant, so
  someone who kept a Chipotle link can still recover its key after it ends. The fix, H-72, is in
  progress. Holder shares are not affected.
- **`/api/fund` is an open testnet faucet** for user-derived keys, with a reserve but no rate limit.
- **Countdowns assume Tiramisu's nominal 2-second block time.** Enforcement uses the block height
  itself, not the displayed time.
