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
import { Card, ScreenHeader } from "@/components/ui"

export default function ChromePreview() {
  const [active, setActive] = useState<SenderDestination>("archive")

  return (
    <div className="flex min-h-full flex-col">
      <SenderChrome active={active} accountName="Giulia" onNavigate={setActive}>
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
        </div>
      </SenderChrome>

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
    </div>
  )
}
