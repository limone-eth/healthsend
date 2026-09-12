/**
 * Proves the H-7 code scheme offline: no Redis, no chain, no network.
 *
 *   splitContentKey / joinContentKey / deriveLinkShareWithCode / deriveCodeProof — lib/crypto.ts
 *   resolveUnlock(entityKey, authKey, deps, codeProof)  — lib/unlock.ts
 *   checkCodeWith / putShareWith  — lib/holder-store.ts, against the real Lua text via fengari
 *
 * Three properties, matching the story's contract exactly:
 *
 *   1. A wrong code fails closed: the holder never serves the share, the
 *      failure is its own status (never "expired", "unavailable", or the
 *      generic decrypt failure), and enough wrong guesses lock the grant out
 *      for good — not just for one more try.
 *   2. The commitment written to Arkiv is independent of the code: the same
 *      link secret produces the same `authKey`/`commitment` whether or not a
 *      code is set, and whatever code is chosen.
 *   3. A share made with a code cannot be opened by the link alone: even with
 *      the holder's real half in hand, decrypting without the code fails on
 *      the AES-GCM tag, not at some explicit check.
 */
import assert from "node:assert/strict"
import { lauxlib, lua, lualib, to_jsstring, to_luastring } from "fengari"

const {
  generateContentKey,
  generateLinkSecret,
  generateCode,
  seal,
  open,
  splitContentKey,
  joinContentKey,
  deriveAuthKey,
  deriveCodeProof,
  authCommitment,
} = await import("../lib/crypto.ts")
const { packEnvelope } = await import("../lib/envelope.ts")
const { resolveUnlock } = await import("../lib/unlock.ts")
const { putShareWith, checkCodeWith, MAX_CODE_ATTEMPTS } = await import("../lib/holder-store.ts")

const ENTITY_KEY = "0x" + "7c".repeat(32)
const codeHashKeyName = (entityKey) => `healthsend:codehash:${entityKey.toLowerCase()}`
const codeAttemptsKeyName = (entityKey) => `healthsend:codeattempts:${entityKey.toLowerCase()}`

/**
 * The same minimal in-memory Redis command surface `scripts/access-log-proof.mjs`
 * uses, extended with `INCR` for the attempt counter `CHECK_CODE_SCRIPT` needs.
 * Fengari executes the exact Lua source passed to `eval()` — this fake supplies
 * storage only, never a JS reimplementation of either script's branches.
 */
function fakeRedis() {
  const strings = new Map()

  const call = (rawCommand, args) => {
    const command = rawCommand.toUpperCase()
    if (command === "GET") {
      const [key] = args
      return strings.has(key) ? strings.get(key) : null
    }
    if (command === "SET") {
      const [key, value, ...options] = args
      const nx = options.some((option) => option.toUpperCase() === "NX")
      if (nx && strings.has(key)) return false
      strings.set(key, value)
      return "OK"
    }
    if (command === "INCR") {
      const [key] = args
      const next = (Number(strings.get(key)) || 0) + 1
      strings.set(key, String(next))
      return next
    }
    if (command === "EXPIRE") {
      const [key] = args
      return strings.has(key) ? 1 : 0
    }
    if (command === "EXISTS") {
      return args.reduce((count, key) => count + Number(strings.has(key)), 0)
    }
    if (command === "DEL") {
      let deleted = 0
      for (const key of args) if (strings.delete(key)) deleted++
      return deleted
    }
    throw new Error(`fakeRedis: unsupported command ${rawCommand}`)
  }

  async function runLua(script, keys, args) {
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
      const result = call(command, commandArgs)
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

  return {
    async eval(script, keys, args) {
      return runLua(script, keys, args)
    },
    async get(key) {
      return strings.has(key) ? strings.get(key) : null
    },
    async set(key, value) {
      strings.set(key, value)
      return "OK"
    },
    async lrange() {
      return []
    },
    async exists(key) {
      return strings.has(key) ? 1 : 0
    },
    // test-only
    raw(key) {
      return strings.get(key)
    },
  }
}

// --- generateCode is a uniform four-digit string ------------------------------
{
  const seen = new Set()
  for (let i = 0; i < 200; i++) {
    const code = generateCode()
    assert.match(code, /^\d{4}$/, "a code must be exactly four digits, zero-padded")
    seen.add(code)
  }
  assert.ok(seen.size > 1, "two hundred draws must not all collide")
  console.log("PASS  generateCode produces zero-padded four-digit strings")
}

// --- property 2: the commitment is independent of the code --------------------
{
  const contentKey = generateContentKey()
  const linkSecret = generateLinkSecret()

  const uncoded = await splitContentKey(contentKey, linkSecret)
  const codedA = await splitContentKey(contentKey, linkSecret, "1234")
  const codedB = await splitContentKey(contentKey, linkSecret, "9999")

  assert.equal(codedA.commitment, uncoded.commitment, "adding a code must not change the commitment")
  assert.equal(codedB.commitment, uncoded.commitment, "a different code must not change the commitment either")
  assert.deepEqual(
    Buffer.from(codedA.authKey),
    Buffer.from(uncoded.authKey),
    "the auth key itself must not depend on the code",
  )
  assert.equal(
    uncoded.commitment,
    await authCommitment(uncoded.authKey),
    "the commitment must still be exactly the hash of the link-secret-only auth key",
  )

  // The held share is where the code actually lives — it must differ per code,
  // or the second defence-in-depth layer the story asks for does not exist.
  assert.notDeepEqual(Buffer.from(codedA.heldShare), Buffer.from(uncoded.heldShare))
  assert.notDeepEqual(Buffer.from(codedA.heldShare), Buffer.from(codedB.heldShare))
  console.log("PASS  the on-chain commitment is identical with no code, and with any code")
}

// --- property 3: a coded share cannot be opened by the link alone -------------
{
  const plaintext = packEnvelope([
    { header: { name: "note.txt", mime: "text/plain", size: 7 }, body: new TextEncoder().encode("secret!") },
  ])
  const contentKey = generateContentKey()
  const sealed = await seal(contentKey, plaintext)

  const linkSecret = generateLinkSecret()
  const code = "4321"
  const { heldShare } = await splitContentKey(contentKey, linkSecret, code)

  // The right code opens it.
  const rightKey = await joinContentKey(heldShare, linkSecret, code)
  const opened = await open(rightKey, sealed)
  assert.deepEqual(Buffer.from(opened), Buffer.from(plaintext), "the right code must still open the envelope")
  console.log("PASS  the right code reconstructs the content key and opens the envelope")

  // The link alone — exactly what an attacker who obtained the holder's share
  // through some other means, but never the code, would have — does not.
  const linkOnlyKey = await joinContentKey(heldShare, linkSecret)
  await assert.rejects(
    open(linkOnlyKey, sealed),
    "the link and the holder's share alone, with no code, must not open a coded envelope",
  )
  console.log("PASS  the link and the holder's share alone cannot open a coded envelope (GCM tag failure)")

  // A wrong code fails the same way — not some different, more informative error.
  const wrongCodeKey = await joinContentKey(heldShare, linkSecret, "0000")
  await assert.rejects(open(wrongCodeKey, sealed), "a wrong code must fail exactly like no code at all")
  console.log("PASS  a wrong code fails the same way as no code — a GCM tag failure, not a distinct branch")
}

// --- property 1: a wrong code fails closed at the holder, and locks out -------
{
  const now = Math.floor(Date.now() / 1000)
  const expiresAt = now + 3600
  const linkSecret = generateLinkSecret()
  const code = "2468"
  const contentKey = generateContentKey()
  const { heldShare, authKey, commitment } = await splitContentKey(contentKey, linkSecret, code)
  const codeHash = await deriveCodeProof(authKey, code)

  const store = fakeRedis()
  const stored = await putShareWith(
    store,
    ENTITY_KEY,
    { share: Buffer.from(heldShare).toString("base64url"), commitment },
    3600,
    codeHash,
  )
  assert.equal(stored, true, "the legitimate write, with its code guard, must succeed")
  assert.ok(store.raw(codeHashKeyName(ENTITY_KEY)), "the code guard must actually be persisted")

  const grant = { authCommitment: commitment, expiresAt }
  const authKeyB64 = Buffer.from(authKey).toString("base64url")
  const baseDeps = {
    getGrant: async () => grant,
    getShare: async () => ({ share: Buffer.from(heldShare).toString("base64url"), commitment }),
    serveShare: async () => {
      throw new Error("must not be reached once the code check has already refused")
    },
    checkCode: (entityKey, proof, at, exp) => checkCodeWith(store, entityKey, proof, at, exp),
  }

  // Probing with no code presented must say a code is required, and must not
  // count as a guess.
  const probe = await resolveUnlock(ENTITY_KEY, authKeyB64, baseDeps, "")
  assert.equal(probe.ok, false)
  assert.equal(probe.status, 401)
  assert.equal(probe.codeRequired, true, "an empty proof must read as 'a code is required', not a wrong guess")
  assert.equal(store.raw(codeAttemptsKeyName(ENTITY_KEY)), undefined, "a probe must not consume an attempt")
  console.log("PASS  asking whether a code is required does not count as an attempt")

  // A wrong code is refused, with its own status — never expired, unavailable,
  // or the generic decrypt failure `serveShare` above would prove was never
  // reached (it throws if it is).
  const wrongProof = await deriveCodeProof(authKey, "0000")
  const wrong = await resolveUnlock(ENTITY_KEY, authKeyB64, baseDeps, wrongProof)
  assert.equal(wrong.ok, false)
  assert.equal(wrong.status, 401)
  assert.equal(wrong.wrongCode, true)
  assert.notEqual(wrong.error, "expired")
  console.log("PASS  a wrong code is refused before the share is ever served, with its own status")

  // The right code, on the other hand, reaches serveShare — flip that
  // dependency to prove it, rather than trusting the same throwing stub.
  const rightProof = await deriveCodeProof(authKey, code)
  let served = false
  const rightDeps = {
    ...baseDeps,
    serveShare: async () => {
      served = true
      return { share: Buffer.from(heldShare).toString("base64url"), commitment }
    },
  }
  const right = await resolveUnlock(ENTITY_KEY, authKeyB64, rightDeps, rightProof)
  assert.equal(right.ok, true, "the right code must be served")
  assert.ok(served, "the right code must actually reach the atomic serve step")
  console.log("PASS  the right code is served, and only the right code reaches that point")

  // Enough wrong guesses lock the grant out for the rest of its life — not
  // just refuse the one attempt over the limit.
  let lastResult
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS + 2; attempt++) {
    lastResult = await resolveUnlock(ENTITY_KEY, authKeyB64, baseDeps, wrongProof)
  }
  assert.equal(lastResult.ok, false)
  assert.equal(lastResult.locked, true, "enough wrong codes must lock the grant out, not just refuse one more try")

  // Locked means locked — even the *right* code is now refused, because a
  // rate limit that reopens for a correct guess after the count is exhausted
  // is not a rate limit.
  const afterLock = await resolveUnlock(ENTITY_KEY, authKeyB64, rightDeps, rightProof)
  assert.equal(afterLock.ok, false, "a locked grant must refuse even the correct code")
  assert.equal(afterLock.locked, true)
  console.log(`PASS  ${MAX_CODE_ATTEMPTS} wrong codes lock the grant out for good, even against a correct retry`)
}

// --- a send without a code is entirely unaffected ------------------------------
{
  const now = Math.floor(Date.now() / 1000)
  const linkSecret = generateLinkSecret()
  const contentKey = generateContentKey()
  const { authKey, commitment } = await splitContentKey(contentKey, linkSecret)

  const store = fakeRedis()
  await putShareWith(store, ENTITY_KEY, { share: "x", commitment }, 3600)
  assert.equal(store.raw(codeHashKeyName(ENTITY_KEY)), undefined, "an uncoded send must not write a code guard")

  const outcome = await checkCodeWith(store, ENTITY_KEY, "", now, now + 3600)
  assert.equal(outcome, "none", "with no code guard stored, the check must say 'none' rather than 'required'")

  const deps = {
    getGrant: async () => ({ authCommitment: commitment, expiresAt: now + 3600 }),
    getShare: async () => ({ share: "x", commitment }),
    serveShare: async () => ({ share: "x", commitment }),
    checkCode: (entityKey, proof, at, exp) => checkCodeWith(store, entityKey, proof, at, exp),
  }
  const result = await resolveUnlock(
    ENTITY_KEY,
    Buffer.from(authKey).toString("base64url"),
    deps,
    // Probing with a value shaped like a real proof, from a caller that never
    // saw a code either — it must be ignored rather than treated as a guess.
    "irrelevant",
  )
  assert.equal(result.ok, true, "a share with no code guard must serve exactly as it always did")
  console.log("PASS  a send with no code is entirely unaffected by the code path")
}

// --- deps.checkCode omitted entirely behaves exactly like H-45's build ---------
{
  const now = Math.floor(Date.now() / 1000)
  const commitment = "c".repeat(64)
  const deps = {
    getGrant: async () => ({ authCommitment: commitment, expiresAt: now + 3600 }),
    getShare: async () => ({ share: "x", commitment }),
    serveShare: async () => ({ share: "x", commitment }),
  }
  const result = await resolveUnlock(ENTITY_KEY, Buffer.from(await deriveAuthKey(generateLinkSecret())).toString("base64url"), deps)
  // A wrong auth key here (a fresh random link secret) must still fail at the
  // commitment check, exactly as before this story touched the file — this
  // proves adding the optional `checkCode` dependency changed nothing for a
  // caller that never supplies it.
  assert.equal(result.ok, false)
  assert.equal(result.status, 403)
  console.log("PASS  a caller that omits checkCode entirely sees H-45's unlock, unchanged")
}

console.log("\nAll checks passed.")
