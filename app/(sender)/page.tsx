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
import { loadMyArchive } from "@/lib/archive-store"
import type { ArchiveRecord, BloodPanelRecord, WearableSeriesRecord } from "@/lib/archive"

/**
 * 2.1 "Your archive" — pen ids `ACUf3` (desktop) / `zsDfc` (mobile), read via
 * the pencil MCP tool against `healthsend.pen`, not a screenshot.
 *
 * Groups read from `lib/archive.ts` (H-13), which defines only two record
 * kinds — `blood-panel` and `wearable-series`. Medications and Notes have no
 * archive model yet, so those two groups remain empty until a later story adds
 * one. Signed-in senders load their encrypted archive through its identity-owned
 * Swarm feed. The screen keeps loading, empty and failure states distinct.
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

type ArchiveLoadState =
  | { status: "loading" }
  | { status: "ready"; records: ArchiveRecord[] }
  | { status: "error"; message: string }

const ARCHIVE_LOAD_TIMEOUT_MS = 15_000

type FocusData = {
  /** Distinct recipients, not grants — two live shares to the same recipient are one person. */
  peopleCount: number
  sharesCount: number
  soonestExpiresAt: number
  opens: number
  now: number
}

/** `grant.recipient` is the sender's own HMAC of the recipient label (`blindAttribute`,
 * lib/crypto.ts): deterministic per label, so two grants to the same recipient carry the
 * same blinded value without this ever decrypting who they are. */
function countUniqueRecipients(grants: { recipient: string }[]): number {
  return new Set(grants.map((g) => g.recipient)).size
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
  const [archive, setArchive] = useState<ArchiveLoadState>({ status: "loading" })
  const [focus, setFocus] = useState<FocusData | null>(null)

  useEffect(() => {
    let cancelled = false
    let timeout: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<never>((_, reject) => {
      timeout = setTimeout(
        () => reject(new Error("The archive request took too long. Try again.")),
        ARCHIVE_LOAD_TIMEOUT_MS,
      )
    })

    void Promise.race([loadMyArchive(), deadline])
      .then((loaded) => {
        if (!cancelled) setArchive({ status: "ready", records: loaded.records })
      })
      .catch((cause) => {
        if (!cancelled) setArchive({ status: "error", message: (cause as Error).message })
      })
      .finally(() => {
        if (timeout) clearTimeout(timeout)
      })

    return () => {
      cancelled = true
      if (timeout) clearTimeout(timeout)
    }
  }, [])

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
        peopleCount: countUniqueRecipients(grants),
        sharesCount: grants.length,
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

  const records = archive.status === "ready" ? archive.records : []
  const bloodPanels = records.filter((r): r is BloodPanelRecord => r.kind === "blood-panel")
  const wearables = records.filter((r): r is WearableSeriesRecord => r.kind === "wearable-series")

  return (
    <div className="flex w-full flex-col gap-7 md:gap-[30px]">
      <ArchiveHeader />

      {focus && focus.sharesCount > 0 && <FocusSurface focus={focus} />}

      {archive.status === "loading" ? (
        <div role="status" className="rounded-inset bg-grouped p-[18px] text-[15px] text-secondary">
          Opening your archive…
        </div>
      ) : archive.status === "error" ? (
        <div role="alert" className="rounded-inset border border-error/20 bg-grouped p-[18px] text-[15px] text-error">
          Could not load your archive: {archive.message}
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <span className="text-eyebrow uppercase text-muted">Five groups · four you can send</span>
            <div className="h-px w-full bg-hairline" />
          </div>

          {/* Mobile — five compact 62px list rows (frame `zsDfc`), not the desktop card
              grid shrunk to one column: `n7oJQ`'s rows sit in a 9px-gapped flex column,
              each a fixed 62px shell (30px glyph, two-line stack, a right-aligned pill),
              which is a different component from `BucketCard` below, not a breakpoint
              variant of it. */}
          <div className="flex flex-col gap-[9px] md:hidden">
            <BucketRow icon={FirstAidKit} name="Blood panels" meta={bloodPanelsMeta(bloodPanels)} />
            <BucketRow icon={Heartbeat} name="Wearables" meta={wearablesMeta(wearables)} />
            <BucketRow icon={Pill} name="Medications" meta={null} />
            <BucketRow icon={BookOpen} name="Notes" meta={null} />
            <IdentityRow />
          </div>

          <div className="hidden md:grid md:grid-cols-2 md:gap-5 xl:grid-cols-4">
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
          </div>

          <div className="hidden md:block">
            <IdentityInset />
          </div>
        </>
      )}
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
  const peopleLabel = focus.peopleCount === 1 ? "One person" : `${focus.peopleCount} people`
  const seesVerb = focus.peopleCount === 1 ? "sees" : "see"
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
          <FocusStat value={String(focus.sharesCount)} label="Shares open" />
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
          {peopleLabel} {seesVerb} part of it
        </p>
        <div className="flex gap-5 rounded-[12px] border border-hairline-on-dark bg-panel-on-dark p-[11px]">
          <FocusStat value={String(focus.sharesCount)} label="Shares open" stretch small />
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
// Bucket row — pen id `r0sjvj` and siblings under `n7oJQ` (mobile only). A
// fixed 62px shell measured off the frame: a 14px inset to a 30px glyph, an
// 11px gap to the title/meta stack, a right-aligned pill. Read via the
// pencil MCP tool against `healthsend.pen`, not a screenshot — the desktop
// `BucketCard` below is a different component, not this one reflowed, and
// carries its own share-count-pill note.
// ---------------------------------------------------------------------------

function BucketRow({
  icon: Icon,
  name,
  meta,
}: {
  icon: PhosphorIcon
  name: string
  meta: string | null
}) {
  return (
    <Link
      href="/add"
      className="flex h-[62px] w-full items-center gap-[11px] rounded-control border border-hairline bg-surface px-3.5"
    >
      <div className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-glyph bg-haze">
        <Icon size={16} weight="light" className="text-navy" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="truncate text-[15px] font-semibold text-ink">{name}</span>
        <span className="truncate text-[12.5px] text-muted">{meta ?? "Nothing here yet"}</span>
      </div>
      <span className="inline-flex h-6 shrink-0 items-center rounded-capsule border border-grouped bg-grouped px-[9px] text-[11px] font-medium text-muted">
        Not shared
      </span>
    </Link>
  )
}

// ---------------------------------------------------------------------------
// Bucket card — pen id `ZSMni` and siblings under `aRtbz`/`G0BWJ` (desktop
// only, `md` and up). The share-count pill ("In 2 shares") has no data
// source in this build: nothing tracks which archive records ended up in
// which share, so every card renders "Not shared" rather than inventing a
// count — see `## Choices`.
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
          {/* Frame `whPAl`. True since H-36: `createSend` runs every upload
              through `importDocument` before anything is encrypted — see
              lib/sends.ts, `importForSend`. */}
          Your name and date of birth were separated from the rest the moment you imported. They
          stay on this page — no share has ever included them, and none can.
        </span>
      </div>
      <span className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-capsule border border-silver bg-surface px-3 text-[12.5px] font-semibold text-muted">
        <LockSimple size={13} weight="light" />
        Stays with you
      </span>
    </div>
  )
}
