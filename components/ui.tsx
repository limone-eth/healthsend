"use client"

import type { ReactNode } from "react"
import type { Icon as PhosphorIcon } from "@phosphor-icons/react"
import {
  CalendarBlank,
  CaretRight,
  CheckCircle,
  CloudSlash,
  Fingerprint,
  LockSimple,
  ShieldCheck,
  Sparkle,
  UserCircle,
  XCircle,
} from "@phosphor-icons/react"
import { countdownDateLabel, countdownRemainingLabel, countdownStateFor, type CountdownState } from "./countdown-copy"

/**
 * The primitive kit — nine components, one token map. Every value below traces
 * to `healthsend.pen` (read via the pencil MCP tool) and DESIGN.md's frontmatter,
 * not to a screenshot or a guess. Where the two disagreed, `docs/stories/H-1.md`
 * says the frame wins; those calls are recorded in `## Choices`.
 */

// ---------------------------------------------------------------------------
// Card — pen id NnfZu
// ---------------------------------------------------------------------------

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`w-full rounded-card bg-surface p-[22px] shadow-card ${className}`}>
      {children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Action — pen id D61Fd
// ---------------------------------------------------------------------------

export type ActionVariant = "primary" | "secondary" | "informational" | "tertiary" | "destructive" | "disabled"

const ACTION_VARIANT_CLASS: Record<ActionVariant, string> = {
  primary: "h-13 rounded-control bg-ink px-6 text-title text-surface",
  secondary: "h-13 rounded-control border border-hairline bg-surface px-6 text-title text-ink",
  informational: "h-11 rounded-capsule bg-haze px-3 text-label text-navy active:bg-haze-strong",
  tertiary: "h-11 px-0 text-title text-ink",
  destructive: "h-[30px] rounded-capsule border border-error bg-surface px-3 text-label text-error",
  disabled: "h-13 rounded-control bg-disabled px-6 text-title text-secondary",
}

export function Action({
  variant = "primary",
  icon: IconComponent,
  children,
  onClick,
  type = "button",
  disabled = false,
  fullWidth = false,
  className = "",
}: {
  variant?: ActionVariant
  icon?: PhosphorIcon
  children: ReactNode
  onClick?: () => void
  type?: "button" | "submit"
  disabled?: boolean
  fullWidth?: boolean
  className?: string
}) {
  const isDisabled = disabled || variant === "disabled"
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={isDisabled}
      className={`inline-flex items-center justify-center gap-2 transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100 ${
        fullWidth ? "w-full" : ""
      } ${ACTION_VARIANT_CLASS[variant]} ${className}`}
    >
      {IconComponent && <IconComponent size={variant === "primary" || variant === "secondary" ? 20 : 14} weight="light" />}
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Chip — pen id X2HSj7, states from healthsend.pen Sheet 0 "The life of a
// share" (node NgI3h). Six states plus the seventh that is deliberately not
// one — Temporarily unavailable renders unfilled so it never joins the set.
// ---------------------------------------------------------------------------

export type ChipState =
  | "not-opened"
  | "active"
  | "on-device"
  | "ending-soon"
  | "ended"
  | "ended-by-you"
  | "unavailable"

const CHIP_SPEC: Record<
  ChipState,
  { label: string; icon: PhosphorIcon; fill: string; text: string; border: string }
> = {
  "not-opened": {
    label: "Not opened yet",
    icon: UserCircle,
    fill: "bg-grouped",
    text: "text-secondary",
    border: "border-hairline",
  },
  active: {
    label: "Active",
    icon: CheckCircle,
    fill: "bg-haze",
    text: "text-navy",
    border: "border-haze",
  },
  "on-device": {
    label: "On their device",
    icon: Fingerprint,
    fill: "bg-sage",
    text: "text-moss",
    border: "border-sage",
  },
  "ending-soon": {
    label: "Ending soon",
    icon: CalendarBlank,
    fill: "bg-chalk",
    text: "text-umber",
    border: "border-chalk",
  },
  ended: {
    label: "Ended",
    icon: LockSimple,
    fill: "bg-grouped",
    text: "text-muted",
    border: "border-hairline",
  },
  "ended-by-you": {
    label: "Ended by you",
    icon: XCircle,
    fill: "bg-surface",
    text: "text-error",
    border: "border-error",
  },
  unavailable: {
    label: "Temporarily unavailable",
    icon: CloudSlash,
    fill: "bg-surface",
    text: "text-secondary",
    border: "border-hairline",
  },
}

export function Chip({ state, label }: { state: ChipState; label?: string }) {
  const spec = CHIP_SPEC[state]
  const Icon = spec.icon
  return (
    <span
      className={`inline-flex h-[34px] items-center gap-1.5 rounded-capsule border px-3.5 text-label ${spec.fill} ${spec.text} ${spec.border}`}
    >
      <Icon size={14} weight="light" />
      {label ?? spec.label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Countdown — pen id b7nB5, Sheet 0 § "Expiry — the one new primitive". The
// product's one invented component: a date read from the grant's expiry
// block, never a client-side timer counting against a stored one — see
// docs/stories/H-2.md for why that distinction is load-bearing. Both
// `expiresAt` and `now` come from the caller — the component reads the
// clock through neither `Date.now()` nor a poll of its own, which keeps it a
// pure function of its props and re-render-on-an-interval the caller's call.
// ---------------------------------------------------------------------------

// The words themselves — state, time left, date line — live in
// components/countdown-copy.ts, a pure module with its own proof.
export type { CountdownState } from "./countdown-copy"

const COUNTDOWN_SPEC: Record<
  CountdownState,
  { word: string; icon: PhosphorIcon; glyphFill: string; glyphIcon: string; wordColor: string; remainingColor: string }
> = {
  active: {
    word: "ACTIVE",
    icon: CalendarBlank,
    glyphFill: "bg-haze",
    glyphIcon: "text-navy",
    wordColor: "text-navy",
    remainingColor: "text-muted",
  },
  closing: {
    word: "CLOSING",
    icon: CalendarBlank,
    glyphFill: "bg-chalk",
    glyphIcon: "text-umber",
    wordColor: "text-umber",
    remainingColor: "text-umber",
  },
  expired: {
    word: "EXPIRED",
    icon: LockSimple,
    glyphFill: "bg-grouped",
    glyphIcon: "text-muted",
    wordColor: "text-muted",
    remainingColor: "text-muted",
  },
}

export function Countdown({
  expiresAt,
  now,
  className = "",
}: {
  expiresAt: number
  now: number
  className?: string
}) {
  const remainingSeconds = expiresAt - now
  const state = countdownStateFor(remainingSeconds)
  const spec = COUNTDOWN_SPEC[state]
  const Icon = spec.icon
  return (
    <div
      // min-h, not h: a fixed 56px clipped the word above the border once the date line
      // wrapped. Neither side shrinks under its own text; when a slot is too narrow for
      // both on one row, the time left wraps below instead of drawing over the date.
      className={`flex min-h-14 w-full flex-wrap items-center justify-between gap-x-6 gap-y-1 rounded-control border border-hairline bg-surface px-4 py-2.5 ${className}`}
    >
      <div className="flex shrink-0 items-center gap-3">
        <div className={`flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-glyph ${spec.glyphFill}`}>
          <Icon size={16} weight="light" className={spec.glyphIcon} />
        </div>
        <div className="flex flex-col gap-0.5">
          <span className={`text-[10px] font-semibold leading-none tracking-[1.3px] ${spec.wordColor}`}>{spec.word}</span>
          <span className="whitespace-nowrap text-[14px] font-semibold leading-tight tracking-[-0.1px] text-ink tabular-nums">
            {countdownDateLabel(state, expiresAt, now)}
          </span>
        </div>
      </div>
      <span className={`ml-auto shrink-0 whitespace-nowrap text-[14px] font-medium tabular-nums ${spec.remainingColor}`}>
        {state === "expired" ? "Access ended" : countdownRemainingLabel(remainingSeconds)}
      </span>
    </div>
  )
}

// A one-line pill for a chrome bar too short for the full `Countdown` card —
// pen id `Y57h2` (3.2m's top bar): a 30px rounded-full pill with a calendar
// glyph and a single date label, no word/remaining-time row. `RecipientTopBar`
// is 64px tall; this is what fits beside the wordmark at every width.
export function CountdownChip({
  expiresAt,
  now,
  className = "",
}: {
  expiresAt: number
  now: number
  className?: string
}) {
  const remainingSeconds = expiresAt - now
  const state = countdownStateFor(remainingSeconds)
  return (
    <div
      data-testid="countdown-chip"
      className={`flex h-[30px] shrink-0 items-center gap-1.5 rounded-full border border-hairline bg-surface px-[11px] ${className}`}
    >
      <CalendarBlank size={13} weight="light" className="text-navy" />
      <span className="whitespace-nowrap text-[12.5px] font-semibold text-ink">
        {state === "expired" ? "Access ended" : countdownDateLabel(state, expiresAt, now)}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Field — pen id vG3Zj
// ---------------------------------------------------------------------------

export function Field({
  label,
  assistive,
  children,
}: {
  label: string
  assistive?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex w-full flex-col gap-2">
      <label className="text-[15px] font-semibold leading-[1.33] text-ink">{label}</label>
      {children}
      <p className="min-h-[18px] text-label text-secondary">{assistive}</p>
    </div>
  )
}

export const inputClass =
  "h-[54px] w-full rounded-control bg-surface px-4 text-[17px] text-ink shadow-control outline-none placeholder:text-secondary focus-visible:shadow-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink"

// ---------------------------------------------------------------------------
// Focus Card — pen id Vxyho, restyled per DESIGN.md "No photography": the
// parent kit's photo-behind-gradient is replaced everywhere in this product
// by the flat `grad-focus` gradient, and the panel over it is flat, not
// glass — there is nothing behind a gradient to blur.
//
// H-27: the gradient never themes (it is the one surface DESIGN.md always
// draws dark), so its foreground must not either. The headline and stat
// value use a fixed `text-white` rather than `text-surface` — `surface` now
// flips dark for its card role elsewhere, which would have paired this
// fixed-dark background with fixed-dark text. `haze-strong` (eyebrow) and
// `silver` (stat label) are pinned in `app/globals.css` for the same reason.
// ---------------------------------------------------------------------------

export function FocusCard({
  eyebrow,
  headline,
  body,
  stats,
  className = "",
}: {
  eyebrow: string
  headline: string
  body: string
  stats?: { label: string; value: string }[]
  className?: string
}) {
  return (
    <div
      className={`w-full rounded-card border border-hairline-on-dark p-6 shadow-focus ${className}`}
      style={{
        background: "linear-gradient(155deg, var(--color-grad-focus-from) 0%, var(--color-grad-focus-to) 100%)",
      }}
    >
      <div className="flex items-center gap-2">
        <Sparkle size={16} weight="light" className="text-haze-strong" />
        <span className="text-eyebrow uppercase text-haze-strong">{eyebrow}</span>
      </div>
      <p className="mt-3 text-headline text-white">{headline}</p>
      <p className="mt-3 text-body text-[#E4E5E7]">{body}</p>
      {stats && stats.length > 0 && (
        <div className="mt-4 flex gap-5 rounded-control bg-panel-on-dark p-3.5">
          {stats.map((stat) => (
            <div key={stat.label} className="flex flex-col gap-0.5">
              <span className="text-[17px] font-semibold tracking-[-0.2px] text-white">{stat.value}</span>
              <span className="text-xs text-silver">{stat.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Inset Note — pen id NTB8G
// ---------------------------------------------------------------------------

export function InsetNote({
  icon: IconComponent = ShieldCheck,
  children,
}: {
  icon?: PhosphorIcon
  children: ReactNode
}) {
  return (
    <div className="flex w-full items-start gap-3 rounded-inset bg-grouped p-4">
      <IconComponent size={18} weight="light" className="mt-0.5 shrink-0 text-secondary" />
      <p className="text-label text-secondary">{children}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// List Row — pen id N3UgK
// ---------------------------------------------------------------------------

export function ListRow({
  icon: IconComponent = UserCircle,
  label,
  value,
  showCaret = true,
  onClick,
}: {
  icon?: PhosphorIcon
  label: string
  value?: string
  showCaret?: boolean
  onClick?: () => void
}) {
  const Row = onClick ? "button" : "div"
  return (
    <Row
      onClick={onClick}
      className="flex h-14 w-full items-center gap-3 bg-surface px-[18px] text-left"
    >
      <IconComponent size={20} weight="light" className="shrink-0 text-secondary" />
      <span className="flex-1 truncate text-body text-ink">{label}</span>
      {value && <span className="shrink-0 text-body text-muted">{value}</span>}
      {showCaret && <CaretRight size={16} weight="light" className="shrink-0 text-muted" />}
    </Row>
  )
}

// ---------------------------------------------------------------------------
// Screen Header — pen id ie8nc. The lede is Display's Body-17 companion per
// DESIGN.md's Layout section ("Display over a Body-17 lede at an 8px gap") —
// there is no separately named token for it.
// ---------------------------------------------------------------------------

export function ScreenHeader({ title, lede }: { title: string; lede?: string }) {
  return (
    <div className="flex w-full flex-col gap-2">
      <h1 className="text-display-mobile text-ink md:text-display">{title}</h1>
      {lede && <p className="text-[17px] leading-[1.47] tracking-[-0.25px] text-secondary">{lede}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tab Bar — pen id kGlX0, restyled per DESIGN.md: `glass-tabbar` "has no
// callers in this product" — the mobile bottom bar uses `glass-raised`, the
// one glass tier HealthSend keeps.
// ---------------------------------------------------------------------------

export type TabBarItem = { key: string; label: string; icon: PhosphorIcon }

export function TabBar({
  items,
  active,
  onSelect,
}: {
  items: TabBarItem[]
  active: string
  onSelect?: (key: string) => void
}) {
  return (
    <nav className="flex h-[72px] w-full max-w-[392px] items-center gap-1 rounded-[32px] bg-glass-raised px-2 shadow-glass backdrop-blur-xl">
      {items.map((item) => {
        const ItemIcon = item.icon
        const isActive = item.key === active
        return (
          <button
            key={item.key}
            onClick={() => onSelect?.(item.key)}
            className={`flex h-14 flex-1 flex-col items-center justify-center gap-0.5 rounded-capsule ${
              isActive ? "bg-haze" : "bg-transparent"
            }`}
          >
            <ItemIcon size={24} weight={isActive ? "fill" : "light"} className={isActive ? "text-navy" : "text-muted"} />
            <span className={`text-[11px] ${isActive ? "font-semibold text-navy" : "font-medium text-muted"}`}>
              {item.label}
            </span>
          </button>
        )
      })}
    </nav>
  )
}

// ---------------------------------------------------------------------------
// Legacy exports — `app/page.tsx` and `app/s/[key]/page.tsx` import these
// directly. Kept working per H-1's contract rather than redesigned: this
// story lands the kit and the tokens, not new screens.
// ---------------------------------------------------------------------------

export function Button({
  children,
  onClick,
  disabled,
  variant = "primary",
  type = "button",
}: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  variant?: "primary" | "ghost"
  type?: "button" | "submit"
}) {
  const base =
    "inline-flex items-center justify-center rounded-control px-4 py-2 text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
  const styles =
    variant === "primary"
      ? "bg-ink text-surface hover:opacity-90"
      : "border border-hairline hover:bg-hairline/40"
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${styles}`}>
      {children}
    </button>
  )
}

export function Mono({ children }: { children: ReactNode }) {
  return <span className="font-mono text-xs break-all text-muted">{children}</span>
}

/** Countdown against a real expiry, not a UI timer. */
export function timeLeft(expiresAt: number): string {
  const seconds = expiresAt - Math.floor(Date.now() / 1000)
  if (seconds <= 0) return "expired"
  if (seconds < 60) return `${seconds}s left`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m left`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h left`
  return `${Math.floor(seconds / 86400)}d left`
}
