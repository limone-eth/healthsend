"use client"

/**
 * Chrome for the three sender routes (`/`, `/new`, `/shares`) — a route
 * group so the URLs stay flat while the layout underneath is shared.
 *
 * The Swarm ID connect container lives here, not in any one route. It has to:
 * a Next.js layout stays mounted across navigation between routes it wraps,
 * while each route's own page component is torn down and rebuilt. Rendering
 * the container inside a page instead would unmount the iframe on every nav
 * and leave every later call failing with "Iframe not initialized" — see
 * `CLAUDE.md`.
 */

import type { ReactNode } from "react"
import { useRouter, usePathname } from "next/navigation"
import { CONNECT_CONTAINER_ID, type ConnectionInfo } from "@/lib/swarm"
import { Card, Mono } from "@/components/ui"
import { SenderChrome, type SenderDestination } from "@/components/chrome"
import { useSenderIdentity, type SenderIdentity } from "@/components/use-sender-identity"

export default function SenderLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { info, identity } = useSenderIdentity()

  // The rail has no "compose" destination — /new is reached through the
  // "New share" button, not a nav item — so it falls back to "archive".
  const active: SenderDestination = pathname === "/shares" ? "shares" : "archive"

  return (
    <SenderChrome
      active={active}
      accountName={info.identity?.name ?? "Sign in"}
      onNavigate={(destination) => {
        if (destination === "archive") router.push("/")
        if (destination === "shares") router.push("/shares")
        // "assistant" has no route yet; the nav item is inert until that story lands.
      }}
      onNewShare={() => router.push("/new")}
    >
      <div className="mx-auto w-full max-w-2xl">
        <header className="mb-10">
          <h1 className="text-2xl font-semibold tracking-tight">HealthSend</h1>
          {/* "Then the key is gone" stood here until it was checked. It was the same
              overreach the README retracted and the landing page was corrected for: the
              document stays on Swarm, and a reader who opened it keeps what they read.
              What actually happens is narrower, and saying the narrower thing costs
              nothing. See README.md, "What expiry does and does not do". */}
          <p className="mt-1 text-sm text-muted">
            Share a document with someone for exactly as long as you mean to. When the window
            closes, we delete our half within the hour.
          </p>
        </header>

        <ConnectionPanel
          info={info}
          address={identity.address}
          booting={identity.booting}
          error={identity.error}
        />

        {children}

        <footer className="mt-16 border-t border-hairline pt-6 text-xs text-muted">
          {/* This described the v1 architecture, where the grant carried the wrapped
              key. It no longer does — that was the whole point of the rewrite, and
              a grant now carries a reference and a commitment and nothing else. */}
          Documents are encrypted in this browser and stored on Swarm. The key that opens them is
          split in two: half is in the link, half is held for the length of the window and
          deleted soon after. An Arkiv grant decides when that window ends, and nothing has to
          run for it to.
        </footer>
      </div>
    </SenderChrome>
  )
}

function ConnectionPanel({
  info,
  address,
  booting,
  error,
}: {
  info: ConnectionInfo
  address: SenderIdentity["address"]
  booting: boolean
  error: string | null
}) {
  const signedIn = Boolean(info.identity)

  return (
    <Card className="mb-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          {signedIn ? (
            <>
              <h2 className="text-sm font-medium">{info.identity!.name}</h2>
              <p className="mt-0.5 text-xs text-muted">Swarm ID · {info.identity!.address}</p>
            </>
          ) : (
            <>
              <h2 className="text-sm font-medium">Sign in</h2>
              <p className="mt-1 text-sm text-muted">
                Swarm ID is the whole account: a passkey, no wallet and no seed phrase. There is no
                user database here to sign in to.
              </p>
            </>
          )}

          {signedIn && booting && <p className="mt-2 text-xs text-muted">Deriving your keys…</p>}

          {signedIn && error && (
            <p className="mt-2 text-xs text-red-600">
              Could not derive your grant key: {error}
            </p>
          )}

          {signedIn && !info.canUpload && (
            <p className="mt-2 text-xs text-muted">
              No postage batch on this identity yet, so uploads are unavailable. Get one at the
              Swarm desk, or point NEXT_PUBLIC_SWARM_SUBSIDISED_GATEWAY at a stamping gateway.
            </p>
          )}

          {/* Keys are derived silently from the passkey. They are shown only on
              request: a user who never opens this never learns a key exists,
              which is the point — the ownership is real whether or not they
              look at it. */}
          {signedIn && !booting && address && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-muted">Advanced</summary>
              <p className="mt-1.5 text-xs">
                <span className="text-muted">Arkiv grant key </span>
                <Mono>{address}</Mono>
              </p>
              <p className="mt-1 text-xs text-muted">
                Derived from your passkey, held by nobody else. Sign in on another device and the
                same key comes back.
              </p>
            </details>
          )}
        </div>

        {/*
          The Swarm ID iframe lives in this container and paints its own button —
          "Continue with Swarm ID" when signed out, "Sign out" when signed in.

          It must stay mounted across that transition, and across navigation between
          the sender routes now that there are three of them — see the layout-level
          comment above.
        */}
        <div
          id={CONNECT_CONTAINER_ID}
          className={
            signedIn
              ? "h-9 w-[110px] shrink-0 overflow-hidden"
              : "h-11 w-[260px] shrink-0 overflow-hidden"
          }
        />
      </div>
    </Card>
  )
}
