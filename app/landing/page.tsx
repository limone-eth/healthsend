"use client"

/**
 * The only Persuade surface in the product. Built from `healthsend.pen`
 * frames `xKspH` (desktop) and `t659K4` (mobile) — read node-by-node via the
 * pencil MCP tool, not from a screenshot. Every string below is copied
 * verbatim from a `content` field, with one named exception: see `Claim`'s
 * own doc comment.
 *
 * The two frames are not the same copy at two widths: `t659K4` shortens
 * several descriptions and drops two strings outright (the hero's second
 * button, the final section's subtitle and the footer wordmark). Rather than
 * force one merged copy deck, each differing string renders as a mobile/desktop
 * pair toggled with `md:` breakpoint classes, so each width shows exactly what
 * its frame says.
 */

import type { ReactNode } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  FirstAidKit,
  Sparkle,
  ShieldCheck,
  UserCircle,
} from "@phosphor-icons/react"
import { Action } from "@/components/ui"

const cardShell = "rounded-card bg-surface shadow-card"

function Glyph({ icon: Icon }: { icon: typeof FirstAidKit }) {
  return (
    <div className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-glyph bg-grouped md:h-[34px] md:w-[34px]">
      <Icon size={17} weight="light" className="text-secondary" />
    </div>
  )
}

function NumberBadge({ n }: { n: number }) {
  return (
    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-capsule bg-haze md:h-8 md:w-8">
      <span className="text-[13.5px] font-bold text-navy md:text-[15px]">{n}</span>
    </div>
  )
}

function PanelCard({
  badge,
  title,
  desktopBody,
  mobileBody,
}: {
  badge: ReactNode
  title: string
  desktopBody: string
  mobileBody: string
}) {
  return (
    <div className={`flex w-full flex-col gap-[9px] p-[18px] md:gap-3 md:p-6 ${cardShell}`}>
      {badge}
      <p className="text-[16px] font-semibold tracking-[-0.25px] text-ink md:text-[18px] md:tracking-[-0.3px]">
        {title}
      </p>
      <p className="text-[13.5px] leading-[1.5] text-secondary md:hidden">{mobileBody}</p>
      <p className="hidden text-[14.5px] leading-[1.5] text-secondary md:block">{desktopBody}</p>
    </div>
  )
}

function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <p className={`text-[11px] font-semibold tracking-[1.3px] text-navy md:text-[12px] md:tracking-[1.4px] ${className}`}>
      {children}
    </p>
  )
}

export default function LandingPage() {
  return (
    <main className="w-full overflow-x-hidden bg-canvas">
      <Nav />
      <Hero />
      <Problem />
      <HowItWorks />
      <Claim />
      <Assistant />
      <Final />
    </main>
  )
}

function Nav() {
  return (
    <div className="flex h-[74px] w-full items-center justify-between px-5 md:h-[76px] md:px-16">
      <span className="text-[16px] font-semibold tracking-[-0.35px] text-ink md:text-[20px] md:tracking-[-0.45px]">
        healthsend
      </span>
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          className="flex h-[34px] items-center justify-center rounded-control border border-hairline bg-surface px-[13px] text-[13px] font-semibold text-ink md:h-10 md:px-4 md:text-[14px]"
        >
          Sign in
        </button>
        <Link
          href="/"
          className="hidden h-10 items-center justify-center rounded-control bg-ink px-4 text-[14px] font-semibold text-surface md:flex"
        >
          Create your archive
        </Link>
      </div>
    </div>
  )
}

/**
 * `Action` renders a plain `<button>` with no navigation of its own — see
 * `components/ui.tsx`. The Nav bar's own "Create your archive" `Link` is
 * `hidden` below `md`, so before this fix the hero and final `Action`s were
 * the page's only entry point at phone width, and neither one navigated
 * anywhere: R2-011. `router.push` gives both a real destination.
 */
function Hero() {
  const router = useRouter()
  return (
    <div className="flex w-full flex-col items-center px-6 pb-11 pt-11 md:px-16 md:pb-20 md:pt-[92px]">
      <div className="flex w-full max-w-[900px] flex-col items-center gap-[18px] md:gap-[22px]">
        <h1 className="w-full whitespace-pre-line text-[42px] font-bold leading-[1.08] tracking-[-1.3px] text-ink md:text-center md:text-[72px] md:leading-[1.06] md:tracking-[-2.2px]">
          {"Lend your health data.\nDon't give it away."}
        </h1>
        <p className="w-full text-[16px] leading-[1.5] text-secondary md:hidden">
          Send a coach, a clinician or your assistant exactly what they need — for exactly as long
          as you are working together. Then it ends on its own.
        </p>
        <p className="hidden w-[720px] max-w-full text-center text-[19px] leading-[1.5] text-secondary md:block">
          Send a coach, a clinician or your assistant exactly what they need — for exactly as long
          as you are working together. Then it ends on its own, without you remembering.
        </p>
        <div className="flex w-full flex-col gap-3 pt-2.5 md:w-auto md:flex-row md:items-center">
          <Action variant="primary" fullWidth className="md:w-auto" onClick={() => router.push("/")}>
            Create your archive
          </Action>
          <div className="hidden md:block">
            <Action variant="secondary">See what a recipient gets</Action>
          </div>
        </div>
        <p className="text-center text-[13px] text-muted md:text-[14px]">
          No password. No wallet. Nothing to install.
        </p>
      </div>
    </div>
  )
}

const PROBLEM_CARDS = [
  {
    icon: FirstAidKit,
    title: "The lab that saw you once",
    desktopBody:
      "It still has your panel. There was never a moment where that access was supposed to end, so it did not.",
    mobileBody: "It still has your panel. Nobody built a moment where that access ends.",
  },
  {
    icon: UserCircle,
    title: "A twelve-week coach",
    desktopBody:
      "Keeps a PDF of your bloods in her inbox long after the twelve weeks are over. Not out of malice — nobody built her a way to give it back.",
    mobileBody: "Keeps a PDF of your bloods long after the twelve weeks are over.",
  },
  {
    icon: Sparkle,
    title: "An assistant you use daily",
    desktopBody:
      "Gets nothing, or gets your history pasted into a chat window where it stays for good. Most people choose nothing.",
    mobileBody: "Gets nothing, or gets everything pasted into a chat that keeps it.",
  },
]

function Problem() {
  return (
    <div className="flex w-full flex-col items-center px-6 pb-11 md:px-16 md:pb-20">
      <div className="flex w-full max-w-[1120px] flex-col gap-4 md:gap-[26px]">
        <Eyebrow>THE PROBLEM</Eyebrow>
        <h2 className="w-full max-w-[780px] text-[27px] font-bold leading-[1.18] tracking-[-0.6px] text-ink md:text-[38px] md:leading-[1.15] md:tracking-[-0.9px]">
          Right now, sharing health data means sharing it forever.
        </h2>
        <div className="flex w-full flex-col gap-4 md:flex-row md:gap-5">
          {PROBLEM_CARDS.map((card) => (
            <div key={card.title} className="w-full md:flex-1">
              <PanelCard
                badge={<Glyph icon={card.icon} />}
                title={card.title}
                desktopBody={card.desktopBody}
                mobileBody={card.mobileBody}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

const STEPS = [
  {
    n: 1,
    title: "Bring it together",
    // The frame's copy is "Your name and date of birth are set aside as they
    // come in, so they are never part of anything you send." That is the
    // intended end state and it is not true yet: `createSend` reads each file
    // straight into the envelope, so nothing strips identifiers on the way out
    // (H-36). The screens audit filed it as F-01, critical — a public page
    // telling a sender their identifiers are removed is the one claim in this
    // product that could cause someone to send identifying health data they
    // would otherwise have withheld.
    //
    // Restore the frame's sentence verbatim, at both sizes, when H-36 lands.
    desktopBody:
      "Drop in an export from your watch and a lab result. Setting your name and date of birth aside is built and tested, but not yet wired into sending — for now a file is sent exactly as it is.",
    mobileBody:
      "Drop in an export and a lab result. Setting your name aside is built, but not yet wired into sending.",
  },
  {
    n: 2,
    title: "Choose what to send",
    desktopBody:
      "Tick the groups, or open one and pick a single blood panel or a range of dates. Set the day it should end. Nothing is chosen for you.",
    mobileBody: "Tick groups, or open one and pick a single panel. Set the day it ends.",
  },
  {
    n: 3,
    title: "It ends by itself",
    desktopBody:
      "On the date you set, the link stops working. You do not have to remember, and there is nobody to ask.",
    mobileBody: "On the date you set, the link stops working. Nobody to ask.",
  },
]

function HowItWorks() {
  return (
    <div className="flex w-full flex-col items-center px-6 pb-11 md:px-16 md:pb-20">
      <div className="flex w-full max-w-[1120px] flex-col gap-4 md:gap-[26px]">
        <Eyebrow>HOW IT WORKS</Eyebrow>
        <h2 className="w-full max-w-[780px] text-[27px] font-bold leading-[1.18] tracking-[-0.6px] text-ink md:text-[38px] md:leading-[1.15] md:tracking-[-0.9px]">
          Three steps, and the last one happens without you.
        </h2>
        <div className="flex w-full flex-col gap-4 md:flex-row md:gap-5">
          {STEPS.map((step) => (
            <div key={step.n} className="w-full md:flex-1">
              <PanelCard
                badge={<NumberBadge n={step.n} />}
                title={step.title}
                desktopBody={step.desktopBody}
                mobileBody={step.mobileBody}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * The body copy below departs from frame nodes `n3zZt5` (desktop) / `svn2t`
 * (mobile), which say deletion happens exactly "when the date passes." It
 * does not: `lib/holder-store.ts`'s `TTL_GRACE_SECONDS` adds an hour to the
 * holder's TTL so it never undercuts the window Arkiv promised, so the held
 * share can outlive the stated date by up to an hour. H-47 states that bound
 * here rather than repeating the frame's more exact-sounding claim. The
 * canvas is untouched — this story's canvas-write scope is the pronoun sweep
 * only — so the frame and the build now read differently on purpose.
 */
function Claim() {
  return (
    <div className="flex w-full flex-col items-center px-6 pb-11 md:px-16 md:pb-20">
      <div className="flex w-full max-w-[1120px] flex-col">
        <div
          className="flex w-full flex-col gap-3.5 rounded-[22px] border border-white/10 p-[22px] md:gap-5 md:rounded-sheet md:p-11"
          style={{
            background:
              "linear-gradient(155deg, var(--color-grad-focus-from) 0%, var(--color-grad-focus-to) 100%)",
          }}
        >
          <p className="text-[11px] font-semibold tracking-[1.3px] text-haze-strong md:text-[12px] md:tracking-[1.4px]">
            WHAT MAKES IT DIFFERENT
          </p>
          {/* text-white, not text-surface: this sits on the permanent dark gradient,
              which does not flip with the theme, while `surface` correctly does. Same
              fix H-27 applied inside FocusCard. */}
          <h2 className="text-[24px] font-bold leading-[1.25] tracking-[-0.55px] text-white md:w-[820px] md:text-[34px] md:leading-[1.2] md:tracking-[-0.8px]">
            Most tools let you revoke access. That means asking a company to stop showing your
            data.
          </h2>
          <p className="text-[15px] leading-[1.55] text-[#E4E5E7] md:w-[820px] md:text-[17px]">
            Here, when the date passes, the half of the key we hold is deleted within the hour
            that follows — a stated bound, not an instant. Not a promise to stop showing your
            data — once that hour passes, there is nothing left to put back together.
          </p>
          <div className="flex w-full gap-2.5 rounded-[14px] border border-hairline-on-dark bg-panel-on-dark p-3.5 md:gap-[11px] md:rounded-inset md:p-[18px]">
            <ShieldCheck size={16} weight="light" className="mt-0.5 shrink-0 text-silver" />
            <p className="text-[12.5px] leading-[1.5] text-silver md:hidden">
              What we will not claim: someone who read your results during the window has read
              them. What ends is their access to anything more.
            </p>
            <p className="hidden text-[14px] leading-[1.5] text-silver md:block">
              What we will not claim: someone who read your results during the window has read
              them. We cannot reach into their memory, and we will never tell you otherwise. What
              ends is their access to anything more.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

function Assistant() {
  return (
    <div className="flex w-full flex-col items-center px-6 pb-11 pt-9 md:px-16 md:pb-20 md:pt-0">
      <div className="flex w-full max-w-[1120px] flex-col gap-3 md:gap-[26px]">
        <Eyebrow className="text-muted md:text-navy">AND YOUR ASSISTANT</Eyebrow>
        <h2 className="text-[26px] font-semibold leading-[1.15] tracking-[-0.6px] text-ink md:w-[860px] md:text-[38px] md:font-bold md:tracking-[-0.9px]">
          Let it read four weeks of sleep. Not your name, and not for ever.
        </h2>
        <p className="text-[14.5px] leading-[1.5] text-secondary md:w-[820px] md:text-[17px] md:leading-[1.55]">
          Connect the assistant you already use to a slice of your archive for a set number of
          weeks. It answers from your real numbers in summaries, is never told whose they are, and
          on the date you chose it simply stops being able to read anything.
        </p>
      </div>
    </div>
  )
}

function Final() {
  const router = useRouter()
  return (
    <div className="flex w-full flex-col items-center px-6 pb-10 md:px-16 md:pb-24">
      <div className="flex w-full max-w-[1120px] flex-col gap-4 md:gap-[26px]">
        <h2 className="text-center text-[30px] font-bold leading-[1.12] tracking-[-0.75px] text-ink md:text-[44px] md:leading-[1.1] md:tracking-[-1.1px]">
          Start with one blood panel.
        </h2>
        <p className="hidden text-center text-[17px] leading-[1.5] text-secondary md:block">
          Signing in takes one tap and creates nothing we can read.
        </p>
        <div className="flex w-full justify-center pt-1.5 md:pt-[6px]">
          <Action variant="primary" fullWidth className="md:w-auto" onClick={() => router.push("/")}>
            Create your archive
          </Action>
        </div>
        <div className="h-px w-full bg-hairline" />
        <div className="flex w-full items-center justify-center md:justify-between">
          <span className="hidden text-[14px] font-semibold text-muted md:block">healthsend</span>
          <p className="text-center text-[12px] leading-[1.45] text-muted md:text-left md:text-[13px] md:leading-normal">
            Your files are stored on Swarm. Your shares are recorded on Arkiv. Neither can read
            them.
          </p>
        </div>
      </div>
    </div>
  )
}
