/**
 * Proves `lib/key-release/index.ts`'s factory offline — the seam H-69 put
 * between `lib/sends.ts` and the two concrete providers.
 *
 * Every property below was run red before the factory existed (there was no
 * `lib/key-release/index.ts` to import) to confirm the story's own
 * requirement actually needed writing, not just restating what the two
 * adapters already did individually:
 *
 *   - protecting a brand-new share always selects Chipotle, even when
 *     `NEXT_PUBLIC_TACO_ENABLED` is "true" — TACo is parked and this factory
 *     never chooses it for a new share, regardless of env;
 *   - releasing selects strictly by the grant's own recorded
 *     `payload.release.provider`, never by today's env — a Chipotle
 *     descriptor routes to Chipotle even with Chipotle globally disabled via
 *     `NEXT_PUBLIC_CHIPOTLE_ENABLED`, and a TACo descriptor still routes to
 *     TACo even with Chipotle enabled;
 *   - an unrecognised descriptor fails closed with a named error, before
 *     ever touching a network.
 */
import assert from "node:assert/strict"
import { registerHooks } from "node:module"

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (error) {
      if (!specifier.startsWith(".") || /\.[cm]?[jt]sx?$/.test(specifier)) throw error
      return nextResolve(`${specifier}.ts`, context)
    }
  },
})

const { selectProtectingProvider, selectReleasingProvider, UnknownKeyReleaseProviderError } = await import(
  "../lib/key-release/index.ts"
)

const CHIPOTLE_CONFIG = {
  enabled: true,
  actionCid: "bafyreitestaction",
  pkpId: "pkp-test",
  groupId: "1",
  usageApiKey: "usage-key-for-tests",
}

// --- protecting always selects Chipotle, TACo is never chosen for a new share ---
{
  const provider = selectProtectingProvider({ chipotle: { config: CHIPOTLE_CONFIG } })
  assert.equal(provider.descriptor.provider, "chipotle", "a brand-new share must always protect through Chipotle")
  console.log("PASS  selectProtectingProvider() always returns the Chipotle provider")
}

{
  process.env.NEXT_PUBLIC_TACO_ENABLED = "true"
  try {
    const provider = selectProtectingProvider({ chipotle: { config: CHIPOTLE_CONFIG } })
    assert.equal(
      provider.descriptor.provider,
      "chipotle",
      "TACo is parked — enabling it must never make the factory choose it for a new share",
    )
    console.log("PASS  NEXT_PUBLIC_TACO_ENABLED=true does not change what a new share protects through")
  } finally {
    delete process.env.NEXT_PUBLIC_TACO_ENABLED
  }
}

// --- releasing is chosen by the grant's own descriptor, never by today's env ---
{
  process.env.NEXT_PUBLIC_CHIPOTLE_ENABLED = "false"
  try {
    const provider = selectReleasingProvider({ provider: "chipotle" }, { chipotle: { config: CHIPOTLE_CONFIG } })
    assert.equal(
      provider.descriptor.provider,
      "chipotle",
      "a share protected under Chipotle must still select the Chipotle provider even while Chipotle is globally disabled",
    )
    console.log("PASS  a Chipotle-descriptor grant routes to Chipotle regardless of NEXT_PUBLIC_CHIPOTLE_ENABLED")
  } finally {
    delete process.env.NEXT_PUBLIC_CHIPOTLE_ENABLED
  }
}

{
  process.env.NEXT_PUBLIC_CHIPOTLE_ENABLED = "true"
  try {
    const provider = selectReleasingProvider(
      { provider: "taco" },
      { taco: { config: { enabled: false, domain: "lynx", ritualId: 1, coordinationRpc: "https://example.test" } } },
    )
    assert.equal(
      provider.descriptor.provider,
      "taco",
      "a TACo-descriptor grant must still route to TACo even while Chipotle is enabled",
    )
    console.log("PASS  a TACo-descriptor grant still routes to TACo, even while Chipotle is enabled")
  } finally {
    delete process.env.NEXT_PUBLIC_CHIPOTLE_ENABLED
  }
}

// --- an unknown descriptor fails closed, before ever building a provider ---
{
  assert.throws(
    () => selectReleasingProvider({ provider: "quantum-vault" }),
    (error) => error instanceof UnknownKeyReleaseProviderError && /quantum-vault/.test(error.message),
    "a descriptor this build does not know must fail closed with a named error",
  )
  console.log("PASS  an unrecognised provider descriptor fails closed with UnknownKeyReleaseProviderError")
}

console.log("\nAll checks passed.")
