"use client"

/**
 * Chrome for the three sender routes (`/`, `/new`, `/shares`) — a route
 * group so the URLs stay flat while the layout underneath is shared.
 *
 * Two screens live here, never both mounted-and-visible at once but both
 * always present in the tree:
 *
 *   - `SignInScreen` (frames `BsnX6`/`GdIlc`, H-21) holds the Swarm ID
 *     connect container. It is rendered on every pass and only ever hidden
 *     with the `hidden` class once the user signs in — never removed by a
 *     conditional branch. A Next.js layout stays mounted across navigation
 *     between the routes it wraps, which is what lets the container survive
 *     `/`, `/new` and `/shares`; swapping the whole screen out from under it
 *     on sign-in would do the same damage a page-level mount does — destroy
 *     the iframe and leave every later call failing with "Iframe not
 *     initialized". See `CLAUDE.md`.
 *   - `SenderChrome` (the rail + dashboard) mounts only once signed in. It
 *     holds no persistent resource of its own, so it is free to come and go.
 */

import type { ReactNode } from "react"
import { useRouter, usePathname } from "next/navigation"
import { disconnect } from "@/lib/swarm"
import { SenderChrome, type SenderDestination } from "@/components/chrome"
import { SignInScreen } from "@/components/sign-in-screen"
import { useSenderIdentity } from "@/components/use-sender-identity"

export default function SenderLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { info, identity } = useSenderIdentity()
  const signedIn = Boolean(info.identity)

  // The rail has no "compose" destination — /new is reached through the
  // "New share" button, not a nav item — so it falls back to "archive".
  const active: SenderDestination = pathname === "/shares" ? "shares" : "archive"

  return (
    <>
      <div className={signedIn ? "hidden" : "contents"}>
        <SignInScreen />
      </div>

      {signedIn && (
        <SenderChrome
          active={active}
          onNavigate={(destination) => {
            if (destination === "archive") router.push("/")
            if (destination === "shares") router.push("/shares")
            // "assistant" has no route yet; the nav item is inert until that story lands.
          }}
          onNewShare={() => router.push("/new")}
          onSignOut={() => void disconnect()}
        >
          {/* Derivation runs after Swarm ID reports a connection (see
              components/use-sender-identity.tsx) and can fail on its own —
              an earlier version swallowed that and left the app signed in
              with no send form and no explanation. Say what broke instead of
              rendering the dashboard as if nothing were wrong. */}
          {identity.error && !identity.booting && (
            <p className="mb-6 text-sm text-error">
              Could not derive your grant key: {identity.error}
            </p>
          )}

          {children}
        </SenderChrome>
      )}
    </>
  )
}
