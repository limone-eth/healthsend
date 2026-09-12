/**
 * Pure logic behind `playwright.config.ts`'s choice of port and its decision to
 * reuse an already-running server instead of starting one. Kept out of the
 * config file so `scripts/playwright-server-select-proof.mjs` can exercise it
 * without loading Playwright itself.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/**
 * Resolve the port Playwright's webServer should target for a given BASE_URL.
 *
 * `URL` strips a port that matches its protocol's default, so
 * `http://localhost`, `http://localhost:80`, and `https://localhost:443` all
 * report `port === ""` — not "no port was given". Falling back to 3000 in
 * that case is wrong whenever the URL actually named 80 or 443.
 *
 * https is refused outright rather than guessed at: the local server this
 * suite starts is a plain `next dev`, which never serves TLS, so pointing at
 * an https URL — including a real deployment such as
 * `https://healthsend.vercel.app` — would otherwise start an incompatible
 * plain-HTTP server and then hang waiting for a TLS handshake that never
 * comes.
 */
export function resolveServerTarget(baseURL: string): { url: string; port: string } {
  const parsed = new URL(baseURL)
  if (parsed.protocol === "https:") {
    throw new Error(
      `BASE_URL must be http — the local dev server this suite starts cannot serve https. Got ${baseURL}.`,
    )
  }
  return { url: baseURL, port: parsed.port || "80" }
}

/** Stable per-checkout identity: two git worktrees never share a filesystem path. */
export function checkoutId(): string {
  return process.cwd()
}

function markerPath(port: string): string {
  return join(tmpdir(), `healthsend-e2e-server-owner-${port}`)
}

/**
 * Record that the server now answering on `port` belongs to `owner`. Called
 * only from `globalSetup`, which Playwright runs after its own webServer
 * plugin has confirmed a server is answering at the target URL — so a marker
 * is never written for a server that turned out not to start.
 */
export function recordOwnership(port: string, owner: string): void {
  writeFileSync(markerPath(port), owner)
}

/**
 * True only when a previous, confirmed start on `port` recorded `owner`. A
 * missing or mismatched marker means whatever is on that port — including
 * nothing — was never proven to be this checkout's, so the caller must
 * refuse to reuse it rather than attach.
 */
export function isOwnedByCheckout(port: string, owner: string): boolean {
  const path = markerPath(port)
  if (!existsSync(path)) return false
  try {
    return readFileSync(path, "utf8") === owner
  } catch {
    return false
  }
}
