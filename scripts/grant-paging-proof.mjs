/**
 * Proves `listGrants` (lib/arkiv.ts) never under-reports a sender's live
 * grants because of a page cap — R2-008. No network, no chain: the Arkiv
 * client is injected.
 *
 * The defect this guards against: a single capped page silently dropped
 * every grant past the cap, and a dropped live grant reads to the sender as
 * "ended" on the Shares page — the one direction this product cannot afford
 * to get wrong.
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

const { listGrants } = await import("../lib/arkiv.ts")

const OWNER = "0x" + "aa".repeat(20)

function makeEntity(index) {
  return {
    key: `0x${index.toString(16).padStart(64, "0")}`,
    attributes: {
      sender: OWNER,
      filetype: "text",
      created_at: 1_700_000_000 + index,
      expires_block: 999_999_999,
      recipient: "r",
      label: "l",
      file_count: 1,
    },
    payload: JSON.stringify({ v: 2, ref: `swarm-ref-${index}`, authCommitment: "c".repeat(64) }),
  }
}

/** A fake `client.select().where().ownedBy().limit().fetch()` walk over `entities`, `pageSize` at a time. */
function fakeClient(entities, pageSize) {
  const makePage = (offset) => {
    const slice = entities.slice(offset, offset + pageSize)
    const nextOffset = offset + pageSize
    const hasMore = nextOffset < entities.length
    return {
      entities: slice,
      hasNextPage: () => hasMore,
      next: async () => makePage(nextOffset),
    }
  }
  return {
    select() {
      const builder = {
        where: () => builder,
        ownedBy: () => builder,
        limit: () => builder,
        fetch: async () => makePage(0),
      }
      return builder
    },
  }
}

// --- a sender with more than the old 50-row cap sees every live grant --------
{
  const TOTAL = 137
  const entities = Array.from({ length: TOTAL }, (_, i) => makeEntity(i))

  const grants = await listGrants(
    { owner: OWNER },
    {
      // Page size deliberately smaller than TOTAL, and equal to the old cap,
      // to force the exact multi-page walk a single `.limit(50)` fetch skipped.
      getPublicClient: () => fakeClient(entities, 50),
      getCurrentBlock: async () => 1_000n,
    },
  )

  assert.equal(
    grants.length,
    TOTAL,
    `a sender with ${TOTAL} live grants must see all ${TOTAL}, not just the first page`,
  )
  assert.deepEqual(
    new Set(grants.map((g) => g.entityKey)),
    new Set(entities.map((e) => e.key)),
    "every entity from every page must be represented, none dropped",
  )
  console.log(`PASS  a sender with ${TOTAL} live grants (> the old 50-row cap) sees all of them`)
}

// --- a walk that never terminates is refused, not silently truncated --------
{
  // Simulates a cursor bug: every page reports another one after it, forever.
  // The safe failure is a thrown error the caller surfaces as "could not
  // reach Arkiv" (see app/(sender)/shares/page.tsx's `refresh`), never a
  // partial list presented as complete.
  let calls = 0
  const infiniteClient = {
    select() {
      const builder = {
        where: () => builder,
        ownedBy: () => builder,
        limit: () => builder,
        fetch: async () => makePage(),
      }
      return builder
    },
  }
  function makePage() {
    calls++
    return { entities: [makeEntity(calls)], hasNextPage: () => true, next: async () => makePage() }
  }

  await assert.rejects(
    listGrants(
      { owner: OWNER },
      { getPublicClient: () => infiniteClient, getCurrentBlock: async () => 1_000n },
    ),
    /did not end after/,
    "a walk that never terminates must throw rather than hang or truncate silently",
  )
  console.log("PASS  a page walk that never terminates is refused, not silently truncated")
}

console.log("\nAll checks passed.")
