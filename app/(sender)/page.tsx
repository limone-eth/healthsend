"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import type { Icon as PhosphorIcon } from "@phosphor-icons/react"
import {
  ArrowDown,
  BookOpen,
  FirstAidKit,
  Heartbeat,
  LockSimple,
  PaperPlaneTilt,
  Pill,
  UserCircle,
} from "@phosphor-icons/react"
import { privateKeyToAccount } from "viem/accounts"
import { useSenderIdentity } from "@/components/use-sender-identity"
import { listMySends } from "@/lib/sends"
import { getIdentity } from "@/lib/identity"
import { accessLogMessage } from "@/lib/access-log"
import type { ArchiveRecord, BloodPanelRecord, WearableSeriesRecord } from "@/lib/archive"

/**
 * 2.1 "Your archive" — pen ids `ACUf3` (desktop) / `zsDfc` (mobile), read via
 * the pencil MCP tool against `healthsend.pen`, not a screenshot.
 *
 * Groups read from `lib/archive.ts` (H-13), which defines only two record
 * kinds — `blood-panel` and `wearable-series`. Medications and Notes have no
 * archive model yet, so those two groups are permanently empty until a later
 * story adds one; this is stated, not hidden, in `## Choices`. There is also
 * no loader wired from storage to this screen yet (no manifest, see
 * `docs/archive-model.md`), so `records` starts empty rather than reading a
 * fixture — the honest state of a real sign-in today.
 */

const isoDayMonth = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: "UTC" })
function formatIsoDate(iso: string): string {
  return isoDayMonth.format(new Date(`${iso}T00:00:00.000Z`))
}

const weekdayFormatter = new Intl.DateTimeFormat("en-GB", { weekday: "long" })
const dayMonthFormatter = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long" })

function isWithinAWeek(expiresAt: number, now: number): boolean {
  return expiresAt - now <= 7 * 86400
}

function bloodPanelsMeta(records: BloodPanelRecord[]): string | null {
  if (records.length === 0) return null
  const latest = records.reduce((a, b) => (a.takenOn > b.takenOn ? a : b))
  const noun = records.length === 1 ? "panel" : "panels"
  return `${records.length} ${noun} · latest ${formatIsoDate(latest.takenOn)}`
}

function wearablesMeta(records: WearableSeriesRecord[]): string | null {
  if (records.length === 0) return null
  const latest = records.reduce((a, b) => (a.range.through > b.range.through ? a : b))
  const noun = records.length === 1 ? "kind" : "kinds"
  return `${records.length} ${noun} · latest ${formatIsoDate(latest.range.through)}`
}

type FocusData = {
  count: number
  soonestExpiresAt: number
  opens: number
  now: number
}

/** Mirrors `app/(sender)/shares/access-log-client.ts`'s signed request, kept
 * local rather than imported so this screen has no dependency on a directory
 * another worker is actively changing. */
async function countOpens(entityKey: string): Promise<number> {
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
    if (!response.ok) return 0
    const body = (await response.json()) as { opened: number[] }
    return body.opened.length
  } catch {
    return 0
  }
}

export default function ArchivePage() {
  const { info, identity } = useSenderIdentity()
  if (!(info.identity && identity.address)) return null
  return <ArchiveScreen />
}

function ArchiveScreen() {
  const [focus, setFocus] = useState<FocusData | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      let grants: Awaited<ReturnType<typeof listMySends>>
      try {
        grants = await listMySends()
      } catch {
        return
      }
      if (cancelled || grants.length === 0) return
      const soonest = grants.reduce((a, b) => (a.expiresAt < b.expiresAt ? a : b))
      const perShareOpens = await Promise.all(grants.map((g) => countOpens(g.entityKey)))
      if (cancelled) return
      setFocus({
        count: grants.length,
        soonestExpiresAt: soonest.expiresAt,
        opens: perShareOpens.reduce((a, b) => a + b, 0),
        now: Math.floor(Date.now() / 1000),
      })
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  // No loader exists yet from Swarm storage into this model — see the file
  // header — so every group starts from an empty record set.
  const records: ArchiveRecord[] = []
  const bloodPanels = records.filter((r): r is BloodPanelRecord => r.kind === "blood-panel")
  const wearables = records.filter((r): r is WearableSeriesRecord => r.kind === "wearable-series")

  return (
    <div className="flex w-full flex-col gap-7 md:gap-[30px]">
      <ArchiveHeader />

      {focus && focus.count > 0 && <FocusSurface focus={focus} />}

      <div className="flex flex-col gap-2">
        <span className="text-eyebrow uppercase text-muted">Five groups · four you can send</span>
        <div className="h-px w-full bg-hairline" />
      </div>

      <div className="grid grid-cols-1 gap-[9px] md:grid-cols-2 md:gap-5 xl:grid-cols-4">
        <BucketCard
          icon={FirstAidKit}
          name="Blood panels"
          meta={bloodPanelsMeta(bloodPanels)}
          addLabel="Add a panel"
        />
        <BucketCard
          icon={Heartbeat}
          name="Wearables"
          meta={wearablesMeta(wearables)}
          addLabel="Add wearable data"
        />
        <BucketCard icon={Pill} name="Medications" meta={null} addLabel="Add a medication" />
        <BucketCard icon={BookOpen} name="Notes" meta={null} addLabel="Write a note" />
        <div className="md:hidden">
          <IdentityRow />
        </div>
      </div>

      <div className="hidden md:block">
        <IdentityInset />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Header — pen ids `V0uFg`/`fxk2O`/`u0evW` (desktop, a row) and `gm3wF`/`PBDUV`
// (mobile, stacked with the Add action full-width below rather than beside
// the title). Desktop and mobile copy differ, read from each frame's own
// `content` fields rather than assumed to match — see `docs/stories/H-17.md`.
// ---------------------------------------------------------------------------

function ArchiveHeader() {
  return (
    <>
      <div className="flex flex-col gap-3.5 md:hidden">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-display-mobile text-ink">Your archive</h1>
          <p className="text-[15px] leading-[1.45] text-secondary">
            Everything you have imported, in five groups.
          </p>
        </div>
        <AddToArchiveButton className="w-full" />
      </div>

      <div className="hidden items-end justify-between gap-6 md:flex">
        <div className="flex flex-col gap-2">
          <h1 className="text-display text-ink">Your archive</h1>
          <p className="max-w-[760px] text-[17px] leading-[1.45] tracking-[-0.25px] text-secondary">
            Everything you have imported, in five groups. Nothing leaves this page unless you send
            it.
          </p>
        </div>
        <AddToArchiveButton />
      </div>
    </>
  )
}

function AddToArchiveButton({ className = "" }: { className?: string }) {
  return (
    <Link
      href="/add"
      className={`inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-control bg-ink px-5 text-[15px] font-semibold tracking-[-0.15px] text-surface ${className}`}
    >
      <ArrowDown size={17} weight="regular" />
      Add to your archive
    </Link>
  )
}

// ---------------------------------------------------------------------------
// Focus surface — pen ids `dXUx2` (desktop) / `S0DJC` (mobile), the one focus
// surface this screen carries (DESIGN.md "at most one per screen"). Built
// from `lib/sends.ts`'s live grants rather than the shared `FocusCard`
// primitive in `components/ui.tsx`, whose eyebrow icon and headline size are
// hardcoded to a different frame — see `## Choices`. Hidden entirely when
// there is nothing to report, per DESIGN.md's rule for this component.
// ---------------------------------------------------------------------------

function FocusSurface({ focus }: { focus: FocusData }) {
  const peopleLabel = focus.count === 1 ? "One person" : `${focus.count} people`
  const closing = isWithinAWeek(focus.soonestExpiresAt, focus.now)
  const soonestDate = new Date(focus.soonestExpiresAt * 1000)
  const soonestStat = closing ? weekdayFormatter.format(soonestDate) : dayMonthFormatter.format(soonestDate)
  const soonestPhrase = closing ? `this ${soonestStat}` : `on ${soonestStat}`
  const gradientStyle = {
    background: "linear-gradient(155deg, var(--color-grad-focus-from) 0%, var(--color-grad-focus-to) 100%)",
  }

  return (
    <>
      <div
        className="hidden w-full flex-col justify-end gap-3.5 rounded-card border border-hairline-on-dark p-6 shadow-focus md:flex"
        style={gradientStyle}
      >
        <div className="flex items-center gap-2">
          <PaperPlaneTilt size={16} weight="light" className="text-haze-strong" />
          <span className="text-eyebrow uppercase text-haze-strong">Right now</span>
        </div>
        <p className="text-[26px] font-bold leading-[1.22] tracking-[-0.6px] text-white">
          {peopleLabel} can see part of your archive
        </p>
        <p className="max-w-[640px] text-[15px] leading-[1.5] text-[#E4E5E7]">
          Each one ends on its own date, without you doing anything. The soonest is {soonestPhrase}.
        </p>
        <div className="flex gap-7 rounded-control border border-hairline-on-dark bg-panel-on-dark p-3.5">
          <FocusStat value={String(focus.count)} label="Shares open" />
          <FocusStat value={soonestStat} label="Soonest to end" />
          <FocusStat value={String(focus.opens)} label="Times opened" />
        </div>
      </div>

      <div
        className="flex w-full flex-col gap-2.5 rounded-card border border-hairline-on-dark p-[18px] md:hidden"
        style={gradientStyle}
      >
        <span className="text-[11px] font-semibold uppercase tracking-[1.3px] text-haze-strong">Right now</span>
        <p className="text-[19px] font-bold leading-[1.25] tracking-[-0.4px] text-white">
          {peopleLabel} see part of it
        </p>
        <div className="flex gap-5 rounded-[12px] border border-hairline-on-dark bg-panel-on-dark p-[11px]">
          <FocusStat value={String(focus.count)} label="Shares open" stretch small />
          <FocusStat value={soonestStat} label="Soonest" stretch small />
          <FocusStat value={String(focus.opens)} label="Times opened" stretch small />
        </div>
      </div>
    </>
  )
}

function FocusStat({
  value,
  label,
  stretch = false,
  small = false,
}: {
  value: string
  label: string
  stretch?: boolean
  small?: boolean
}) {
  return (
    <div className={`flex flex-col gap-0.5 ${stretch ? "flex-1" : ""}`}>
      <span className={`font-semibold tracking-[-0.2px] text-white ${small ? "text-[15px]" : "text-[17px]"}`}>
        {value}
      </span>
      <span className={`text-silver ${small ? "text-[11px]" : "text-[12px]"}`}>{label}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Bucket card — pen id `ZSMni` and siblings under `aRtbz`/`G0BWJ` (desktop),
// `r0sjvj` and siblings under `n7oJQ` (mobile). The share-count pill
// ("In 2 shares") has no data source in this build: nothing tracks which
// archive records ended up inside which share, so every card renders "Not
// shared" rather than inventing a count — see `## Choices`.
// ---------------------------------------------------------------------------

function BucketCard({
  icon: Icon,
  name,
  meta,
  addLabel,
}: {
  icon: PhosphorIcon
  name: string
  meta: string | null
  addLabel: string
}) {
  return (
    <div className="flex w-full flex-col gap-3 rounded-card border border-black/[0.05] bg-surface p-5 shadow-card">
      <div className="flex w-full items-center justify-between">
        <div className="flex h-[34px] w-[34px] items-center justify-center rounded-glyph bg-haze">
          <Icon size={18} weight="light" className="text-navy" />
        </div>
        <span className="inline-flex h-[26px] items-center rounded-capsule border border-grouped bg-grouped px-[10px] text-[12px] font-medium text-muted">
          Not shared
        </span>
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-[17px] font-semibold leading-[1.3] tracking-[-0.25px] text-ink">{name}</p>
        <p className="text-[13px] leading-[1.4] text-muted">{meta ?? "Nothing here yet"}</p>
      </div>
      <div className="h-px w-full bg-hairline" />
      <Link href="/add" className="flex items-center gap-[7px] pt-0.5">
        <ArrowDown size={15} weight="regular" className="text-navy" />
        <span className="text-[13px] font-semibold text-navy">{addLabel}</span>
      </Link>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Identity — pen id `z2DL5o` (desktop, an inset note below the grid) and
// `iSyOR` (mobile, the fifth row inside the same list as the other groups).
// Never opens, never gets an Add: locked per DESIGN.md's scope-row rule for
// identity, and per the frame itself — see `## Choices`. This is the health
// record's own set-aside identifiers (name, date of birth), not the signed-in
// Swarm ID passkey account, which the `(sender)` layout already surfaces
// above this page on every sender route.
// ---------------------------------------------------------------------------

function IdentityRow() {
  return (
    <div className="flex h-[62px] w-full items-center gap-[11px] rounded-control border border-hairline bg-disabled px-3.5">
      <div className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-glyph bg-silver">
        <UserCircle size={16} weight="light" className="text-muted" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="truncate text-[15px] font-semibold text-muted">Identity</span>
        <span className="truncate text-[12.5px] text-muted">Name and date of birth</span>
      </div>
      <span className="inline-flex h-6 shrink-0 items-center rounded-capsule border border-silver bg-surface px-[9px] text-[11px] font-medium text-secondary">
        Stays with you
      </span>
    </div>
  )
}

function IdentityInset() {
  return (
    <div className="flex w-full items-center gap-3.5 rounded-inset bg-grouped p-[18px]">
      <div className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-glyph bg-disabled">
        <UserCircle size={17} weight="light" className="text-muted" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[15px] font-semibold text-secondary">Identity</span>
        <span className="text-[13px] leading-[1.45] text-secondary">
          {/* The frame (`whPAl`) reads "Your name and date of birth were separated
              from the rest the moment you imported. They stay on this page — no
              share has ever included them, and none can." That is the intended end
              state and it is not true yet: `createSend` reads each file straight
              into `packEnvelope`, so nothing strips identifiers on the way out
              (H-36). Restore the frame's sentence verbatim when H-36 lands — the
              screen must not claim a protection the upload path does not perform. */}
          Your name and date of birth are meant to stay on this page and never travel with a
          share. That step is built and tested but not yet wired into the upload path, so for
          now a document is sent exactly as it is.
        </span>
      </div>
      <span className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-capsule border border-silver bg-surface px-3 text-[12.5px] font-semibold text-muted">
        <LockSimple size={13} weight="light" />
        Stays with you
      </span>
    </div>
  )
}
