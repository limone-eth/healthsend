# Evidence

Recorded runs, so the claims in the README can be checked without setting
anything up.

| File | Shows |
|---|---|
| `mission-02-expiry.txt` | Mission 02. One grant with a 60-second lifetime, the sender's compound query run before and after the boundary, and no delete call anywhere in between. Carries the entity key and transaction hash for the [Tiramisu explorer](https://tiramisu.explorer.arkiv.network). |

Reproduce with `pnpm verify:expiry 60` against a funded key — the script is
[`scripts/expiry-demo.mjs`](../../scripts/expiry-demo.mjs) and it is short enough
to read before trusting.

The live recipient path needs no setup at all: the link at the top of the README
opens in any private window.
