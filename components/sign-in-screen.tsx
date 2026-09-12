"use client"

import { CONNECT_CONTAINER_ID } from "@/lib/swarm"
import { InsetNote } from "@/components/ui"

/**
 * 1.2 Sign in — frames `BsnX6` (desktop) / `GdIlc` (mobile), read via the
 * pencil MCP tool against `healthsend.pen`, not a screenshot. One responsive
 * tree rather than two, since only the copy in `Alt`/`Note` genuinely
 * differs between the frames — everything else is the same content at a
 * different size.
 *
 * `app/(sender)/layout.tsx` keeps this component mounted for the life of the
 * sender routes and only ever hides it with the `hidden` class once the user
 * signs in. It never stops rendering this tree from a parent branch — that
 * would unmount `CONNECT_CONTAINER_ID` along with it, tear down the Swarm ID
 * iframe mounted inside, and leave every later call failing with "Iframe not
 * initialized". See `CLAUDE.md`.
 */
export function SignInScreen() {
  return (
    <div className="flex min-h-screen w-full flex-col bg-canvas">
      <header className="flex h-[74px] w-full shrink-0 items-center px-5 md:h-[76px] md:px-16">
        <span className="text-[15px] font-semibold tracking-[-0.3px] text-ink md:text-[20px] md:tracking-[-0.45px]">
          healthsend
        </span>
      </header>

      <div className="flex w-full flex-1 flex-col px-6 pb-7 pt-10 md:items-center md:justify-center md:px-16 md:py-20">
        <div className="flex w-full flex-col gap-5 md:w-[460px] md:gap-6">
          <h1 className="text-[34px] font-bold leading-[1.1] tracking-[-0.8px] text-ink md:text-[44px] md:tracking-[-1px]">
            Sign in
          </h1>

          <p className="text-[15px] leading-[1.5] text-secondary md:text-[17px]">
            Use your face, your fingerprint or your screen lock. There is no password to choose,
            and none for us to lose.
          </p>

          {/*
            The Swarm ID iframe paints its own button in here — never a button
            of ours; a custom one is broken on the deployed origin
            (snaha/swarm-id#613). `lib/swarm.ts`'s `buttonConfig` styles it to
            this slot (ink fill, 14px radius) — background colour, text colour
            and radius are the only knobs the iframe exposes. It has no slot
            for the frame's fingerprint icon.
          */}
          <div
            id={CONNECT_CONTAINER_ID}
            className="h-[54px] w-full shrink-0 overflow-hidden rounded-control md:h-14"
          />

          <p className="text-[13px] leading-[1.45] text-secondary md:hidden">
            On a new phone? The same face opens the same archive — nothing to copy across.
          </p>
          <p className="hidden text-[13.5px] leading-[1.45] text-secondary md:block">
            Signing in on a new device? The same face or fingerprint opens the same archive —
            nothing to copy across.
          </p>

          <div className="h-px w-full bg-hairline" />

          {/* Inert: H-21 builds the sign-in moment, not the archive-creation
              flow behind it. Same pattern as the rail's "assistant" item in
              components/chrome.tsx — styled, not yet wired to a route. */}
          <div className="flex w-full items-center gap-2">
            <span className="text-sm text-secondary">First time here?</span>
            <span className="text-sm font-semibold text-navy">Create your archive</span>
          </div>

          <div className="flex-1 md:hidden" />

          <InsetNote>
            <span className="md:hidden">
              This creates an account only you can open. We hold no password, no email list and
              no copy of your health data.
            </span>
            <span className="hidden md:inline">
              This creates an account only you can open. We hold no password, no email list and
              no copy of your health data — there is nothing here for us to hand over or lose.
            </span>
          </InsetNote>
        </div>
      </div>
    </div>
  )
}
