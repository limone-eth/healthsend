"use client"

/**
 * The sender's own read of "When they looked" — signs the same domain-
 * prefixed, timestamp-bound message `lib/access-log.ts` expects, then POSTs
 * it to the route that already wires that module up.
 *
 * A thrown error and a non-OK response both collapse to `"unavailable"`
 * rather than surfacing whatever the network happened to say: the caller's
 * only job with that value is to fall into the chip's seventh state, not to
 * explain a transport failure.
 */

import { privateKeyToAccount } from "viem/accounts"
import { getIdentity } from "@/lib/identity"
import { accessLogMessage } from "@/lib/access-log"

export type AccessLogFetch =
  | { status: "ok"; opened: number[]; reliable: boolean }
  | { status: "unavailable" }

export async function fetchAccessLog(entityKey: string): Promise<AccessLogFetch> {
  try {
    const identity = await getIdentity()
    const timestamp = Math.floor(Date.now() / 1000)
    const signature = await privateKeyToAccount(identity.privateKey).signMessage({
      message: accessLogMessage(entityKey, timestamp),
    })
    const response = await fetch("/api/holder/access-log", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entityKey, signature, timestamp }),
    })
    if (!response.ok) return { status: "unavailable" }
    const body = (await response.json()) as { opened: number[]; reliable: boolean }
    return { status: "ok", opened: body.opened, reliable: body.reliable }
  } catch {
    return { status: "unavailable" }
  }
}
