/**
 * Proves "End access now" always leaves the confirm sheet in a state the
 * sender can act from — R2-013. No network, no chain: `endSend` is injected.
 *
 * The defect this guards against: `endSend` (lib/sends.ts) rejects instead
 * of resolving when the holder refuses the connection outright (down,
 * unreachable, DNS failure), as opposed to answering with a non-OK response.
 * A caller that awaits it directly never reaches the line that clears its
 * "ending" flag, so the confirm sheet stays stuck with every control
 * disabled — it cannot be dismissed or retried, and the sender is left
 * unsure whether access ended. `performConfirmEnd` (confirm-end.ts) must
 * always resolve.
 */
import assert from "node:assert/strict"
import { registerHooks } from "node:module"

// Next resolves extensionless TypeScript imports and the project's "@/*" ->
// "./*" path alias (tsconfig.json). Node's strip-types runner does neither,
// so this proof gives it the two resolution rules the application uses.
registerHooks({
  resolve(specifier, context, nextResolve) {
    const resolved = specifier.startsWith("@/")
      ? new URL(`../${specifier.slice(2)}`, import.meta.url).href
      : specifier
    try {
      return nextResolve(resolved, context)
    } catch (error) {
      const extensionless = resolved.startsWith(".") || resolved.startsWith("file:")
      if (!extensionless || /\.[cm]?[jt]sx?$/.test(resolved)) throw error
      return nextResolve(`${resolved}.ts`, context)
    }
  },
})

const { performConfirmEnd } = await import("../app/(sender)/shares/confirm-end.ts")

const ENTITY_KEY = "0x" + "11".repeat(32)

// --- a holder that refuses the connection resolves, it does not hang -------
{
  const outcome = await performConfirmEnd(ENTITY_KEY, {
    endSend: async () => {
      throw new TypeError("fetch failed: connect ECONNREFUSED")
    },
  })
  assert.equal(
    outcome.outcome,
    "refused",
    "a holder that refuses the connection must resolve to 'refused', not reject",
  )
  assert.match(outcome.message, /ECONNREFUSED/)
  console.log("PASS  a refused connection resolves to a 'refused' outcome instead of hanging")
}

// --- an explicit error response is reported the same way -------------------
{
  const outcome = await performConfirmEnd(ENTITY_KEY, {
    endSend: async () => ({ status: "error", message: "HTTP 403" }),
  })
  assert.equal(outcome.outcome, "refused")
  assert.equal(outcome.message, "HTTP 403")
  console.log("PASS  an explicit error response is reported as 'refused' the same way")
}

// --- a successful revoke resolves to ended ----------------------------------
{
  const outcome = await performConfirmEnd(ENTITY_KEY, {
    endSend: async () => ({ status: "ended" }),
  })
  assert.equal(outcome.outcome, "ended")
  console.log("PASS  a successful revoke resolves to 'ended'")
}

console.log("\nAll checks passed.")
