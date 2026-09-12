"use client"

/**
 * Runs "End access now" for the confirm sheet.
 *
 * `endSend` (lib/sends.ts) resolves to `{ status: "error" }` for a response
 * the holder actually sent back, but a holder that refuses the connection
 * outright — down, unreachable, DNS failure — makes the underlying `fetch`
 * reject instead, so the call throws rather than resolving. A sheet that
 * awaits that promise directly is left with its "ending" flag stuck on
 * forever: every control it has is disabled while `ending` is true, so a
 * thrown revoke could not be dismissed or retried, and the sender was left
 * unsure whether access had actually ended. This always resolves, so the
 * sheet can always return to a state the sender can act from.
 */

import { endSend } from "@/lib/sends"

export type ConfirmEndOutcome = { outcome: "ended" } | { outcome: "refused"; message: string }

type ConfirmEndDependencies = { endSend: typeof endSend }

const defaultDependencies: ConfirmEndDependencies = { endSend }

export async function performConfirmEnd(
  entityKey: string,
  dependencies: ConfirmEndDependencies = defaultDependencies,
): Promise<ConfirmEndOutcome> {
  try {
    const result = await dependencies.endSend(entityKey)
    if (result.status === "error") return { outcome: "refused", message: result.message }
    return { outcome: "ended" }
  } catch (error) {
    return { outcome: "refused", message: (error as Error).message }
  }
}
