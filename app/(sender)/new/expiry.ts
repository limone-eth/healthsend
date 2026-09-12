/**
 * Pure expiry-window arithmetic for the compose screen (2.4, `HMa4U`/`ammIs`).
 *
 * Split out of `page.tsx` so it has no JSX and no live Swarm ID dependency,
 * which lets `scripts/new-expiry-proof.mjs` exercise it directly — `/new`
 * renders nothing without a real sign-in (see `e2e/mobile-tab-bar-clearance.spec.ts`'s
 * header comment), so there is no browser-level way to reach this logic.
 *
 * R2-016: enabling "Custom" without picking a date used to leave `ttlSeconds`
 * silently equal to whichever preset window was last selected — the sender
 * saw "Pick a date and time" but a submit right then created a send expiring
 * on the preset, not on nothing and not on an error. `resolveCustomSeconds`
 * returning `null` for "no date yet, or one that does not parse" and
 * `isExpiryValid` refusing to create in that state (see its one caller in
 * `page.tsx`) is what closes that gap — no submit path exists anymore that
 * can silently fall back to a different window than the one shown.
 */

/** `null` means "no usable custom date yet" — either none picked, or one that fails to parse. */
export function resolveCustomSeconds(customValue: string, previewNow: number): number | null {
  if (!customValue) return null
  const target = new Date(customValue).getTime()
  if (!Number.isFinite(target)) return null
  return Math.max(1, Math.round((target - previewNow) / 1000))
}

export function resolveTtlSeconds(params: {
  customEnabled: boolean
  customSeconds: number | null
  windowSeconds: number
}): number {
  return params.customEnabled && params.customSeconds !== null ? params.customSeconds : params.windowSeconds
}

/** False exactly when Custom is on but there is no usable date to build a send from. */
export function isExpiryValid(params: { customEnabled: boolean; customSeconds: number | null }): boolean {
  return !params.customEnabled || params.customSeconds !== null
}
