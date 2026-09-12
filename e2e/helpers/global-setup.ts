/**
 * Runs once, after Playwright's webServer plugin has confirmed a server is
 * answering at the target URL — whether that server was just started or was
 * reused. Recording ownership here, rather than in the webServer command
 * itself, means a server that never came up leaves no marker behind: a later
 * run cannot mistake a failed start for proof that this checkout owns the
 * port.
 */
import { checkoutId, recordOwnership, resolveServerTarget } from "../../lib/e2e-server-select.ts"

export default function globalSetup() {
  const baseURL = process.env.BASE_URL ?? "http://localhost:3000"
  const { port } = resolveServerTarget(baseURL)
  recordOwnership(port, checkoutId())
}
