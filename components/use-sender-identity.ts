"use client"

/**
 * Connection + derived-identity state for the sender routes.
 *
 * Each route that needs it calls this independently rather than reading a
 * shared instance — there is no context or store here, just the same
 * `onConnectionChange` subscription and memoised `getIdentity()` that
 * `lib/swarm.ts` and `lib/identity.ts` already expose to any caller. That
 * keeps `/`, `/new` and `/shares` free to be worked on independently, which
 * is the point of splitting them apart.
 */

import { useEffect, useState } from "react"
import { onConnectionChange, type ConnectionInfo } from "@/lib/swarm"
import { getIdentity, forgetIdentity } from "@/lib/identity"

export type SenderIdentity = {
  address: string | null
  booting: boolean
  error: string | null
}

export function useSenderIdentity(): { info: ConnectionInfo; identity: SenderIdentity } {
  const [info, setInfo] = useState<ConnectionInfo>({ canUpload: false })
  const [identity, setIdentity] = useState<SenderIdentity>({
    address: null,
    booting: true,
    error: null,
  })

  useEffect(() => onConnectionChange(setInfo), [])

  // The Swarm ID iframe reports a connection before the app secret is derivable,
  // so the Arkiv identity is resolved as a follow-on step rather than inline.
  useEffect(() => {
    let cancelled = false
    const resolve = async () => {
      if (!info.identity) {
        forgetIdentity()
        if (!cancelled) setIdentity({ address: null, booting: false, error: null })
        return
      }
      try {
        const derived = await getIdentity()
        if (!cancelled) setIdentity({ address: derived.address, booting: false, error: null })
      } catch (caught) {
        // Swallowing this left the app signed in with no send form and no
        // explanation — the worst of both states. Say what broke.
        if (!cancelled) {
          setIdentity({ address: null, booting: false, error: (caught as Error).message })
        }
      }
    }
    resolve()
    return () => {
      cancelled = true
    }
  }, [info.identity])

  return { info, identity }
}
