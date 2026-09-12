"use client"

/**
 * 1.3 "What are you adding" — pen ids gxi6Y (desktop) / TdVX6 (mobile), read
 * via the pencil MCP tool against healthsend.pen, not a screenshot. The kind
 * comes first because it decides the parser, the destination group, and
 * whether a review step exists at all (DESIGN.md § Adding data).
 *
 * "blood-panel", "wearable-series" and, since H-63, "document" exist in
 * lib/archive.ts, so only those three kinds are selectable — the first two
 * unchanged from H-13/H-14. The badge is a kind descriptor, not an
 * availability flag, though: every card keeps its own `kindLabel` ("You type
 * it", "A questionnaire", "10 minutes") regardless of whether it is
 * selectable yet. See docs/stories/H-37.md `## Choices`.
 *
 * "A letter or report" is the PDF card (H-63) — it used to be the one card
 * greyed out as genuinely "Later"; scope is PDFs only for now (H-62 operator
 * decision), so it accepts `multiple` and routes to `recordsFromPdfFiles`
 * rather than `recordsFromUpload`.
 */

import { useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import type { Icon as PhosphorIcon } from "@phosphor-icons/react"
import {
  BookOpen,
  CaretLeft,
  CloudSlash,
  FirstAidKit,
  Heartbeat,
  NotePencil,
  Pill,
  UserCircle,
} from "@phosphor-icons/react"
import { Action, Card, Field, InsetNote, ScreenHeader, inputClass } from "@/components/ui"
import { recordsFromPdfFiles, recordsFromUpload } from "@/lib/archive-input"
import { addRecordsToMyArchive } from "@/lib/archive-store"

type ArchiveKind = "blood-panel" | "wearable-series" | "document"

type Kind = {
  id: string
  title: string
  icon: PhosphorIcon
  archiveKind?: ArchiveKind
  accept: string
  desktop: { description: string; kindLabel: string; after: string }
  mobile: { description: string; kindLabel: string }
}

const KINDS: Kind[] = [
  {
    id: "lab-or-test-result",
    title: "Lab or test result",
    icon: FirstAidKit,
    archiveKind: "blood-panel",
    accept: ".csv,text/csv",
    desktop: {
      description: "A CSV export of the report your lab sent you.",
      kindLabel: "A file",
      after: "Use marker,value,unit,ref_low,ref_high,flag as the header.",
    },
    mobile: { description: "A CSV export from your lab", kindLabel: "A file" },
  },
  {
    id: "wearable-export",
    title: "Wearable export",
    icon: Heartbeat,
    archiveKind: "wearable-series",
    accept: ".json,application/json",
    desktop: {
      description: "A JSON export from the Health app, or from your ring.",
      kindLabel: "A file",
      after: "Each series needs a metric, a unit and dated numeric values.",
    },
    mobile: { description: "A JSON export from your device", kindLabel: "A file" },
  },
  {
    id: "medications",
    title: "Medications",
    icon: Pill,
    accept: "",
    desktop: {
      description: "What you take now, and what you have stopped.",
      kindLabel: "You type it",
      after: "You type these in, so there is nothing to check afterwards.",
    },
    mobile: { description: "What you take now", kindLabel: "You type it" },
  },
  {
    id: "health-history",
    title: "Your health history",
    icon: UserCircle,
    accept: "",
    desktop: {
      description: "Conditions, surgeries, allergies, what runs in your family.",
      kindLabel: "A questionnaire",
      after: "About ten minutes, and you can stop and come back. Answer only what you want to.",
    },
    mobile: { description: "Conditions, allergies, family", kindLabel: "10 minutes" },
  },
  {
    id: "notes",
    title: "Notes",
    icon: NotePencil,
    accept: "",
    desktop: {
      description: "Symptoms, questions for your next appointment, how you felt.",
      kindLabel: "You type it",
      after: "Yours alone unless you tick them into a share.",
    },
    mobile: { description: "Symptoms and questions", kindLabel: "You type it" },
  },
  {
    id: "letter-or-report",
    title: "A letter or report",
    icon: BookOpen,
    archiveKind: "document",
    accept: "application/pdf,.pdf",
    desktop: {
      description: "A discharge summary, an imaging report, a specialist letter — as a PDF.",
      kindLabel: "One or more files",
      after: "Pick one or more PDFs at once. Each one is encrypted and stored as itself, not as text read out of it.",
    },
    mobile: { description: "Discharge summary, imaging (PDF)", kindLabel: "One or more files" },
  },
]

const NOTE =
  "Files are read here in your browser and never reach us. For a CSV or JSON file, HealthSend stores only the readings it can place in the archive model, and the original file is not kept. For a PDF, the document itself is what gets stored. Either way, it is encrypted before it uploads to Swarm."

function DesktopKindCard({ kind, onSelect }: { kind: Kind; onSelect: () => void }) {
  const available = kind.archiveKind !== undefined
  const Icon = kind.icon
  return (
    <button
      type="button"
      disabled={!available}
      onClick={onSelect}
      className={`flex w-full flex-col gap-[11px] rounded-card border border-hairline p-[22px] text-left disabled:cursor-not-allowed ${
        available ? "bg-surface shadow-card" : "bg-grouped"
      }`}
    >
      <div className="flex w-full items-center justify-between">
        <div
          className={`flex h-[34px] w-[34px] items-center justify-center rounded-glyph ${
            available ? "bg-haze" : "bg-silver"
          }`}
        >
          <Icon size={18} weight="light" className={available ? "text-navy" : "text-muted"} />
        </div>
        <span
          className={`inline-flex h-6 items-center rounded-capsule border px-[9px] text-[11.5px] font-medium ${
            available ? "border-grouped bg-grouped text-secondary" : "border-silver bg-surface text-muted"
          }`}
        >
          {kind.desktop.kindLabel}
        </span>
      </div>
      <p className={`text-[17px] font-semibold leading-[1.3] tracking-[-0.25px] ${available ? "text-ink" : "text-secondary"}`}>
        {kind.title}
      </p>
      <p className="text-[13.5px] leading-[1.45] text-secondary">{kind.desktop.description}</p>
      <div className={`h-px w-full ${available ? "bg-hairline" : "bg-silver"}`} />
      <p className="text-[12.5px] leading-[1.4] text-muted">{kind.desktop.after}</p>
    </button>
  )
}

function MobileKindRow({ kind, onSelect }: { kind: Kind; onSelect: () => void }) {
  const available = kind.archiveKind !== undefined
  const Icon = kind.icon
  return (
    <button
      type="button"
      disabled={!available}
      onClick={onSelect}
      className={`flex h-[66px] w-full items-center gap-[11px] rounded-control border border-hairline px-3.5 text-left disabled:cursor-not-allowed ${
        available ? "bg-surface" : "bg-grouped"
      }`}
    >
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-glyph ${
          available ? "bg-haze" : "bg-silver"
        }`}
      >
        <Icon size={17} weight="light" className={available ? "text-navy" : "text-muted"} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-px">
        <span className={`truncate text-[14.5px] font-semibold ${available ? "text-ink" : "text-secondary"}`}>
          {kind.title}
        </span>
        <span className="truncate text-[12.5px] text-muted">{kind.mobile.description}</span>
      </div>
      <span
        className={`inline-flex h-6 shrink-0 items-center rounded-capsule border px-[9px] text-[11px] font-medium ${
          available ? "border-grouped bg-grouped text-secondary" : "border-silver bg-surface text-muted"
        }`}
      >
        {kind.mobile.kindLabel}
      </span>
    </button>
  )
}

/**
 * The one non-goal-adjacent copy fix H-63 owns: a PDF is not "parsed
 * readings" — the file itself is what gets encrypted and stored (H-62's
 * consequence section). CSV/JSON kinds keep the original claim, which stays
 * true for them.
 */
function fileNote(files: File[], isDocument: boolean): string {
  if (!isDocument) {
    return `“${files[0].name}” stays in this browser. Only its parsed readings are encrypted and stored.`
  }
  if (files.length === 1) {
    return `“${files[0].name}” is encrypted and stored as the document itself, not just its text.`
  }
  return `These ${files.length} PDFs are encrypted and stored as the documents themselves, not just their text.`
}

function FilePicker({ kind, onBack }: { kind: Kind; onBack: () => void }) {
  const router = useRouter()
  const [files, setFiles] = useState<File[]>([])
  const [takenOn, setTakenOn] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isDocument = kind.archiveKind === "document"

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (files.length === 0 || !kind.archiveKind || saving) return
    setSaving(true)
    setError(null)
    try {
      // One upload for the whole pick either way: both helpers return every
      // record from this submit in one array, and `addRecordsToMyArchive`
      // reseals and uploads once for the array it is given — see
      // lib/archive-store.ts.
      const records = isDocument
        ? await recordsFromPdfFiles(files)
        : await recordsFromUpload({
            file: files[0],
            kind: kind.archiveKind,
            ...(kind.archiveKind === "blood-panel" ? { takenOn } : {}),
          })
      await addRecordsToMyArchive(records)
      router.replace("/")
    } catch (cause) {
      setError((cause as Error).message)
      setSaving(false)
    }
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <Action variant="tertiary" icon={CaretLeft} onClick={onBack} disabled={saving}>
        Choose a different kind
      </Action>
      <form onSubmit={submit}>
        <Card className="flex flex-col gap-5">
          <ScreenHeader title={kind.title} lede={kind.desktop.description} />
          {kind.archiveKind === "blood-panel" && (
            <Field label="Date of test" assistive="The date shown on the result.">
              <input
                type="date"
                aria-label="Date of test"
                required
                value={takenOn}
                className={inputClass}
                onChange={(event) => setTakenOn(event.target.value)}
              />
            </Field>
          )}
          <Field label="File" assistive={kind.desktop.after}>
            <input
              type="file"
              aria-label="File"
              required
              multiple={isDocument}
              accept={kind.accept}
              className={inputClass}
              onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
            />
          </Field>
          {files.length > 0 && (
            <InsetNote icon={CloudSlash}>{fileNote(files, isDocument)}</InsetNote>
          )}
          {error && (
            <p role="alert" className="text-sm text-error">
              {isDocument ? "Could not add these PDFs" : "Could not add this file"}: {error}
            </p>
          )}
          <Action
            type="submit"
            fullWidth
            disabled={files.length === 0 || (kind.archiveKind === "blood-panel" && !takenOn) || saving}
          >
            {saving ? "Adding…" : "Add to archive"}
          </Action>
        </Card>
      </form>
    </div>
  )
}

export default function WhatAreYouAdding() {
  const [selected, setSelected] = useState<Kind | null>(null)

  if (selected) {
    return <FilePicker kind={selected} onBack={() => setSelected(null)} />
  }

  return (
    <div className="flex w-full flex-col gap-3.5 md:gap-6">
      <div className="md:hidden">
        <ScreenHeader
          title="What are you adding?"
          lede="The kind decides how we read it and where it lands."
        />
      </div>
      <div className="hidden md:block">
        <ScreenHeader
          title="What are you adding?"
          lede="Pick the kind of thing first. It decides how we read it, which group it lands in, and whether you need to check anything afterwards."
        />
      </div>

      <div className="flex flex-col gap-[9px] md:hidden">
        {KINDS.map((kind) => (
          <MobileKindRow key={kind.id} kind={kind} onSelect={() => setSelected(kind)} />
        ))}
      </div>
      <div className="hidden md:grid md:grid-cols-2 md:gap-5 xl:grid-cols-3">
        {KINDS.map((kind) => (
          <DesktopKindCard key={kind.id} kind={kind} onSelect={() => setSelected(kind)} />
        ))}
      </div>

      <div className="hidden md:block">
        <InsetNote>{NOTE}</InsetNote>
      </div>
    </div>
  )
}
