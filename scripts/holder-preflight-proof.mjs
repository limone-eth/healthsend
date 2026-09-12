/**
 * Proves the send holder preflight offline: no Redis, no chain, no Swarm.
 *
 * `createSend` takes narrow injected dependencies for this proof. A failed
 * holder request must stop the send before identity, upload, or grant work.
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
