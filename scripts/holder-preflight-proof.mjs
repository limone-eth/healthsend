/**
 * Proves the send holder preflight offline: no Redis, no chain, no Swarm.
 *
 * `createSend` takes narrow injected dependencies for this proof. A failed
 * holder request must stop the send before identity, upload, or grant work.
 */
import assert from "node:assert/strict"
import { registerHooks } from "node:module"

// Next resolves extensionless TypeScript imports, the project's "@/*" ->
// "./*" path alias (tsconfig.json), and the bare "next/server" specifier
// against its package export. Node's strip-types runner does none of those on
// its own, so this proof gives it the resolution rules the application uses —
// needed below to import the real route handler, not just `lib/sends.ts`.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/server") {
      try {
        return nextResolve(specifier, context)
      } catch {
        return nextResolve("next/server.js", context)
      }
    }
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

const { createSend } = await import("../lib/sends.ts")
const { holderConfigured } = await import("../lib/holder-store.ts")

// --- an unreachable holder stops every paid or permanent effect ------------
{
  const calls = { holder: 0, identity: 0, upload: 0, grant: 0 }

  await assert.rejects(
    createSend(
      {
        files: [{}],
        recipientLabel: "proof-recipient",
        ttlSeconds: 3600,
      },
      {
        fetch: async () => {
          calls.holder++
          throw new Error("connect ECONNREFUSED")
        },
        getIdentity: async () => {
          calls.identity++
          throw new Error("identity must not be read")
        },
        uploadEncryptedBlob: async () => {
          calls.upload++
          throw new Error("ciphertext must not be uploaded")
        },
        createGrant: async () => {
          calls.grant++
          throw new Error("grant must not be written")
        },
      },
    ),
    /holder.*connect ECONNREFUSED/i,
    "the error must name the unreachable holder",
  )

  assert.deepEqual(
    calls,
    { holder: 1, identity: 0, upload: 0, grant: 0 },
    "the holder must be the only dependency contacted",
  )
  console.log("PASS  an unreachable holder stops identity, upload, and grant work")
}

// --- the preflight fails against the real route with a refused Redis (R3-003) ---
// R3-003: the previous preflight posted `{}` and treated the route's 400 (a
// rejected, unparsed body) as healthy. `validateShareRequest` refuses that
// body before `putShare` is ever called, so this never proved the store
// itself was reachable — `pnpm verify:holder` stayed green with Redis down.
// This block routes the fetch through the real `GET` handler
// (`app/api/holder/share/route.ts`), the same function Next serves in
// production, pointed at the review's own repro: a syntactically valid
// Upstash REST URL with nothing listening on the port.
{
  const { GET: holderShareGET, POST: holderSharePOST } = await import(
    "../app/api/holder/share/route.ts"
  )

  const originalUrl = process.env.KV_REST_API_URL
  const originalToken = process.env.KV_REST_API_TOKEN

  process.env.KV_REST_API_URL = "http://127.0.0.1:1"
  process.env.KV_REST_API_TOKEN = "proof-token"

  try {
    const calls = { holder: 0, identity: 0, upload: 0, grant: 0 }

    // Dispatches to whichever real handler the preflight actually calls — GET
    // today, but this must catch a regression back to POST-with-`{}` too, not
    // just assert the shape this fix happens to use.
    const fetchToRealRoute = async (url, init) => {
      calls.holder++
      assert.equal(String(url), "/api/holder/share", "the preflight must probe the holder route")
      const method = init?.method ?? "GET"
      if (method === "GET") return holderShareGET()
      return holderSharePOST(new Request("http://localhost/api/holder/share", init))
    }

    await assert.rejects(
      createSend(
        { files: [{}], recipientLabel: "proof-recipient", ttlSeconds: 3600 },
        {
          fetch: fetchToRealRoute,
          getIdentity: async () => {
            calls.identity++
            throw new Error("identity must not be read")
          },
          uploadEncryptedBlob: async () => {
            calls.upload++
            throw new Error("ciphertext must not be uploaded")
          },
          createGrant: async () => {
            calls.grant++
            throw new Error("grant must not be written")
          },
        },
      ),
      /key-share holder is unavailable/i,
      "a live route with a refused Redis connection must fail the preflight",
    )

    assert.deepEqual(
      calls,
      { holder: 1, identity: 0, upload: 0, grant: 0 },
      "the holder must be the only dependency contacted",
    )
    console.log("PASS  the preflight fails against the real route when Redis refuses the connection")
  } finally {
    if (originalUrl === undefined) delete process.env.KV_REST_API_URL
    else process.env.KV_REST_API_URL = originalUrl
    if (originalToken === undefined) delete process.env.KV_REST_API_TOKEN
    else process.env.KV_REST_API_TOKEN = originalToken
  }
}

// --- holder configuration accepts only HTTP(S) URLs -------------------------
{
  const originalUrl = process.env.KV_REST_API_URL
  const originalToken = process.env.KV_REST_API_TOKEN

  try {
    process.env.KV_REST_API_TOKEN = "proof-token"

    process.env.KV_REST_API_URL = "placeholder"
    assert.equal(holderConfigured(), false, "a placeholder is not a holder URL")

    process.env.KV_REST_API_URL = "redis://holder.example"
    assert.equal(holderConfigured(), false, "a non-HTTP URL is not an Upstash REST URL")

    process.env.KV_REST_API_URL = "http://127.0.0.1:8079"
    assert.equal(holderConfigured(), true, "the local REST shim must be accepted")

    process.env.KV_REST_API_URL = "https://holder.example"
    assert.equal(holderConfigured(), true, "an HTTPS Upstash URL must be accepted")

    delete process.env.KV_REST_API_TOKEN
    assert.equal(holderConfigured(), false, "the holder token is required")
  } finally {
    if (originalUrl === undefined) delete process.env.KV_REST_API_URL
    else process.env.KV_REST_API_URL = originalUrl

    if (originalToken === undefined) delete process.env.KV_REST_API_TOKEN
    else process.env.KV_REST_API_TOKEN = originalToken
  }

  console.log("PASS  holder configuration accepts only HTTP(S) URLs with a token")
}

console.log("\nAll checks passed.")
