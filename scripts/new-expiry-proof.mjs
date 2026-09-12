/**
 * Proves R2-016 offline: no browser, no Swarm ID sign-in.
 *
 * `/new` renders nothing without a real signed-in session (`NewSendPage`
 * returns `null` until `useSenderIdentity()` resolves), so there is no
 * Playwright route that can reach this logic — see
 * `e2e/mobile-tab-bar-clearance.spec.ts`'s header comment for the same
 * constraint on this route. `app/(sender)/new/expiry.ts` carries the pure
 * arithmetic split out of `page.tsx` for exactly this reason.
 *
 * The bug: enabling "Custom" and either not picking a date yet, or picking
 * one that fails to parse, used to leave `ttlSeconds` equal to whichever
 * preset window (2 min / 10 min / 1 hour / 7 days / 12 weeks) was last
 * selected — silently, with no error and no visible change other than the
 * "Pick a date and time" placeholder the sender was already looking at.
 * `isExpiryValid` is what a real submit path now checks before creating.
 */
import assert from "node:assert/strict"

const { resolveCustomSeconds, resolveTtlSeconds, isExpiryValid } = await import("../app/(sender)/new/expiry.ts")

const NOW_MS = Date.UTC(2026, 0, 1, 12, 0, 0)
const PRESET_SECONDS = 600 // "10 minutes", the default preset

// --- a custom date the sender has not picked yet must not resolve to a duration ---
{
  const customSeconds = resolveCustomSeconds("", NOW_MS)
  assert.equal(customSeconds, null, "no date picked yet must not produce a duration")

  const ttl = resolveTtlSeconds({ customEnabled: true, customSeconds, windowSeconds: PRESET_SECONDS })
  assert.equal(ttl, PRESET_SECONDS, "resolveTtlSeconds still falls back for display purposes")

  const valid = isExpiryValid({ customEnabled: true, customSeconds })
  assert.equal(valid, false, "Custom enabled with nothing picked must be invalid, not silently fall back")
  console.log("PASS  Custom enabled with no date picked is invalid, not a silent fallback to the preset")
}

// --- a custom value that fails to parse must not resolve to a duration either ---
{
  const customSeconds = resolveCustomSeconds("not-a-date", NOW_MS)
  assert.equal(customSeconds, null, "an unparseable custom value must not produce a duration")
  assert.equal(
    isExpiryValid({ customEnabled: true, customSeconds }),
    false,
    "Custom enabled with an unparseable date must be invalid",
  )
  console.log("PASS  an unparseable custom date is invalid, not a silent fallback to the preset")
}

// --- a real, parseable custom date is valid and carries its own duration ---
{
  const future = new Date(NOW_MS + 3600_000).toISOString().slice(0, 16) // +1 hour, datetime-local shape
  const customSeconds = resolveCustomSeconds(future, NOW_MS)
  assert.ok(Number.isFinite(customSeconds) && customSeconds > 0, "a real future date must produce a positive duration")
  assert.equal(
    isExpiryValid({ customEnabled: true, customSeconds }),
    true,
    "a real custom date must be valid",
  )
  const ttl = resolveTtlSeconds({ customEnabled: true, customSeconds, windowSeconds: PRESET_SECONDS })
  assert.equal(ttl, customSeconds, "a valid custom date must be used verbatim, never swapped for the preset")
  console.log("PASS  a real custom date is valid and is used verbatim, not swapped for the preset")
}

// --- Custom off is unaffected: the preset always resolves and is always valid ---
{
  assert.equal(isExpiryValid({ customEnabled: false, customSeconds: null }), true)
  assert.equal(
    resolveTtlSeconds({ customEnabled: false, customSeconds: null, windowSeconds: PRESET_SECONDS }),
    PRESET_SECONDS,
  )
  console.log("PASS  Custom off always resolves to the selected preset and is always valid")
}

console.log("\nAll checks passed.")
