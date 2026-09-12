import assert from "node:assert/strict"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { privateKeyToAccount } from "viem/accounts"
import {
  authoriseMcpCapability,
  callMcpTool,
  mintMcpCapability,
  validateMcpConsentRequest,
} from "../lib/mcp.ts"
import { createHealthSendMcpServer } from "../lib/mcp-protocol.ts"
import { signedMessage } from "../lib/revoke.ts"

const account = privateKeyToAccount(`0x${"11".repeat(32)}`)
const entityOne = `0x${"01".repeat(32)}`
const entityTwo = `0x${"02".repeat(32)}`
const now = Math.floor(Date.now() / 1000)

const scopedShare = {
  v: 1,
  kind: "healthsend-scoped-share",
  records: [
    {
      id: "panel-1",
      kind: "blood-panel",
      takenOn: "2026-09-01",
      markers: [
        {
          id: "glucose",
          name: "Glucose",
          value: 91,
          unit: "mg/dL",
          referenceRange: { min: 70, max: 99 },
          flaggedAtImport: false,
        },
      ],
    },
    {
      id: "sleep-1",
      kind: "wearable-series",
      metric: "Sleep duration",
      unit: "hours",
      range: { from: "2026-09-01", through: "2026-09-03" },
      target: 8,
      values: [
        { date: "2026-09-01", value: 7.4 },
        { date: "2026-09-02", value: 8.1 },
        { date: "2026-09-03", value: 7.8 },
      ],
    },
  ],
}

function fakeDeps(entityKey, randomByte = 7) {
  const grants = new Map([
    [entityKey, { sender: account.address, expiresAt: now + 60 * 60 }],
  ])
  const ciphertexts = new Map()
  const claimedMints = new Set()
  let grantReads = 0

  return {
    grants,
    ciphertexts,
    grantReads: () => grantReads,
    deps: {
      now: () => now,
      randomBytes: (length) => new Uint8Array(length).fill(randomByte),
      getGrant: async (key) => {
        grantReads += 1
        return grants.get(key) ?? null
      },
      isRevoked: async () => false,
      putCiphertext: async (capabilityId, mintId, value) => {
        if (claimedMints.has(mintId)) return "replayed"
        if (ciphertexts.has(capabilityId)) return "collision"
        ciphertexts.set(capabilityId, value)
        claimedMints.add(mintId)
        return "stored"
      },
      getCiphertext: async (capabilityId) => ciphertexts.get(capabilityId) ?? null,
    },
  }
}

async function consent(action, entityKey, share = scopedShare) {
  const signature = await account.signMessage({
    message: signedMessage(action, entityKey, now),
  })
  const request = validateMcpConsentRequest({
    entityKey,
    signature,
    timestamp: now,
    scopedShare: share,
  })
  assert(request, "fixture must be a valid MCP consent")
  return request
}

// A signature from another action namespace recovers a different signer and
// cannot touch protected storage.
{
  const harness = fakeDeps(entityOne)
  const wrongAction = await consent("revoke", entityOne)
  const result = await mintMcpCapability(wrongAction, harness.deps)
  assert.equal(result.ok, false)
  assert.equal(result.code, "not_authorised")
  assert.equal(harness.ciphertexts.size, 0)
}

const harness = fakeDeps(entityOne)
const validConsent = await consent("mcp", entityOne)
assert.equal(
  validateMcpConsentRequest({ ...validConsent, archive: { records: scopedShare.records } }),
  null,
  "consent must reject an archive alongside the pre-scoped share",
)
const minted = await mintMcpCapability(validConsent, harness.deps)
assert(minted.ok, "valid sender consent must mint a capability")

// Signed consent is single-use: replay cannot mint or recover another bearer.
{
  const replay = await mintMcpCapability(validConsent, harness.deps)
  assert.equal(replay.ok, false)
  assert.equal(replay.code, "signature_already_used")
}

// Redis-equivalent stored material is public grant routing metadata plus
// ciphertext only: no sender, measurements, record labels, or bearer key is
// persisted alongside it.
{
  assert.equal(harness.ciphertexts.size, 1)
  const persisted = JSON.stringify([...harness.ciphertexts.entries()])
  assert(!persisted.toLowerCase().includes(account.address.toLowerCase()))
  assert(!persisted.includes("Glucose"))
  assert(!persisted.includes("panel-1"))
  assert(!persisted.includes(minted.capabilityToken))
}

// Every successful tool invocation performs a fresh Arkiv read and preserves
// units/reference ranges for the blood shape.
{
  const before = harness.grantReads()
  const result = await callMcpTool(
    minted.capabilityToken,
    "get_blood_panels",
    { recordId: "panel-1" },
    harness.deps,
  )
  assert(result.ok)
  assert.equal(harness.grantReads(), before + 2)
  const marker = result.data.panels[0].markers[0]
  assert.equal(marker.unit, "mg/dL")
  assert.deepEqual(marker.referenceRange, { min: 70, max: 99 })
}

// A record that was never uploaded is refused explicitly, rather than becoming
// an empty successful result.
{
  const result = await callMcpTool(
    minted.capabilityToken,
    "get_blood_panels",
    { recordId: "panel-outside-grant" },
    harness.deps,
  )
  assert.equal(result.ok, false)
  assert.equal(result.code, "out_of_scope")
  assert.match(result.error, /^Refused:/)
}

// Asking for an entire record kind that the grant never included is also an
// explicit refusal; it must not look like a successful empty data set.
{
  const wearableOnlyHarness = fakeDeps(entityTwo, 19)
  const wearableOnly = {
    ...scopedShare,
    records: scopedShare.records.filter((record) => record.kind === "wearable-series"),
  }
  const wearableOnlyMint = await mintMcpCapability(
    await consent("mcp", entityTwo, wearableOnly),
    wearableOnlyHarness.deps,
  )
  assert(wearableOnlyMint.ok)
  const result = await callMcpTool(
    wearableOnlyMint.capabilityToken,
    "get_blood_panels",
    {},
    wearableOnlyHarness.deps,
  )
  assert.equal(result.ok, false)
  assert.equal(result.code, "out_of_scope")
  assert.match(result.error, /^Refused:/)
}

// An otherwise valid bearer is Arkiv-gated even for protocol requests that do
// not decrypt records, such as initialize and tools/list.
{
  const before = harness.grantReads()
  const result = await authoriseMcpCapability(minted.capabilityToken, harness.deps)
  assert(result.ok)
  assert.equal(harness.grantReads(), before + 1)
}

// The wearable shape supports inclusive subranges but refuses widening beyond
// the pre-scoped range.
{
  const inside = await callMcpTool(
    minted.capabilityToken,
    "query_wearable_range",
    { recordId: "sleep-1", from: "2026-09-02", through: "2026-09-03" },
    harness.deps,
  )
  assert(inside.ok)
  assert.deepEqual(
    inside.data.series.values.map((point) => point.date),
    ["2026-09-02", "2026-09-03"],
  )

  const outside = await callMcpTool(
    minted.capabilityToken,
    "query_wearable_range",
    { recordId: "sleep-1", from: "2026-08-31", through: "2026-09-03" },
    harness.deps,
  )
  assert.equal(outside.ok, false)
  assert.equal(outside.code, "out_of_scope")

  const tooWide = await callMcpTool(
    minted.capabilityToken,
    "query_wearable_range",
    { recordId: "sleep-1", from: "2025-01-01", through: "2026-09-03" },
    harness.deps,
  )
  assert.equal(tooWide.ok, false)
  assert.equal(tooWide.code, "request_too_large")
  assert.match(tooWide.error, /^Refused:/)
}

// If the live grant disappears between the pre-decrypt check and the response,
// the second Arkiv read wins and no scoped value is served.
{
  const liveGrant = harness.grants.get(entityOne)
  let reads = 0
  const result = await callMcpTool(
    minted.capabilityToken,
    "get_blood_panels",
    { recordId: "panel-1" },
    {
      ...harness.deps,
      getGrant: async () => {
        reads += 1
        return reads === 1 ? liveGrant : null
      },
    },
  )
  assert.equal(reads, 2)
  assert.equal(result.ok, false)
  assert.equal(result.code, "grant_expired")
  assert(!JSON.stringify(result).includes("Glucose"))
}

// A revoke racing the request is checked again after decryption as well.
{
  let revokeChecks = 0
  const result = await callMcpTool(
    minted.capabilityToken,
    "get_blood_panels",
    { recordId: "panel-1" },
    {
      ...harness.deps,
      isRevoked: async () => {
        revokeChecks += 1
        return revokeChecks === 2
      },
    },
  )
  assert.equal(revokeChecks, 2)
  assert.equal(result.ok, false)
  assert.equal(result.code, "grant_expired")
  assert(!JSON.stringify(result).includes("Glucose"))
}

// Removing the entity from the live Arkiv dependency makes an already-minted
// bearer serve no data, even though its ciphertext still exists in the store.
{
  const [capabilityId, encrypted] = [...harness.ciphertexts.entries()][0]
  // If expiry were checked after decrypt, this deliberately invalid ciphertext
  // would produce invalid_capability instead of the authoritative Arkiv result.
  harness.ciphertexts.set(capabilityId, { ...encrypted, ciphertext: "not-base64url!" })
  harness.grants.delete(entityOne)
  const protocolAccess = await authoriseMcpCapability(minted.capabilityToken, harness.deps)
  assert.equal(protocolAccess.ok, false)
  assert.equal(protocolAccess.code, "grant_expired")
  const result = await callMcpTool(
    minted.capabilityToken,
    "get_blood_panels",
    { recordId: "panel-1" },
    harness.deps,
  )
  assert.equal(result.ok, false)
  assert.equal(result.code, "grant_expired")
  assert(!JSON.stringify(result).includes("Glucose"))
  assert(!JSON.stringify(result).includes("91"))
}

// Hold the capability key constant across isolated stores: adding the grant key
// to the pseudonym derivation still separates two grants from the same sender.
{
  const first = fakeDeps(entityOne, 23)
  const second = fakeDeps(entityTwo, 23)
  const firstMint = await mintMcpCapability(await consent("mcp", entityOne), first.deps)
  const secondMint = await mintMcpCapability(await consent("mcp", entityTwo), second.deps)
  assert(firstMint.ok && secondMint.ok)
  assert.equal(firstMint.capabilityToken, secondMint.capabilityToken)
  assert.notEqual(firstMint.pseudonym, secondMint.pseudonym)
}

// The official Web-standard transport handles stateless initialize, notification,
// discovery, and tool execution across fresh request-local server instances.
{
  const protocolHarness = fakeDeps(entityOne, 31)
  const protocolMint = await mintMcpCapability(
    await consent("mcp", entityOne),
    protocolHarness.deps,
  )
  assert(protocolMint.ok)

  async function post(message, accept = "application/json, text/event-stream") {
    const server = createHealthSendMcpServer(protocolMint.capabilityToken, protocolHarness.deps)
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    })
    await server.connect(transport)
    const response = await transport.handleRequest(
      new Request("https://healthsend.example/api/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept,
        },
        body: JSON.stringify(message),
      }),
      { parsedBody: message },
    )
    await server.close()
    return { response, body: await response.text() }
  }

  const initialized = await post({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "healthsend-proof", version: "1.0.0" },
    },
  })
  assert.equal(initialized.response.status, 200)
  assert.equal(JSON.parse(initialized.body).result.protocolVersion, "2025-11-25")

  const notification = await post({
    jsonrpc: "2.0",
    method: "notifications/initialized",
    params: {},
  })
  assert.equal(notification.response.status, 202)
  assert.equal(notification.body, "")

  const listed = await post({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
  const toolNames = JSON.parse(listed.body).result.tools.map((tool) => tool.name)
  assert.deepEqual(toolNames, [
    "get_grant_scope",
    "get_blood_panels",
    "query_wearable_range",
  ])

  const called = await post({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "get_blood_panels", arguments: { recordId: "panel-1" } },
  })
  const callResult = JSON.parse(called.body).result
  assert.equal(callResult.isError, undefined)
  assert.equal(callResult.structuredContent.panels[0].markers[0].unit, "mg/dL")

  const unacceptable = await post(
    { jsonrpc: "2.0", id: 4, method: "tools/list", params: {} },
    "application/json",
  )
  assert.equal(unacceptable.response.status, 406)
}

console.log(
  "MCP proof passed: transport, live expiry, scope refusal, action separation, and pseudonyms hold.",
)
