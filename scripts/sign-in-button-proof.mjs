import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

/**
 * H-73: the sign-in button's label lives in `buttonConfig.connectText`
 * (`lib/swarm.ts`), which the Swarm ID SDK paints inside its own iframe. No
 * browser test can reach text painted in a cross-origin iframe against a
 * real origin in this repo (same constraint `scripts/copy-claims-proof.mjs`
 * documents for other iframe- and auth-gated screens), so the source text is
 * checked directly.
 */
const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const swarmSource = readFileSync(path.join(repoRoot, "lib/swarm.ts"), "utf8")

assert.ok(
  !swarmSource.includes('connectText: "Continue with Face ID"'),
  'lib/swarm.ts must not configure the Swarm ID button with connectText: "Continue with Face ID" — Face ID is only one way to unlock a passkey, and it does not exist on most computers or Android phones',
)
assert.ok(
  swarmSource.includes('connectText: "Continue with Passkey"'),
  'lib/swarm.ts must configure the Swarm ID button with connectText: "Continue with Passkey"',
)

console.log("PASS  lib/swarm.ts's buttonConfig.connectText reads \"Continue with Passkey\"")
