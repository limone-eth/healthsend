# Working in this repository

## Identity — commit as `limone-eth`, always

Every commit here is authored `limone-eth <simonestaffa96@gmail.com>`. The
repository config already says so, and `.githooks/pre-commit` refuses anything
else.

**Never pass `-c user.name=...` or `-c user.email=...` to `git commit`.** Let the
repository config decide. Overriding it on the command line is exactly how four
commits landed under the wrong name and had to be rewritten after they were
pushed.

New clone:

```bash
git config core.hooksPath .githooks
```

GitHub operations use the `limone-eth` account: `gh auth switch --user limone-eth`.

## Deployment

Vercel project `healthsend`, connected to this repo — pushes to `main` deploy.
Production is <https://healthsend.vercel.app>.

`ARKIV_FUNDER_PRIVATE_KEY` is set in all three Vercel environments. It is a
throwaway testnet key that funds users' derived Arkiv keys; it holds no real
value, but keep it out of commits — `.env.local` is gitignored.

## Checks before pushing

```bash
pnpm lint && pnpm build
pnpm verify:crypto     # split-key scheme, no network
pnpm e2e               # recipient path in a clean browser context
pnpm doctor            # external dependencies: RPC, funder balance, gateways
```

`pnpm verify:expiry 60` writes a real grant and waits for it to lapse. It costs
gas and takes ~90s, so it is not part of the routine loop — run it when the
expiry behaviour itself changed.

## Things that will bite

- **Arkiv attribute names are lowercase.** The engine's `Ident32` grammar rejects
  `A`–`Z` and does it *on-chain*, so `createdAt` costs a reverted transaction.
- **Query predicates must carry the same tagged type as the write.** A mismatch
  is not an error — it silently matches nothing. `eq("sender", addr(me))`, not
  `eq("sender", me)`.
- **Expiry is pinned with `atBlock`, never a duration.** A duration resolves
  against the block the transaction lands in, so it drifts *later* than the
  window the sender was promised.
- **App secrets are scoped to identity *and origin*.** `localhost:3000` and the
  deployed origin derive different Arkiv keys from the same passkey. Sends do not
  cross between them.
- **The Swarm ID container must stay mounted.** It is rendered in every state,
  signed in or out. Unmounting it destroys the iframe and every later call fails
  with "Iframe not initialized".

See `friction.md` for the full list with repros.
