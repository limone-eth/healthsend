/**
 * Proves the v3 threshold-release condition (lib/arkiv.ts) offline, against a fake Arkiv node.
 *
 * `buildArkivGrantQuery` is the request a TACo `JsonRpcCondition` runs at release time. This file
 * proves three things about it, none of which a string-shape check alone would catch:
 *
 *   - a substituted entity — a different, live grant — is refused;
 *   - an owner-initiated extension of the native expiry does not widen the policy;
 *   - the condition never reads a convenient past block.
 *
 * The "fake Arkiv" here is a query evaluator narrow enough to be trustworthy: it only understands
 * the exact five-clause grammar `buildArkivGrantQuery` emits (checked by the first block below), so
 * it cannot silently accept a request shape the function never actually produces.
 */
import assert from "node:assert/strict"
import { registerHooks } from "node:module"

// Next resolves extensionless TypeScript imports. Node's strip-types runner does
// not, so this proof gives it the one resolution rule the application uses.
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

const { buildArkivGrantQuery } = await import("../lib/arkiv.ts")

const binding = {
  grantId: `0x${"34".repeat(32)}`,
  owner: `0x${"12".repeat(20)}`,
  expiresBlock: 900n,
  ref: "ab".repeat(32),
}

// --- the exact condition shape --------------------------------------------
{
  const request = buildArkivGrantQuery(binding)
  assert.equal(request.method, "arkiv_query")
  assert.ok(request.params[0].includes(`grant_id = bytes32(${binding.grantId})`))
  assert.ok(request.params[0].includes(`$owner = addr(${binding.owner})`))
  assert.ok(request.params[0].includes("$expiresAt = u64(900)"))
  assert.equal("atBlock" in request.params[1], false)
  assert.deepEqual(request.params[1].select, { owner: true })
  assert.equal(request.query, "$.data[0].owner")
  assert.equal(request.expected, binding.owner)
  console.log("PASS  condition pins grant id, owner, original expiry, and current Arkiv state")
}

/**
 * A fake Arkiv node that answers `arkiv_query` for exactly the grammar `buildArkivGrantQuery`
 * emits: five equalities ANDed together, always in the same order. It matches an entity only when
 * every clause names that entity's *current* field — which is the whole property under test, so
 * the fake has to enforce it rather than assume it.
 */
function fakeArkivQuery(entities, whereClause) {
  return entities.filter(
    (entity) =>
      whereClause.includes("app = str('healthsend')") &&
      whereClause.includes("kind = str('grant')") &&
      whereClause.includes(`grant_id = bytes32(${entity.grantId})`) &&
      whereClause.includes(`$owner = addr(${entity.owner})`) &&
      whereClause.includes(`$expiresAt = u64(${entity.expiresAt})`),
  )
}

/** Runs one binding's condition against the fake node's current entities, TACo-side. */
function release(boundBinding, entities) {
  const request = buildArkivGrantQuery(boundBinding)
  assert.equal("atBlock" in request.params[1], false, "a release condition must never pin a past block")
  const matches = fakeArkivQuery(entities, request.params[0])
  if (matches.length === 0) return null
  return matches[0].owner.toLowerCase() === request.expected ? matches[0] : null
}

const live = { grantId: binding.grantId, owner: binding.owner, expiresAt: 900 }

// --- the live, untouched grant releases -----------------------------------
{
  const matched = release(binding, [live])
  assert.ok(matched, "an untouched grant at its original owner/expiry must satisfy its own condition")
  console.log("PASS  the live, untouched grant satisfies its own release condition")
}

// --- an extended expiry does not widen the policy -------------------------
{
  // The owner extended their own entity — nothing stops that; see buildArkivGrantQuery's docs.
  const extended = { ...live, expiresAt: 5_000 }
  const matched = release(binding, [extended])
  assert.equal(
    matched,
    null,
    "extending the native expiry must not satisfy a condition pinned to the original block",
  )
  console.log("PASS  an extended expiry does not widen the policy")
}

// --- a substituted entity is refused ---------------------------------------
{
  // A second, live grant for the same owner and the same expiry — but a different grant_id.
  // Nothing about "same owner, same current expiry" should let it stand in for the expired one.
  const substitute = { grantId: `0x${"56".repeat(32)}`, owner: binding.owner, expiresAt: 900 }
  const matched = release(binding, [substitute])
  assert.equal(matched, null, "a substituted entity with a different grant_id must be refused")
  console.log("PASS  a substituted entity is refused")
}

// --- both an extension and a substitute present: only the exact match could ever pass ---
{
  const extended = { ...live, expiresAt: 5_000 }
  const substitute = { grantId: `0x${"56".repeat(32)}`, owner: binding.owner, expiresAt: 900 }
  const matched = release(binding, [extended, substitute])
  assert.equal(matched, null, "neither an extended original nor a live substitute may satisfy the condition")
  console.log("PASS  neither an extended nor a substituted entity satisfies the condition, even together")
}

console.log("\nAll checks passed.")
