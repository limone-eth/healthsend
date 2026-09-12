/**
 * Proves "When she looked" offline: no Redis, no chain, no network.
 *
 *   resolveUnlock(entityKey, authKey, { getGrant, getShare, recordAccess })  — lib/unlock.ts
 *   readAccessLog(request, { getGrant, getAccessLog })  — lib/access-log.ts
 *   recordAccessWith / getAccessLogWith / tombstoneShareWith / putShareWith  — lib/holder-store.ts
 *
 * The first two take their Arkiv and holder access as injected dependencies,
 * so the property under test there is the recording hook and the sender-only
 * read — not Redis or the RPC. The holder-store functions are exercised
 * directly, against `fakeRedis()` below, to prove the atomic-script behaviour
 * without a real Upstash instance: a fake that can fail one `eval()` call
 * outright is enough to model an HTTP request that never reaches the server,
 * which is the only realistic way a real multi-command write used to land
 * half-applied.
 *
 * Every test that touches the access log — recording and reading — shares one
 * `fakeRedis()` instance as its backing store, so the read side is proven to
 * see exactly what the write side stored, not a hand-built stand-in.
 */
import assert from "node:assert/strict"
import { webcrypto } from "node:crypto"
import { lauxlib, lua, lualib, to_jsstring, to_luastring } from "fengari"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"

const { resolveUnlock } = await import("../lib/unlock.ts")
const { readAccessLog, accessLogMessage } = await import("../lib/access-log.ts")
const {
  recordAccessWith,
  getAccessLogWith,
  tombstoneShareWith,
  putShareWith,
  PUT_SHARE_SCRIPT,
} = await import("../lib/holder-store.ts")

const ENTITY_KEY = "0x" + "22".repeat(32)
const shareKeyName = (entityKey) => `healthsend:share:${entityKey.toLowerCase()}`
const accessLogKeyName = (entityKey) => `healthsend:access:${entityKey.toLowerCase()}`
const tombstoneKeyName = (entityKey) => `healthsend:revoked:${entityKey.toLowerCase()}`

const sender = privateKeyToAccount(generatePrivateKey())
const attacker = privateKeyToAccount(generatePrivateKey())

async function commitmentFor(authKeyBytes) {
  const digest = await webcrypto.subtle.digest("SHA-256", authKeyBytes)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")
}

function toBase64Url(bytes) {
  return Buffer.from(bytes).toString("base64url")
}

async function validAuthKey() {
  const bytes = webcrypto.getRandomValues(new Uint8Array(32))
  return { authKey: toBase64Url(bytes), commitment: await commitmentFor(bytes) }
}

async function runLua(script, keys, args, redisCall) {
  const state = lauxlib.luaL_newstate()
  lualib.luaL_openlibs(state)

  const setArray = (name, values) => {
    lua.lua_newtable(state)
    values.forEach((value, index) => {
      lua.lua_pushinteger(state, index + 1)
      lua.lua_pushstring(state, to_luastring(String(value)))
      lua.lua_settable(state, -3)
    })
    lua.lua_setglobal(state, to_luastring(name))
  }

  setArray("KEYS", keys)
  setArray("ARGV", args)

  lua.lua_newtable(state)
  lua.lua_pushcfunction(state, (luaState) => {
    const count = lua.lua_gettop(luaState)
    const command = to_jsstring(lua.lua_tostring(luaState, 1))
    const commandArgs = []
    for (let index = 2; index <= count; index++) {
      commandArgs.push(to_jsstring(lua.lua_tostring(luaState, index)))
    }

    const result = redisCall(command, commandArgs)
    if (result === false || result === null || result === undefined) {
      lua.lua_pushboolean(luaState, false)
    } else if (typeof result === "number") {
      lua.lua_pushinteger(luaState, result)
    } else {
      lua.lua_pushstring(luaState, to_luastring(String(result)))
    }
    return 1
  })
  lua.lua_setfield(state, -2, to_luastring("call"))
  lua.lua_setglobal(state, to_luastring("redis"))

  const loadStatus = lauxlib.luaL_loadstring(state, to_luastring(script))
  if (loadStatus !== lua.LUA_OK) {
    throw new Error(`Lua load failed: ${to_jsstring(lua.lua_tostring(state, -1))}`)
  }
  const runStatus = lua.lua_pcall(state, 0, 1, 0)
  if (runStatus !== lua.LUA_OK) {
    throw new Error(`Lua execution failed: ${to_jsstring(lua.lua_tostring(state, -1))}`)
  }

  const resultType = lua.lua_type(state, -1)
  if (resultType === lua.LUA_TNUMBER) return lua.lua_tonumber(state, -1)
  if (resultType === lua.LUA_TBOOLEAN) return lua.lua_toboolean(state, -1)
  if (resultType === lua.LUA_TSTRING) return to_jsstring(lua.lua_tostring(state, -1))
  return null
}

/**
 * A minimal in-memory Redis command surface. Fengari executes the exact Lua
 * source passed to `eval()`, and `redis.call` reaches the command handler here.
 * The fake supplies storage only; it does not reimplement either script's
 * branches or command order in JavaScript.
 *
 * `failNextEval()` models an HTTP request that never reaches Redis. The call
 * fails before Fengari runs the script, so no command can mutate the store.
 */
function fakeRedis() {
  const strings = new Map() // key -> value (TTL bookkeeping omitted; not what these tests check)
  const stringTtls = new Map() // key -> ex seconds, for asserting a TTL was set
  const lists = new Map() // key -> values[]
  const listTtls = new Map() // key -> ex seconds
  let evalShouldFail = false

  const keyExists = (key) => strings.has(key) || lists.has(key)

  const call = (rawCommand, args) => {
    const command = rawCommand.toUpperCase()
    if (command === "RPUSH") {
      const [key, ...values] = args
      const list = lists.get(key) ?? []
      list.push(...values.map(Number))
      lists.set(key, list)
      return list.length
    }
    if (command === "EXPIRE") {
      const [key, ttl] = args
      if (!keyExists(key)) return 0
      if (strings.has(key)) stringTtls.set(key, Number(ttl))
      if (lists.has(key)) listTtls.set(key, Number(ttl))
      return 1
    }
    if (command === "DEL") {
      let deleted = 0
      for (const key of args) {
        if (strings.delete(key)) deleted++
        if (lists.delete(key)) deleted++
        stringTtls.delete(key)
        listTtls.delete(key)
      }
      return deleted
    }
    if (command === "SET") {
      const [key, value, ...options] = args
      const nx = options.some((option) => option.toUpperCase() === "NX")
      if (nx && keyExists(key)) return false
      strings.set(key, value)
      const exIndex = options.findIndex((option) => option.toUpperCase() === "EX")
      if (exIndex >= 0) stringTtls.set(key, Number(options[exIndex + 1]))
      return "OK"
    }
    if (command === "EXISTS") {
      return args.reduce((count, key) => count + Number(keyExists(key)), 0)
    }
    throw new Error(`fakeRedis: unsupported command ${rawCommand}`)
  }

  return {
    async eval(script, keys, args) {
      if (evalShouldFail) {
        evalShouldFail = false
        throw new Error("simulated: the request never reached Redis")
      }
      return runLua(script, keys, args, call)
    },
    async set(key, value, opts) {
      strings.set(key, value)
      stringTtls.set(key, opts?.ex)
      return "OK"
    },
    async get(key) {
      return strings.has(key) ? strings.get(key) : null
    },
    async lrange(key) {
      return lists.get(key) ?? []
    },
    async exists(key) {
      return strings.has(key) ? 1 : 0
    },
    // --- test-only hooks, not part of the Redis surface -----------------
    failNextEval() {
      evalShouldFail = true
    },
    hasTTL(logKey) {
      return listTtls.has(logKey) && Number.isFinite(listTtls.get(logKey))
    },
    listExists(logKey) {
      return lists.has(logKey)
    },
  }
}

// --- a served unlock records exactly one event, and the read side sees it ----
{
  const now = Math.floor(Date.now() / 1000)
  const { authKey, commitment } = await validAuthKey()
  const grant = { sender: sender.address, authCommitment: commitment, expiresAt: now + 3600 }
  const stored = { share: "held-share", commitment }
  const store = fakeRedis()
  const unlockDeps = {
    getGrant: async () => grant,
    getShare: async () => stored,
    recordAccess: (entityKey, at, expiresAt) => recordAccessWith(store, entityKey, at, expiresAt),
  }

  const result = await resolveUnlock(ENTITY_KEY, authKey, unlockDeps)
  assert.equal(result.ok, true, "a correct auth key must be served")

  // Read through the exact same path the sender-facing route uses — the read
  // side sees what the write side actually stored, not a parallel fixture.
  const logResult = await getAccessLogWith(store, ENTITY_KEY)
  assert.equal(logResult.opened.length, 1, "a served unlock must record exactly one event")
  assert.ok(Number.isFinite(logResult.opened[0]), "the recorded event must carry a timestamp")
  assert.equal(logResult.reliable, true, "a clean write must read back as reliable")
  console.log("PASS  a served unlock records one event, and the read side sees it")
}

// --- a rejected unlock records none -------------------------------------------
{
  const now = Math.floor(Date.now() / 1000)
  const { commitment } = await validAuthKey()
  const { authKey: wrongAuthKey } = await validAuthKey()
  const grant = { sender: sender.address, authCommitment: commitment, expiresAt: now + 3600 }
  const stored = { share: "held-share", commitment }
  const store = fakeRedis()
  const deps = {
    getGrant: async () => grant,
    getShare: async () => stored,
    recordAccess: (entityKey, at, expiresAt) => recordAccessWith(store, entityKey, at, expiresAt),
  }

  const result = await resolveUnlock(ENTITY_KEY, wrongAuthKey, deps)

  assert.equal(result.ok, false)
  assert.equal(result.status, 403)
  assert.equal((await getAccessLogWith(store, ENTITY_KEY)).opened.length, 0, "a rejected unlock must record nothing")
  console.log("PASS  a rejected unlock records none")
}

// --- an expired grant records nothing either ----------------------------------
{
  const { authKey } = await validAuthKey()
  const store = fakeRedis()
  const deps = {
    getGrant: async () => null,
    getShare: async () => {
      throw new Error("must not be reached once the grant is gone")
    },
    recordAccess: (entityKey, at, expiresAt) => recordAccessWith(store, entityKey, at, expiresAt),
  }

  const result = await resolveUnlock(ENTITY_KEY, authKey, deps)

  assert.equal(result.ok, false)
  assert.equal(result.status, 410)
  assert.equal((await getAccessLogWith(store, ENTITY_KEY)).opened.length, 0, "an expired grant must record nothing")
  console.log("PASS  an expired grant records nothing")
}

// --- the sender can read the record, exactly as the write side stored it -----
{
  const now = Math.floor(Date.now() / 1000)
  const grant = { sender: sender.address }
  const store = fakeRedis()
  await recordAccessWith(store, ENTITY_KEY, now - 100, now + 3500)
  await recordAccessWith(store, ENTITY_KEY, now - 10, now + 3500)
  const deps = { getGrant: async () => grant, getAccessLog: (entityKey) => getAccessLogWith(store, entityKey) }

  const signature = await sender.signMessage({ message: accessLogMessage(ENTITY_KEY, now) })
  const result = await readAccessLog({ entityKey: ENTITY_KEY, signature, timestamp: now }, deps)

  assert.equal(result.ok, true, "the sender must be able to read the record")
  assert.deepEqual(result.opened, [now - 100, now - 10])
  assert.equal(result.reliable, true)
  console.log("PASS  the sender can read the record")
}

// --- a different key cannot ----------------------------------------------------
{
  const now = Math.floor(Date.now() / 1000)
  const grant = { sender: sender.address }
  let read = false
  const deps = {
    getGrant: async () => grant,
    getAccessLog: async () => {
      read = true
      return { opened: [now], reliable: true }
    },
  }

  const signature = await attacker.signMessage({ message: accessLogMessage(ENTITY_KEY, now) })
  const result = await readAccessLog({ entityKey: ENTITY_KEY, signature, timestamp: now }, deps)

  assert.equal(result.ok, false)
  assert.equal(result.status, 403)
  assert.ok(!read, "a signature from any other key must never reach the stored record")
  console.log("PASS  a different key cannot read the record, and never touches storage")
}

// --- a revoke signature does not authorise reading the log ---------------------
{
  const now = Math.floor(Date.now() / 1000)
  const grant = { sender: sender.address }
  let read = false
  const deps = {
    getGrant: async () => grant,
    getAccessLog: async () => {
      read = true
      return { opened: [now], reliable: true }
    },
  }

  // A real signature from the real sender — but signed for "revoke", not
  // "access-log". Recovery over the wrong message yields a different address,
  // so the domain prefix must stop it from crossing over.
  const { revokeMessage } = await import("../lib/revoke.ts")
  const signature = await sender.signMessage({ message: revokeMessage(ENTITY_KEY, now) })
  const result = await readAccessLog({ entityKey: ENTITY_KEY, signature, timestamp: now }, deps)

  assert.equal(result.ok, false)
  assert.equal(result.status, 403, "a signature made for a different action must not authorise the read")
  assert.ok(!read, "an unauthorised read must never touch the stored record")
  console.log("PASS  a signature made for another action does not authorise the read")
}

// --- a record-write failure still serves the share ------------------------------
{
  const now = Math.floor(Date.now() / 1000)
  const { authKey, commitment } = await validAuthKey()
  const grant = { sender: sender.address, authCommitment: commitment, expiresAt: now + 3600 }
  const stored = { share: "held-share", commitment }
  const deps = {
    getGrant: async () => grant,
    getShare: async () => stored,
    recordAccess: async () => {
      throw new Error("Redis is down")
    },
  }

  const result = await resolveUnlock(ENTITY_KEY, authKey, deps)

  assert.equal(result.ok, true, "a bookkeeping failure must not fail the unlock")
  assert.equal(result.share, "held-share")
  console.log("PASS  a record-write failure still serves the share")
}

// --- a rejected EXPIRE must not leave a list without a TTL --------------------
{
  const store = fakeRedis()
  const logKey = accessLogKeyName(ENTITY_KEY)

  // A normal write succeeds and carries a TTL.
  await recordAccessWith(store, ENTITY_KEY, 1000, 1000 + 3600)
  assert.ok(store.hasTTL(logKey), "a normal write must carry a TTL")

  // The next write's underlying call fails outright — the same failure mode
  // that, back when RPUSH and EXPIRE were two separate HTTP calls, could
  // leave the first applied and the second dropped.
  store.failNextEval()
  await assert.rejects(
    () => recordAccessWith(store, ENTITY_KEY, 2000, 2000 + 3600),
    "a failed write must still surface as a failure to the caller",
  )

  // RPUSH and EXPIRE are one atomic call now: the failed write appended
  // nothing, and the entry from the earlier, successful write still carries
  // its TTL. There is no way to observe one command's effect without the
  // other's.
  const after = await getAccessLogWith(store, ENTITY_KEY)
  assert.deepEqual(after.opened, [1000], "a failed record must not silently append")
  assert.ok(store.hasTTL(logKey), "the log must never be observed without a TTL")
  console.log("PASS  a rejected EXPIRE must not leave a list without a TTL")
}

// --- a dropped record surfaces as unreliable, not a confident empty log -------
{
  const now = Math.floor(Date.now() / 1000)
  const store = fakeRedis()
  const grant = { sender: sender.address }
  const deps = { getGrant: async () => grant, getAccessLog: (entityKey) => getAccessLogWith(store, entityKey) }

  // The write path fails outright. lib/unlock.ts would swallow this so the
  // reader is unaffected — reproduced here as the direct holder-store call
  // the unlock's recordAccess dependency makes.
  store.failNextEval()
  await assert.rejects(() => recordAccessWith(store, ENTITY_KEY, now, now + 3600))

  const signature = await sender.signMessage({ message: accessLogMessage(ENTITY_KEY, now) })
  const result = await readAccessLog({ entityKey: ENTITY_KEY, signature, timestamp: now }, deps)

  assert.equal(result.ok, true)
  assert.deepEqual(result.opened, [], "the dropped write really did leave no entry")
  assert.equal(result.reliable, false, "an empty log after a dropped write must not read as a confident zero")
  console.log("PASS  a dropped record surfaces as unreliable, not a confident 'Not opened yet'")
}

// --- a genuinely empty log — nothing ever dropped — still reads as reliable ---
{
  const now = Math.floor(Date.now() / 1000)
  const store = fakeRedis()
  const grant = { sender: sender.address }
  const deps = { getGrant: async () => grant, getAccessLog: (entityKey) => getAccessLogWith(store, entityKey) }

  const signature = await sender.signMessage({ message: accessLogMessage(ENTITY_KEY, now) })
  const result = await readAccessLog({ entityKey: ENTITY_KEY, signature, timestamp: now }, deps)

  assert.equal(result.ok, true)
  assert.deepEqual(result.opened, [])
  assert.equal(result.reliable, true, "a share that was genuinely never opened must still read as a confident zero")
  console.log("PASS  a genuinely empty log still reads as reliable")
}

// --- a failed tombstone write must not leave a refillable slot ----------------
{
  const store = fakeRedis()
  const shareKey = shareKeyName(ENTITY_KEY)
  const tombKey = tombstoneKeyName(ENTITY_KEY)
  const value = { share: "held-share", commitment: "c".repeat(64) }

  const stored = await putShareWith(store, ENTITY_KEY, value, 3600)
  assert.equal(stored, true, "the legitimate first write must succeed")

  // The tombstone write's underlying call fails outright.
  store.failNextEval()
  await assert.rejects(() => tombstoneShareWith(store, ENTITY_KEY, 3600))

  // Nothing was touched: delete-share, delete-log and set-tombstone are one
  // atomic call now, so a failure cannot free the slot while leaving no
  // tombstone behind — either all three land, or none of them do.
  assert.equal(await store.get(shareKey), JSON.stringify(value), "the share must survive a failed tombstone attempt")
  assert.equal(await store.exists(tombKey), 0, "no tombstone must appear from a failed attempt")

  // And the slot is provably not refillable in the meantime.
  const duringFailure = await putShareWith(store, ENTITY_KEY, { share: "replay", commitment: "d".repeat(64) }, 3600)
  assert.equal(duringFailure, false, "the slot must not become writable just because the tombstone attempt failed")

  // Retrying, as a caller would, closes it for good.
  await tombstoneShareWith(store, ENTITY_KEY, 3600)
  const afterRetry = await putShareWith(store, ENTITY_KEY, { share: "replay", commitment: "d".repeat(64) }, 3600)
  assert.equal(afterRetry, false, "a tombstoned slot must refuse a refill once the retry lands")
  console.log("PASS  a failed tombstone write must not leave a refillable slot")
}

// --- putShare's atomic check-and-set refuses a write raced against a revoke ---
{
  const store = fakeRedis()

  // The race the old code allowed: `isRevoked` (a read) followed by a
  // separate `SET NX` (a write) left a gap a concurrent tombstone could land
  // in. `putShareWith` is one atomic call now, so there is no gap to land in
  // — model an adversarial ordering where a revoke completes the instant
  // before the put's own script would run, and confirm the put still loses.
  let raced = false
  const racyClient = {
    ...store,
    async eval(script, keys, args) {
      if (script === PUT_SHARE_SCRIPT && !raced) {
        raced = true
        await tombstoneShareWith(store, ENTITY_KEY, 3600)
      }
      return store.eval(script, keys, args)
    },
  }

  const result = await putShareWith(racyClient, ENTITY_KEY, { share: "held-share", commitment: "c".repeat(64) }, 3600)
  assert.equal(result, false, "a tombstone that lands immediately before the atomic put must still win")
  console.log("PASS  putShare's atomic check-and-set refuses a write raced against a revoke")
}

console.log("\nAll checks passed.")
