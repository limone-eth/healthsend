"use client"

/**
 * Review harness for H-3's chrome: the rail, the mobile tab bar, the
 * recipient top bar, and the breakpoints between them. Not a shipped
 * screen — H-3's contract is the frame, not the pictures in it, so the
 * content below is placeholder text standing in for whatever a real
 * archive/shares/assistant screen composes into `SenderChrome` later.
 */

import { useState } from "react"
import { CalendarBlank } from "@phosphor-icons/react"
import { RecipientTopBar, SenderChrome, type SenderDestination } from "@/components/chrome"
import { Action, Card, ScreenHeader } from "@/components/ui"

export default function ChromePreview() {
  const [active, setActive] = useState<SenderDestination>("archive")
  // Real, clickable state — not a no-op — so a click here proves the same
  // thing `mobile-tab-bar-clearance.spec.ts` checks on a real screen: the
  // tab bar cannot be the element that receives the pointer.
  const [reviewed, setReviewed] = useState(false)

  return (
    <div className="flex min-h-full flex-col">
      {/*
        The recipient preview renders first and the sender chrome last —
        deliberately, not just however they happened to get typed. The fixed
        mobile tab bar only exists inside `SenderChrome`'s tree, so it is
        only the *last* section of the page whose bottom edge can ever sit
        behind it. `mobile-tab-bar-clearance.spec.ts` scrolls to the bottom
        of the whole document and expects to land in `main`, exactly as it
        did on `/import-review` before that route moved under the
        Swarm-ID-gated `(sender)` layout (H-49/R2-006) and stopped rendering
        without a live sign-in this repo has no offline stub for.
      */}
      <div className="border-t border-hairline">
        <RecipientTopBar>
          <span className="inline-flex h-8 items-center gap-1.5 rounded-capsule border border-hairline bg-surface px-3 text-label text-ink">
            <CalendarBlank size={14} weight="light" className="text-navy" />
            Ends 4 December
          </span>
        </RecipientTopBar>
        <div className="mx-auto w-full max-w-[480px] px-5 py-10">
          <p className="text-body text-secondary">Recipient page body goes here — not this story&rsquo;s job.</p>
        </div>
      </div>

      <SenderChrome active={active} onNavigate={setActive}>
        <div className="flex flex-col gap-6">
          <ScreenHeader
            title="Your archive"
            lede="Everything you have imported, in five groups. Nothing leaves this page unless you send it."
          />
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <Card>
              <h3 className="text-title text-ink">Blood panels</h3>
              <p className="mt-1 text-body text-secondary">4 panels · latest 12 August</p>
            </Card>
            <Card>
              <h3 className="text-title text-ink">Wearables</h3>
              <p className="mt-1 text-body text-secondary">2 years · five kinds</p>
            </Card>
          </div>
          {/*
            `SenderChrome`'s own container is `min-h-screen`, so short
            content just leaves empty space above `main`'s bottom padding
            rather than ever reaching it — `/import-review`'s real content
            (a full marker table) was what pushed past one screen's height
            and made that padding load-bearing. A fixed spacer reproduces
            that overflow deterministically, so `mobile-tab-bar-clearance.spec.ts`
            keeps testing `main`'s padding rather than passing regardless of
            it by coincidence of how tall the cards above happen to be.
          */}
          <div aria-hidden style={{ height: 700 }} />
          {/* The regression's one clickable, real, in-`main` control — see
              this file's top comment. */}
          <Action variant="secondary" disabled={reviewed} onClick={() => setReviewed(true)}>
            {reviewed ? "Reviewed" : "Mark reviewed"}
          </Action>
        </div>
      </SenderChrome>
    </div>
  )
}
