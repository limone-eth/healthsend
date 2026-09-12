"use client"

import { useState } from "react"
import {
  Check,
  CheckCircle,
  FirstAidKit,
  LockSimple,
  XCircle,
} from "@phosphor-icons/react"
import { InsetNote } from "@/components/ui"
import type { SetAsideIdentifiers } from "@/lib/archive"

export type MarkerRow = {
  id: string
  name: string
  /** `NaN` when import found no value to read at all — render via `formatMarkerValue`, never directly. */
  value: number
  /** A lab-style qualifier the reading was reported with (`<0.3`, `>100`) — kept as data, not a flag. */
  qualifier?: "<" | ">"
  unit: string
  /** The line in the sender's own file this reading came from. */
  snippet: string
  /** The lab's own out-of-range call (e.g. `HIGH`, `LOW`). Data about the result, not a reason to flag it. */
  labFlag?: string
  flagged: boolean
  /** Only set when `flagged` — why import is unsure of the parse, never what the lab called the result. */
  flagReason?: string
}

export type BloodPanelReviewData = {
  kind: "blood-panel"
  id: string
  label: string
  fileName: string
  markers: MarkerRow[]
  setAside: SetAsideIdentifiers
}

export type DocumentReviewData = {
  kind: "document"
  id: string
  label: string
  fileName: string
  rawText: string
  cleanedText: string
  setAside: SetAsideIdentifiers
}

export type ReviewData = BloodPanelReviewData | DocumentReviewData

type Filter = "needs-a-look" | "all"

const SET_ASIDE_FIELDS: { key: keyof SetAsideIdentifiers; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "dateOfBirth", label: "Date of birth" },
  { key: "address", label: "Address" },
  { key: "patientId", label: "Patient ID" },
]

function setAsideEntries(setAside: SetAsideIdentifiers): { label: string; value: string }[] {
  return SET_ASIDE_FIELDS.filter((field) => setAside[field.key]).map((field) => ({
    label: field.label,
    value: setAside[field.key] as string,
  }))
}

export function ReviewScreen({ reviews }: { reviews: ReviewData[] }) {
  const [selectedId, setSelectedId] = useState(reviews[0].id)
  const [confirmedIds, setConfirmedIds] = useState<ReadonlySet<string>>(new Set())
  const [filterByDoc, setFilterByDoc] = useState<Record<string, Filter>>({})

  const selected = reviews.find((review) => review.id === selectedId) ?? reviews[0]
  const confirmed = confirmedIds.has(selected.id)
  const filter = filterByDoc[selected.id] ?? "needs-a-look"

  function confirm() {
    setConfirmedIds((previous) => new Set(previous).add(selected.id))
  }

  function setFilter(next: Filter) {
    setFilterByDoc((previous) => ({ ...previous, [selected.id]: next }))
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <ReviewHeader fileName={selected.fileName} />

      {reviews.length > 1 && (
        <DocumentSwitcher reviews={reviews} selectedId={selected.id} onSelect={setSelectedId} />
      )}

      {selected.kind === "blood-panel" ? (
        <BloodPanelReview
          review={selected}
          confirmed={confirmed}
          filter={filter}
          onFilterChange={setFilter}
          onConfirm={confirm}
        />
      ) : (
        <DocumentReview review={selected} confirmed={confirmed} onConfirm={confirm} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Header — pen ids Fa59y/noTaI (desktop), Q7ZJ8u/hD9P0 (mobile). Title copy
// is identical at both breakpoints; the lede is not, so it is written out
// directly here rather than through `ScreenHeader`, which only takes one
// string. The frame's lede names one fixed file; this build reviews one of
// several real fixtures at a time, so the file name is the one substituted
// slot — everything around it is copied verbatim.
// ---------------------------------------------------------------------------

function ReviewHeader({ fileName }: { fileName: string }) {
  return (
    <div className="flex w-full flex-col gap-2">
      <h1 className="text-[34px] font-bold leading-[1.12] tracking-[-0.7px] text-ink md:text-[44px] md:leading-[1.09] md:tracking-[-0.9px]">
        Check what we read
      </h1>
      <p className="hidden text-[17px] leading-[1.47] tracking-[-0.25px] text-secondary md:block">
        These came out of {fileName}. Anything you send later is built from this list, not from
        the file — so it is worth thirty seconds now.
      </p>
      <p className="text-[15px] leading-[1.45] text-secondary md:hidden">
        From {fileName}. Anything you send is built from this list.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Document switcher — not in either frame. `importDocument` runs against all
// three fixtures this story names, but both frames review one document at a
// time, so a small switcher is the least-new-surface way to reach all three
// without inventing a second screen.
// ---------------------------------------------------------------------------

function DocumentSwitcher({
  reviews,
  selectedId,
  onSelect,
}: {
  reviews: ReviewData[]
  selectedId: string
  onSelect: (id: string) => void
}) {
  return (
    <div className="flex w-full flex-wrap gap-2">
      {reviews.map((review) => {
        const active = review.id === selectedId
        return (
          <button
            key={review.id}
            type="button"
            onClick={() => onSelect(review.id)}
            className={`h-9 rounded-capsule border px-3.5 text-label ${
              active ? "border-ink bg-ink text-surface" : "border-hairline bg-surface text-secondary"
            }`}
          >
            {review.label}
          </button>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Blood panel review — pen ids ahCJQ (desktop "Readings"), x45dk (mobile
// "Rows"). Row data (name, value, snippet, flag) comes from the actually
// imported fixture, not from the frame's own demo figures.
// ---------------------------------------------------------------------------

function BloodPanelReview({
  review,
  confirmed,
  filter,
  onFilterChange,
  onConfirm,
}: {
  review: BloodPanelReviewData
  confirmed: boolean
  filter: Filter
  onFilterChange: (filter: Filter) => void
  onConfirm: () => void
}) {
  const total = review.markers.length
  const flaggedCount = review.markers.filter((marker) => marker.flagged).length
  const cleanCount = total - flaggedCount
  const sorted = [...review.markers].sort((a, b) => Number(b.flagged) - Number(a.flagged))
  const visible = filter === "needs-a-look" ? sorted.filter((marker) => marker.flagged) : sorted
  const entries = setAsideEntries(review.setAside)

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="w-full overflow-hidden rounded-card bg-surface shadow-card">
        <div className="flex h-[52px] w-full items-center gap-3 bg-canvas px-4 md:h-[60px] md:px-5">
          <div className="flex flex-1 items-center gap-2 md:gap-[9px]">
            <div
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-[10px] ${
                flaggedCount > 0 ? "bg-chalk" : "bg-sage"
              }`}
            >
              <FirstAidKit size={15} weight="light" className={flaggedCount > 0 ? "text-umber" : "text-moss"} />
            </div>
            <span className="text-[14px] font-semibold text-ink md:text-[15px]">
              {cleanCount} of {total} read cleanly
            </span>
            {flaggedCount > 0 && (
              <>
                <span className="hidden text-[15px] font-medium text-umber md:inline">
                  ·  {flaggedCount} need a look
                </span>
                <span className="text-[13px] font-medium text-umber md:hidden">
                  {flaggedCount} need a look
                </span>
              </>
            )}
          </div>

          <div className="hidden h-9 items-center gap-[3px] rounded-capsule bg-grouped p-[3px] md:flex">
            <button
              type="button"
              onClick={() => onFilterChange("needs-a-look")}
              className={`flex h-full items-center rounded-capsule px-3.5 text-[13px] font-medium ${
                filter === "needs-a-look" ? "bg-surface text-ink shadow-control" : "text-secondary"
              }`}
            >
              Needs a look
            </button>
            <button
              type="button"
              onClick={() => onFilterChange("all")}
              className={`flex h-full items-center rounded-capsule px-3.5 text-[13px] font-medium ${
                filter === "all" ? "bg-surface text-ink shadow-control" : "text-secondary"
              }`}
            >
              All {total}
            </button>
          </div>
        </div>

        <div className="hidden gap-4 border-t border-hairline px-5 pb-2.5 pt-4 md:flex">
          <span className="flex-1 text-[10.5px] font-semibold tracking-[1.3px] text-navy">WHAT IT IS</span>
          <span className="w-[150px] shrink-0 text-[10.5px] font-semibold tracking-[1.3px] text-navy">
            WE READ
          </span>
          <span className="w-[330px] shrink-0 text-[10.5px] font-semibold tracking-[1.3px] text-navy">
            IN YOUR FILE
          </span>
          <span className="w-[150px] shrink-0" />
        </div>

        <div className="flex flex-col divide-y divide-hairline border-t border-hairline md:border-t-0">
          {visible.map((marker) => (
            <MarkerRowView key={marker.id} marker={marker} />
          ))}
        </div>
      </div>

      <ArchiveRetentionNote />

      {entries.length > 0 && <SetAsideNote entries={entries} />}

      <ReviewActions
        confirmed={confirmed}
        flaggedCount={flaggedCount}
        onFixFlagged={() => onFilterChange("needs-a-look")}
        onConfirm={onConfirm}
      />
    </div>
  )
}

function FlagChip({
  flagged,
  compact = false,
  className = "",
}: {
  flagged: boolean
  compact?: boolean
  className?: string
}) {
  const Icon = flagged ? XCircle : CheckCircle
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-capsule font-medium ${
        compact ? "h-[22px] px-2 text-[11px]" : "h-7 px-2.5 text-[12px]"
      } ${flagged ? "bg-chalk text-umber" : "bg-sage text-moss"} ${className}`}
    >
      <Icon size={compact ? 11 : 13} weight="light" />
      {flagged ? "Needs a look" : "Matches"}
    </span>
  )
}

/** `NaN` means import found no value at all — the one place that must never render as a number. */
function formatMarkerValue(marker: MarkerRow): string {
  if (Number.isNaN(marker.value)) return "Missing"
  return `${marker.qualifier ?? ""}${marker.value}`
}

function MarkerRowView({ marker }: { marker: MarkerRow }) {
  return (
    <div className="flex w-full flex-col gap-[7px] p-3.5 md:h-[66px] md:flex-row md:items-center md:gap-4 md:p-0 md:px-5">
      <div className="flex items-center justify-between gap-3 md:flex-1 md:justify-start">
        <span className="text-[14.5px] font-semibold text-ink md:text-[15px] md:font-medium">{marker.name}</span>
        <span className="text-[14px] font-semibold text-ink md:hidden">
          {formatMarkerValue(marker)} {marker.unit}
          {marker.labFlag && <span className="ml-1 text-[11px] font-medium text-muted">{marker.labFlag}</span>}
        </span>
      </div>

      <div className="hidden h-11 w-[150px] shrink-0 items-center gap-1.5 rounded-control border border-hairline bg-surface px-3 md:flex">
        <span className="flex-1 text-[15px] font-semibold text-ink">{formatMarkerValue(marker)}</span>
        <span className="text-[12.5px] text-muted">{marker.unit}</span>
        {marker.labFlag && <span className="text-[11px] font-medium text-muted">{marker.labFlag}</span>}
      </div>

      <div className="flex flex-wrap items-center gap-2 md:w-[330px] md:shrink-0 md:flex-nowrap">
        <div className="rounded-[7px] bg-grouped px-2 py-1 md:rounded-[8px] md:px-[9px] md:py-[5px]">
          <span className="text-[11.5px] tracking-[0.2px] text-secondary md:text-[12.5px]">{marker.snippet}</span>
        </div>
        <FlagChip flagged={marker.flagged} compact className="md:hidden" />
      </div>

      {marker.flagReason && (
        <span className="text-[11.5px] font-medium text-umber md:hidden">{marker.flagReason}</span>
      )}

      <div className="hidden w-[150px] shrink-0 flex-col gap-1 md:flex">
        <FlagChip flagged={marker.flagged} />
        {marker.flagReason && <span className="text-[11.5px] font-medium text-umber">{marker.flagReason}</span>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Document review — neither frame covers a non-tabular import (a note with
// no marker table), so this follows the same beside-the-raw-text principle
// with the two texts `lib/deident.ts` actually produces: what the file said,
// and what a send would carry.
// ---------------------------------------------------------------------------

function DocumentReview({
  review,
  confirmed,
  onConfirm,
}: {
  review: DocumentReviewData
  confirmed: boolean
  onConfirm: () => void
}) {
  const entries = setAsideEntries(review.setAside)

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="grid w-full grid-cols-1 gap-4 rounded-card bg-surface p-[22px] shadow-card md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <span className="text-[10.5px] font-semibold tracking-[1.3px] text-navy">IN YOUR FILE</span>
          <pre className="whitespace-pre-wrap rounded-[12px] bg-grouped p-4 font-sans text-[13px] leading-[1.5] text-secondary">
            {review.rawText}
          </pre>
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-[10.5px] font-semibold tracking-[1.3px] text-navy">WHAT YOU WILL SEND</span>
          <pre className="whitespace-pre-wrap rounded-[12px] border border-hairline bg-surface p-4 font-sans text-[13px] leading-[1.5] text-ink">
            {review.cleanedText}
          </pre>
        </div>
      </div>

      <ArchiveRetentionNote />

      {entries.length > 0 && <SetAsideNote entries={entries} />}

      <ReviewActions confirmed={confirmed} flaggedCount={0} onFixFlagged={() => {}} onConfirm={onConfirm} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Inset notes — pen id ZRIPh for the file-retention copy, verbatim. The
// set-aside note has no frame of its own; its lead line is the exact phrase
// `DESIGN.md` § Words we use requires in place of "anonymous", and the list
// beneath it is real `SetAsideIdentifiers` values, never a stand-in.
// ---------------------------------------------------------------------------

function ArchiveRetentionNote() {
  return (
    <InsetNote icon={LockSimple}>
      The file itself stays in your archive so you can come back and compare. It is locked to
      you like your name is — no share can ever include it, which is exactly why these readings
      need to be right.
    </InsetNote>
  )
}

function SetAsideNote({ entries }: { entries: { label: string; value: string }[] }) {
  return (
    <InsetNote icon={LockSimple}>
      <span className="font-semibold text-ink">Your name and date of birth stay with you.</span>{" "}
      We found and held back {entries.map((entry) => `${entry.label.toLowerCase()} (${entry.value})`).join(", ")}
      {" "}before this ever reached the list above.
    </InsetNote>
  )
}

// ---------------------------------------------------------------------------
// Actions — pen ids n9hXH/HkHcF/RnhSQ (desktop), Jbk8c/WXCvP/XwOVO (mobile).
// `border-silver` in the mobile secondary button (`WXCvP`) is not used here:
// H-27 left `$silver` deliberately without a dark value because its only
// consumer was the fixed-dark Focus Card, and a themed surface is not that.
// `border-hairline` carries the same visual weight and themes correctly.
// ---------------------------------------------------------------------------

function ReviewActions({
  confirmed,
  flaggedCount,
  onFixFlagged,
  onConfirm,
}: {
  confirmed: boolean
  flaggedCount: number
  onFixFlagged: () => void
  onConfirm: () => void
}) {
  if (confirmed) {
    return (
      <div className="flex w-full items-center gap-2.5 rounded-control bg-sage px-4 py-3.5">
        <CheckCircle size={18} weight="light" className="shrink-0 text-moss" />
        <span className="text-[14px] font-semibold text-moss">
          Added to archive — ready to include in a share.
        </span>
      </div>
    )
  }

  return (
    <div className="flex w-full flex-col items-stretch gap-3 md:flex-row md:items-center md:gap-2.5">
      <button
        type="button"
        onClick={onConfirm}
        className="flex h-13 items-center justify-center gap-2 rounded-control bg-ink px-6 text-title text-surface"
      >
        <Check size={18} weight="regular" />
        <span className="hidden md:inline">Looks right — add to archive</span>
        <span className="md:hidden">Looks right — add it</span>
      </button>

      {flaggedCount > 0 && (
        <button
          type="button"
          onClick={onFixFlagged}
          className="flex h-13 items-center justify-center rounded-control border border-hairline bg-surface px-6 text-title text-ink"
        >
          Fix the {flaggedCount} flagged
        </button>
      )}

      <span className="hidden text-[13px] text-muted md:ml-auto md:inline">
        Nothing is shareable until you add it
      </span>
      <span className="text-center text-[12.5px] text-muted md:hidden">
        Nothing is shareable until you add it.
      </span>
    </div>
  )
}
