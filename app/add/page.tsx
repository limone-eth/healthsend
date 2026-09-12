"use client"

/**
 * 1.3 "What are you adding" — pen ids gxi6Y (desktop) / TdVX6 (mobile), read
 * via the pencil MCP tool against healthsend.pen, not a screenshot. The kind
 * comes first because it decides the parser, the destination group, and
 * whether a review step exists at all (DESIGN.md § Adding data).
 *
 * Only "blood-panel" and "wearable-series" exist in lib/archive.ts (H-13), so
 * only those two kinds are selectable — that split is unchanged from H-13/H-14.
 * The badge is a kind descriptor, not an availability flag, though: every
 * card keeps its own `kindLabel` ("You type it", "A questionnaire", "10
 * minutes") regardless of whether it is selectable yet. Only "A letter or
 * report" is genuinely "Later" — that is the one card gxi6Y/TdVX6 draw
 * greyed out. See docs/stories/H-37.md `## Choices`.
 */

import { useState } from "react"
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
import { SenderChrome } from "@/components/chrome"
import { Action, Card, Field, InsetNote, ScreenHeader, inputClass } from "@/components/ui"

type ArchiveKind = "blood-panel" | "wearable-series"

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
    accept: "application/pdf,image/*",
    desktop: {
      description: "A PDF or a photo of the report your lab sent you.",
      kindLabel: "A file",
      after: "We read the markers and their ranges, then show you what we read.",
    },
    mobile: { description: "A PDF or a photo", kindLabel: "A file" },
  },
  {
    id: "wearable-export",
    title: "Wearable export",
    icon: Heartbeat,
    archiveKind: "wearable-series",
    accept: ".csv,.json,.xml,.zip",
    desktop: {
      description: "The export file from the Health app, or from your ring.",
      kindLabel: "A file",
      after: "Sleep, training and heart rate over time all land in Wearables.",
    },
    mobile: { description: "From the Health app or your ring", kindLabel: "A file" },
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
    accept: "",
    desktop: {
      description: "A discharge summary, an imaging report, a specialist letter.",
      kindLabel: "Later",
      after: "Kept as written, with its date and who wrote it. Nothing is read out of it.",
    },
    mobile: { description: "Discharge summary, imaging", kindLabel: "Later" },
  },
]

const NOTE =
  "Files are read here in your browser and never reach us. Your name and date of birth are lifted out as they are read, and kept apart from everything else. Anything you type yourself skips the checking step — you already know what it says."

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

function FilePicker({ kind, onBack }: { kind: Kind; onBack: () => void }) {
  const [file, setFile] = useState<File | null>(null)

  return (
    <div className="flex w-full flex-col gap-6">
      <Action variant="tertiary" icon={CaretLeft} onClick={onBack}>
        Choose a different kind
      </Action>
      <Card className="flex flex-col gap-5">
        <ScreenHeader title={kind.title} lede={kind.desktop.description} />
        {file ? (
          <InsetNote icon={CloudSlash}>
            &ldquo;{file.name}&rdquo; is chosen. Reading and checking it is not built on this
            screen yet — that is H-15.
          </InsetNote>
        ) : (
          <Field label="File" assistive={kind.desktop.after}>
            <input
              type="file"
              accept={kind.accept}
              className={inputClass}
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </Field>
        )}
      </Card>
    </div>
  )
}

export default function WhatAreYouAdding() {
  const [selected, setSelected] = useState<Kind | null>(null)

  return (
    <SenderChrome active="archive">
      {selected ? (
        <FilePicker kind={selected} onBack={() => setSelected(null)} />
      ) : (
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
      )}
    </SenderChrome>
  )
}
