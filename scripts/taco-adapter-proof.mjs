/**
 * Proves the TACo adapter (lib/key-release/taco.ts) offline, with the real
 * `@nucypher/taco` package replaced by an injected fake.
 *
 * `@nucypher/taco`'s browser build cannot be imported by plain Node — see the
 * module doc in lib/key-release/taco.ts — so this proof never lets that
 * happen. It imports the real adapter module (its own top-level imports are
 * Node-safe: `ethers` and `../arkiv`), then passes a fake `sdk` through the
 * adapter's own test-only injection point instead of ever calling the
 * dynamic `import("@nucypher/taco")` inside it.
 *
 * What this proves:
 *   - two provider instances share one `initialize()` call, not one each;
 *   - `protect` builds the exact `JsonRpcCondition` Task 2's
 *     `buildArkivGrantQuery` describes, and serializes with `toBytes()`;
 *   - `release` deserializes with `ThresholdMessageKit.fromBytes()` and calls
 *     `decrypt` with no caller-selected condition and no historical block;
 *   - a failed decrypt surfaces as `TacoUnavailableError`, never as a leaked
 *     share;
 *   - `probeTacoInfrastructure` classifies a failure by the stage that
 *     actually failed, and never reports "available" for one.
 */
import assert from "node:assert/strict"
import http from "node:http"
import { registerHooks } from "node:module"

// Same extensionless-.ts resolution rule the rest of this repo's proofs use
// for Node's strip-types runner (see scripts/arkiv-taco-condition-proof.mjs).
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

// lib/arkiv.ts reads this at import time.
process.env.NEXT_PUBLIC_ARKIV_RPC ??= "https://rpc.tiramisu.db-chain.testnet.arkiv.network"

const { buildArkivGrantQuery } = await import("../lib/arkiv.ts")
const {
  createTacoKeyReleaseProvider,
  probeTacoInfrastructure,
  TacoUnavailableError,
  __resetTacoAdapterStateForTests,
} = await import("../lib/key-release/taco.ts")

const CONFIG = {
  enabled: true,
  domain: "lynx",
  ritualId: 27,
  coordinationRpc: "https://coordination.invalid",
}

const SIGNER_KEY = `0x${"7".repeat(64)}`

const binding = {
  grantId: `0x${"34".repeat(32)}`,
  owner: `0x${"12".repeat(20)}`,
  expiresBlock: 900n,
  ref: "ab".repeat(32),
}

class FakeThresholdMessageKit {
  constructor(bytes) {
    this.bytes = bytes
  }
  toBytes() {
    return this.bytes
  }
}

function xorTransform(bytes) {
  return Uint8Array.from(bytes, (b) => b ^ 0xa5)
}

function makeFakeSdk(overrides = {}) {
  const calls = {
    initialize: 0,
    jsonRpcConditions: [],
    encrypt: [],
    decrypt: [],
    fromBytes: [],
  }
  const sdk = {
    async initialize() {
      calls.initialize++
    },
    domains: { DEVNET: "lynx", TESTNET: "tapir", MAINNET: "mainnet" },
    async getPorterUris(domain) {
      return [`https://porter-${domain}.example`]
    },
    conditions: {
      base: {
        jsonRpc: {
          JsonRpcCondition: class {
            constructor(props) {
              this.props = props
              calls.jsonRpcConditions.push(props)
            }
          },
        },
      },
    },
    ThresholdMessageKit: {
      fromBytes(bytes) {
        calls.fromBytes.push(bytes)
        return new FakeThresholdMessageKit(bytes)
      },
    },
    async encrypt(_provider, domain, message, condition, ritualId, authSigner) {
      calls.encrypt.push({ domain, message, condition, ritualId, authSigner })
      return new FakeThresholdMessageKit(xorTransform(message))
    },
    async decrypt(_provider, domain, messageKit, context, porterUris) {
      calls.decrypt.push({ domain, messageKit, context, porterUris })
      if (overrides.decryptImpl) return overrides.decryptImpl(messageKit)
      return xorTransform(messageKit.bytes)
    },
    ...overrides.sdk,
  }
  return { sdk, calls }
}

// --- initialization is shared across provider instances ---------------------
{
  __resetTacoAdapterStateForTests()
  const { sdk, calls } = makeFakeSdk()
  const providerA = createTacoKeyReleaseProvider({ sdk, config: CONFIG, signerPrivateKey: SIGNER_KEY })
  const providerB = createTacoKeyReleaseProvider({ sdk, config: CONFIG, signerPrivateKey: SIGNER_KEY })
  const heldShare = new Uint8Array(32).fill(7)
  const protectedA = await providerA.protect(heldShare, binding)
  await providerB.release(protectedA, binding)
  assert.equal(calls.initialize, 1, "initialize() must be called once across two provider instances, not once each")
  console.log("PASS  initialization is shared across provider instances")
}

// --- protect() builds the exact Task 2 condition and serializes with toBytes() ---
{
  __resetTacoAdapterStateForTests()
  const { sdk, calls } = makeFakeSdk()
  const provider = createTacoKeyReleaseProvider({ sdk, config: CONFIG, signerPrivateKey: SIGNER_KEY })
  const heldShare = new Uint8Array(32).fill(9)
  const protectedBytes = await provider.protect(heldShare, binding)

  const expected = buildArkivGrantQuery(binding)
  assert.equal(calls.jsonRpcConditions.length, 1)
  const condition = calls.jsonRpcConditions[0]
  assert.equal(condition.endpoint, expected.endpoint)
  assert.equal(condition.method, expected.method)
  assert.deepEqual(condition.params, expected.params)
  assert.equal(condition.query, expected.query)
  assert.equal(condition.returnValueTest.comparator, "==")
  assert.equal(condition.returnValueTest.value, expected.expected)
  assert.equal("atBlock" in condition.params[1], false, "a release condition must never pin a past block")

  assert.deepEqual(protectedBytes, xorTransform(heldShare), "protect() must return messageKit.toBytes()")
  assert.equal(calls.encrypt[0].ritualId, CONFIG.ritualId)
  assert.equal(calls.encrypt[0].domain, sdk.domains.DEVNET)
  console.log("PASS  protect() builds the exact Task 2 condition and returns toBytes()")
}

// --- release() deserializes with fromBytes() and calls decrypt with no condition/history ---
{
  __resetTacoAdapterStateForTests()
  const { sdk, calls } = makeFakeSdk()
  const provider = createTacoKeyReleaseProvider({ sdk, config: CONFIG, signerPrivateKey: SIGNER_KEY })
  const heldShare = new Uint8Array(32).fill(3)
  const protectedBytes = await provider.protect(heldShare, binding)
  const released = await provider.release(protectedBytes, binding)

  assert.equal(calls.fromBytes.length, 1)
  assert.deepEqual(calls.fromBytes[0], protectedBytes, "release() must deserialize with ThresholdMessageKit.fromBytes()")
  assert.equal(calls.decrypt.length, 1)
  assert.equal(calls.decrypt[0].context, undefined, "release() must not pass a caller-selected condition/context")
  assert.equal(calls.decrypt[0].porterUris, undefined)
  assert.deepEqual(released, heldShare, "the round trip must recover the original held share")
  console.log("PASS  release() deserializes with fromBytes() and calls decrypt with no condition or history")
}

// --- a failed decrypt is a typed, unavailable error — never a leaked share ---
{
  __resetTacoAdapterStateForTests()
  const { sdk } = makeFakeSdk({
    decryptImpl() {
      throw new Error("Threshold of responses not met; TACo decryption failed with errors: {}")
    },
  })
  const provider = createTacoKeyReleaseProvider({ sdk, config: CONFIG, signerPrivateKey: SIGNER_KEY })
  const heldShare = new Uint8Array(32).fill(5)
  const protectedBytes = await provider.protect(heldShare, binding)

  let caught
  try {
    await provider.release(protectedBytes, binding)
    assert.fail("release() must reject when decrypt fails")
  } catch (error) {
    caught = error
  }
  assert.ok(caught instanceof TacoUnavailableError)
  assert.equal(caught.stage, "decrypt")
  const shareHex = Buffer.from(heldShare).toString("hex")
  assert.ok(!caught.message.includes(shareHex), "the error must never contain the held share")
  assert.ok(!("heldShare" in caught) && !("share" in caught), "the error must carry no share field")
  console.log("PASS  a failed decrypt is a typed unavailable error, never a leaked share")
}

// --- protect() refuses without a signer, and when disabled --------------------
{
  __resetTacoAdapterStateForTests()
  const { sdk } = makeFakeSdk()
  const noSigner = createTacoKeyReleaseProvider({ sdk, config: CONFIG })
  await assert.rejects(() => noSigner.protect(new Uint8Array(32), binding), TacoUnavailableError)

  const disabled = createTacoKeyReleaseProvider({ sdk, config: { ...CONFIG, enabled: false }, signerPrivateKey: SIGNER_KEY })
  await assert.rejects(() => disabled.protect(new Uint8Array(32), binding), TacoUnavailableError)
  await assert.rejects(() => disabled.release(new Uint8Array(32), binding), TacoUnavailableError)
  console.log("PASS  protect() refuses without a signer, and both calls refuse when TACo is disabled")
}

// --- probeTacoInfrastructure classifies the stage that actually failed --------
{
  __resetTacoAdapterStateForTests()
  const { sdk: initFailingSdk } = makeFakeSdk()
  initFailingSdk.initialize = async () => {
    throw new Error("wasm init failed")
  }
  const initResult = await probeTacoInfrastructure({ sdk: initFailingSdk, config: CONFIG })
  assert.equal(initResult.status, "unavailable")
  assert.equal(initResult.stage, "initialize")
  console.log("PASS  probe classifies an initialize failure as stage \"initialize\"")
}

{
  __resetTacoAdapterStateForTests()
  const disabledResult = await probeTacoInfrastructure({ config: { ...CONFIG, enabled: false } })
  assert.equal(disabledResult.status, "unavailable")
  assert.equal(disabledResult.stage, "initialize")
  console.log("PASS  probe reports disabled TACo as unavailable, never as available")
}

{
  __resetTacoAdapterStateForTests()
  const { sdk } = makeFakeSdk()
  // Nothing listens here: a deterministic, offline "coordination unreachable" case.
  const unreachableResult = await probeTacoInfrastructure({ sdk, config: { ...CONFIG, coordinationRpc: "https://127.0.0.1:65535" } })
  assert.equal(unreachableResult.status, "unavailable")
  assert.equal(unreachableResult.stage, "coordination")
  console.log("PASS  probe classifies an unreachable coordination RPC as stage \"coordination\"")
}

// --- a reachable RPC but a failing ritual is classified as stage "encrypt" ---
{
  __resetTacoAdapterStateForTests()
  const server = http.createServer((req, res) => {
    let body = ""
    req.on("data", (chunk) => (body += chunk))
    req.on("end", () => {
      const request = JSON.parse(body)
      const result = request.method === "eth_chainId" ? "0x1" : request.method === "net_version" ? "1" : null
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }))
    })
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const { port } = server.address()

  try {
    const { sdk } = makeFakeSdk()
    sdk.encrypt = async () => {
      throw new Error("Ritual initialization failed. Ritual id 27 is in state NON_INITIATED")
    }
    const result = await probeTacoInfrastructure({ sdk, config: { ...CONFIG, coordinationRpc: `http://127.0.0.1:${port}` } })
    assert.equal(result.status, "unavailable")
    assert.equal(result.stage, "encrypt")
    console.log("PASS  probe classifies a reachable RPC with no active ritual as stage \"encrypt\"")

    __resetTacoAdapterStateForTests()
    const { sdk: porterFailingSdk } = makeFakeSdk()
    porterFailingSdk.getPorterUris = async () => {
      throw new Error("No default Porter URI found for domain: lynx")
    }
    const porterResult = await probeTacoInfrastructure({
      sdk: porterFailingSdk,
      config: { ...CONFIG, coordinationRpc: `http://127.0.0.1:${port}` },
    })
    assert.equal(porterResult.status, "unavailable")
    assert.equal(porterResult.stage, "porter")
    console.log("PASS  probe classifies a resolvable ritual with no Porter cohort as stage \"porter\"")

    __resetTacoAdapterStateForTests()
    const { sdk: healthySdk } = makeFakeSdk()
    const availableResult = await probeTacoInfrastructure({
      sdk: healthySdk,
      config: { ...CONFIG, coordinationRpc: `http://127.0.0.1:${port}` },
    })
    assert.deepEqual(availableResult, { status: "available", domain: "lynx", ritualId: 27 })
    console.log("PASS  probe reports \"available\" only once every stage actually succeeds")
  } finally {
    server.close()
  }
}

console.log("\nAll checks passed.")

// ethers' JsonRpcProvider leaves background polling handles open even when
// every call through it was faked; without this the process never exits.
process.exit(0)
