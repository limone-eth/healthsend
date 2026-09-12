"use client"

import type { ReactNode } from "react"
import type { Icon as PhosphorIcon } from "@phosphor-icons/react"
import { GridFour, PaperPlaneTilt, Sparkle, UserCircle } from "@phosphor-icons/react"
import { TabBar } from "@/components/ui"

/**
 * The chrome — pen ids `ACUf3`/`HMa4U`/`hCcwO`/`LKFS1` (rail, repeated
 * identically across every 2.x/4.x desktop frame) and `zsDfc` (mobile tab
 * bar), read via the pencil MCP tool against `healthsend.pen`, not a
 * screenshot. Three breakpoints, matching Tailwind's own `md` (768) and `xl`
 * (1280) so no custom breakpoint config is needed: the 264px rail collapses
 * to a 72px icon rail at `md`, then to the floating tab bar below `md`.
 * `docs/stories/H-3.md`'s `## Choices` records where the frame's exact
 * values were kept over DESIGN.md's prose.
 */

export type SenderDestination = "archive" | "shares" | "assistant"

// The rail (desktop/tablet, `label`) spells out "Your archive" per
// ACUf3/HMa4U/hCcwO/LKFS1; the mobile tab bar (`mobileLabel`) uses TdVX6's
// shorter "Archive" — the two frames give the same destinations different
// copy, so this is two fields, not one reused string.
const DESTINATIONS: { key: SenderDestination; label: string; mobileLabel: string; icon: PhosphorIcon }[] = [
  { key: "archive", label: "Your archive", mobileLabel: "Archive", icon: GridFour },
  { key: "shares", label: "Your shares", mobileLabel: "Shares", icon: PaperPlaneTilt },
  { key: "assistant", label: "Your assistant", mobileLabel: "Assistant", icon: Sparkle },
]

// ---------------------------------------------------------------------------
// Rail — pen ids ACUf3/HMa4U/hCcwO/LKFS1 "Rail". 264px, $surface, 1px
// hairline right edge, 28/20 padding. Collapses to a 72px icon rail at the
// tablet breakpoint (768-1279): labels drop to a native `title` tooltip,
// which is the whole of what "tooltip" needs at this size.
// ---------------------------------------------------------------------------

function Rail({
  active,
  accountName,
  onNavigate,
  onNewShare,
}: {
  active: SenderDestination
  accountName: string
  onNavigate?: (destination: SenderDestination) => void
  onNewShare?: () => void
}) {
  return (
    <nav className="sticky top-0 hidden h-screen shrink-0 flex-col gap-1.5 border-r border-hairline bg-surface px-2 py-7 md:flex md:w-[72px] xl:w-[264px] xl:px-5">
      <div className="flex h-[52px] items-center justify-center px-0 xl:justify-start xl:px-3.5">
        <span className="hidden text-[21px] font-semibold tracking-[-0.5px] text-ink xl:inline">
          healthsend
        </span>
      </div>

      <div className="h-3.5" />

      {DESTINATIONS.map((destination) => {
        const Icon = destination.icon
        const isActive = destination.key === active
        return (
          <button
            key={destination.key}
            type="button"
            title={destination.label}
            onClick={() => onNavigate?.(destination.key)}
            className={`flex h-11 items-center justify-center gap-3 rounded-control px-0 xl:justify-start xl:px-3.5 ${
              isActive ? "bg-haze" : "bg-transparent"
            }`}
          >
            <Icon size={20} weight={isActive ? "fill" : "light"} className={isActive ? "text-navy" : "text-secondary"} />
            <span
              className={`hidden text-[15px] tracking-[-0.1px] xl:inline ${
                isActive ? "font-semibold text-navy" : "font-normal text-ink"
              }`}
            >
              {destination.label}
            </span>
          </button>
        )
      })}

      <div className="flex-1" />

      <button
        type="button"
        title="New share"
        onClick={onNewShare}
        className="flex h-13 items-center justify-center gap-2 rounded-control bg-ink px-0 text-title text-surface xl:px-6"
      >
        <PaperPlaneTilt size={18} weight="regular" className="shrink-0" />
        <span className="hidden xl:inline">New share</span>
      </button>

      <div className="h-2.5" />

      <div className="flex h-11 items-center justify-center gap-3 px-0 xl:justify-start xl:px-3.5">
        <UserCircle size={20} weight="light" className="shrink-0 text-muted" />
        <span className="hidden truncate text-sm text-secondary xl:inline">{accountName}</span>
      </div>
    </nav>
  )
}

// ---------------------------------------------------------------------------
// Sender chrome — the rail (desktop/tablet) plus the floating tab bar
// (mobile), composed around whatever content a screen renders into it. The
// tab bar itself is `TabBar` (pen id kGlX0) from `components/ui.tsx`; this
// only places it, per H-1's contract.
// ---------------------------------------------------------------------------

export function SenderChrome({
  active,
  accountName,
  onNavigate,
  onNewShare,
  children,
}: {
  active: SenderDestination
  accountName: string
  onNavigate?: (destination: SenderDestination) => void
  onNewShare?: () => void
  children: ReactNode
}) {
  return (
    <div className="flex min-h-screen w-full bg-canvas">
      <Rail active={active} accountName={accountName} onNavigate={onNavigate} onNewShare={onNewShare} />

      <main className="mx-auto w-full max-w-[1080px] flex-1 px-5 py-11 pb-28 md:px-8 md:pb-11 xl:px-12">
        {children}
      </main>

      <div className="fixed inset-x-0 bottom-0 z-40 flex justify-center px-5 pb-5 md:hidden">
        <TabBar
          active={active}
          onSelect={(key) => onNavigate?.(key as SenderDestination)}
          items={DESTINATIONS.map(({ key, mobileLabel, icon }) => ({ key, label: mobileLabel, icon }))}
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Recipient top bar — pen ids eIlQN (desktop) / dzqQ7 (mobile) "Top Bar".
// 64px, $surface, 1px hairline bottom, wordmark left. Everything right of
// the wordmark — scope chips, the countdown — is a slot: this chrome does
// not know what a recipient screen has to say, only how to frame it. No
// rail, no tabs: a recipient has no account and nothing to navigate.
// ---------------------------------------------------------------------------

export function RecipientTopBar({ children }: { children?: ReactNode }) {
  return (
    <header className="flex h-16 w-full shrink-0 items-center gap-4 border-b border-hairline bg-surface px-5 md:px-8 xl:px-12">
      <span className="shrink-0 text-[17px] font-semibold tracking-[-0.35px] text-ink">healthsend</span>
      <div className="flex-1" />
      {children}
    </header>
  )
}
