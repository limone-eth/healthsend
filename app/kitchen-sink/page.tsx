"use client"

/**
 * Every primitive in every state, on one page. This is what H-1 ships instead
 * of a screen: the review artefact the operator checks against the pen file.
 *
 * Not a screen in the product — the component ids and state labels are shown
 * as captions on purpose, so the review is legible without opening the canvas.
 */

import {
  ArrowDown,
  Check,
  CheckCircle,
  ChatCircleText,
  Compass,
  House,
  UserCircle,
  XCircle,
} from "@phosphor-icons/react"
import {
  Action,
  Card,
  Chip,
  Countdown,
  FocusCard,
  InsetNote,
  inputClass,
  Field,
  ListRow,
  ScreenHeader,
  TabBar,
  type ChipState,
} from "@/components/ui"

const CHIP_STATES: ChipState[] = [
  "not-opened",
  "active",
  "on-device",
  "ending-soon",
  "ended",
  "ended-by-you",
  "unavailable",
]

function Section({ title, id, children }: { title: string; id: string; children: React.ReactNode }) {
  return (
    <section className="flex w-full flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-title text-ink">{title}</h2>
        <span className="text-label text-muted">{id}</span>
      </div>
      {children}
    </section>
  )
}

const NOW = Math.floor(Date.now() / 1000)

export default function KitchenSink() {
  return (
    <div className="min-h-full bg-canvas text-ink">
    <main className="mx-auto flex w-full max-w-[1080px] flex-col gap-14 px-6 py-16 md:px-[48px]">
      <ScreenHeader
        title="Kitchen sink"
        lede="Every primitive from the HealthSend kit, in every state it has. Compare against healthsend.pen."
      />

      <Section title="Action" id="D61Fd">
        <div className="flex flex-wrap items-center gap-4">
          <Action variant="primary" icon={Check}>
            Continue
          </Action>
          <Action variant="secondary">Cancel</Action>
          <Action variant="informational" icon={ArrowDown}>
            Why this
          </Action>
          <Action variant="tertiary">Skip for now</Action>
          <Action variant="destructive" icon={XCircle}>
            End access now
          </Action>
          <Action variant="disabled">Continue</Action>
        </div>
      </Section>

      <Section title="Chip — Share state" id="X2HSj7">
        <div className="flex flex-wrap items-center gap-3">
          {CHIP_STATES.map((state) => (
            <Chip key={state} state={state} />
          ))}
        </div>
        <p className="text-label text-muted">
          Six states a share moves through, plus Temporarily unavailable — drawn unfilled with a
          hairline border on purpose, so infrastructure trouble never reads as a closed window.
        </p>
      </Section>

      <Section title="Countdown" id="b7nB5">
        <div className="flex flex-wrap gap-4">
          <Countdown className="max-w-[380px]" expiresAt={NOW + 84 * 86400} now={NOW} />
          <Countdown className="max-w-[380px]" expiresAt={NOW + 6 * 86400} now={NOW} />
          <Countdown className="max-w-[380px]" expiresAt={NOW - 86400} now={NOW} />
        </div>
        <p className="text-label text-muted">
          Active, Closing, Expired — the word changes with the colour every time, so the state
          still reads in greyscale.
        </p>
        <div className="flex flex-wrap gap-4">
          <Countdown className="max-w-[380px]" expiresAt={NOW + 49 * 3600} now={NOW} />
          <Countdown className="max-w-[380px]" expiresAt={NOW + 47 * 3600} now={NOW} />
        </div>
        <p className="text-label text-muted">
          The 48-hour boundary on both sides — 49 hours left still reads in days, 47 switches to
          hours.
        </p>
      </Section>

      <Section title="Field" id="vG3Zj">
        <div className="grid gap-6 md:grid-cols-2">
          <Field label="Recipient" assistive="Who is this for?">
            <input placeholder="Elena" className={inputClass} />
          </Field>
          <Field label="Email">
            <div className="relative">
              <input defaultValue="simone@omea.health" readOnly className={inputClass} />
              <CheckCircle
                size={20}
                weight="light"
                className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-moss"
              />
            </div>
          </Field>
        </div>
      </Section>

      <Section title="Card" id="NnfZu">
        <Card className="max-w-md">
          <h3 className="text-title text-ink">Blood panel · March</h3>
          <p className="mt-1 text-body text-secondary">32 markers, shared once, expiring on its own.</p>
        </Card>
      </Section>

      <Section title="Focus Card" id="Vxyho">
        <FocusCard
          eyebrow="This week's status"
          headline="Two shares are ending soon"
          body="Nothing to renew — the windows were sized to the work, and they're closing on schedule."
          stats={[
            { value: "4", label: "Active shares" },
            { value: "2", label: "Ending soon" },
            { value: "11", label: "Ended" },
          ]}
        />
      </Section>

      <Section title="Inset Note" id="NTB8G">
        <InsetNote>
          Thresholds on this page are the laboratory&rsquo;s own, and versioned with the panel that
          produced them.
        </InsetNote>
      </Section>

      <Section title="List Row" id="N3UgK">
        <Card className="max-w-md !p-0">
          <ListRow label="Personal details" value="Stays with you" showCaret={false} icon={UserCircle} />
          <div className="h-px bg-hairline" />
          <ListRow label="Blood panels" value="1 of 4" onClick={() => {}} />
          <div className="h-px bg-hairline" />
          <ListRow label="Wearables" value="84 nights" onClick={() => {}} />
        </Card>
      </Section>

      <Section title="Screen Header" id="ie8nc">
        <Card className="max-w-xl">
          <ScreenHeader title="Today" lede="Four things, in the order they matter." />
        </Card>
      </Section>

      <Section title="Tab Bar" id="kGlX0">
        <TabBar
          active="today"
          items={[
            { key: "today", label: "Today", icon: House },
            { key: "discover", label: "Discover", icon: Compass },
            { key: "ask", label: "Ask", icon: ChatCircleText },
            { key: "you", label: "You", icon: UserCircle },
          ]}
        />
      </Section>
    </main>
    </div>
  )
}
