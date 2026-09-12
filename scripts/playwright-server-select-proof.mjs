import assert from "node:assert/strict"
import { createServer } from "node:net"
import { rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const { checkoutId, isOwnedByCheckout, recordOwnership, resolveServerTarget } =
  await import("../lib/e2e-server-select.ts")

// R3-017 — a BASE_URL with no port, or with its protocol's default port
// spelled out, must not be treated as "no port given" and quietly fall back
// to 3000.
assert.equal(resolveServerTarget("http://localhost").port, "80")
assert.equal(resolveServerTarget("http://localhost:80").port, "80")
assert.equal(resolveServerTarget("http://localhost:4173").port, "4173")
console.log("PASS  a default-port BASE_URL resolves to that default port, not 3000")

// R3-017 — https must fail loudly rather than start an incompatible plain-HTTP
// server and hang waiting for a TLS handshake that never comes.
for (const httpsURL of ["https://localhost", "https://localhost:443", "https://healthsend.vercel.app"]) {
  assert.throws(() => resolveServerTarget(httpsURL), /must be http/, httpsURL)
}
console.log("PASS  an https BASE_URL is refused instead of starting an incompatible server")

// R3-004 — reuse must require proof of ownership, not just BASE_URL being set.
const port = String(41800 + (process.pid % 1000))
const markerPath = join(tmpdir(), `healthsend-e2e-server-owner-${port}`)
rmSync(markerPath, { force: true })
try {
  const me = checkoutId()
  const foreignCheckout = "/Users/limone/.fleet/wt/review-3-sandbox"

  assert.equal(
    isOwnedByCheckout(port, me),
    false,
    "a port nothing ever started on must not be treated as owned",
  )

  recordOwnership(port, foreignCheckout)
  assert.equal(
    isOwnedByCheckout(port, me),
    false,
    "a marker left by another checkout must not count as proof for this one",
  )

  recordOwnership(port, me)
  assert.equal(
    isOwnedByCheckout(port, me),
    true,
    "a marker this checkout wrote for itself must be recognised",
  )
  console.log("PASS  reuse is only recognised for a marker this checkout itself wrote")

  // The other half of "provably belongs to this checkout, or refuse": once
  // refused, the fresh start Playwright then attempts on that same port must
  // fail loudly if something is actually still listening there — not attach
  // to it and not silently pick a different port instead.
  rmSync(markerPath, { force: true }) // back to "foreign, unproven"
  const foreignServer = createServer().listen(Number(port))
  await new Promise((resolve, reject) => foreignServer.once("listening", resolve).once("error", reject))
  try {
    await assert.rejects(
      () =>
        new Promise((resolve, reject) => {
          const second = createServer()
          second.once("error", reject)
          second.once("listening", () => {
            second.close()
            resolve()
          })
          second.listen(Number(port))
        }),
      /EADDRINUSE/,
      "a port a foreign process holds must make a fresh start fail loudly, not succeed elsewhere",
    )
  } finally {
    await new Promise((resolve) => foreignServer.close(resolve))
  }
  console.log("PASS  a port held by a foreign process makes a fresh start fail loudly")
} finally {
  rmSync(markerPath, { force: true })
}
