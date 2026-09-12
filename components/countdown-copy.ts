/**
 * The words a countdown shows — the state, the time left, and the date line.
 *
 * Pure: `expiresAt` and `now` (unix seconds) always come from the caller, so
 * this reads no clock of its own (see `Countdown` in components/ui.tsx and
 * docs/stories/H-2.md). Kept out of the JSX module so a plain Node proof can
 * exercise it: `scripts/countdown-copy-proof.mjs`.
 *
 * Shares can be minutes long — the default preset on New share is ten minutes —
 * so the figure has to be as fine as the window. A two-minute share that reads
 * "1 hour left" and "Expires Sunday" tells the recipient nothing true. Figures
 * round DOWN: the countdown may understate the time left, never overstate it.
 */

export type CountdownState = "active" | "closing" | "expired"

export const COUNTDOWN_CLOSING_SECONDS = 7 * 86400
const HOURS_BOUNDARY_SECONDS = 48 * 3600

const fullDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" })
const weekday = new Intl.DateTimeFormat("en-GB", { weekday: "long" })
const clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" })

export function countdownStateFor(remainingSeconds: number): CountdownState {
  if (remainingSeconds <= 0) return "expired"
  if (remainingSeconds <= COUNTDOWN_CLOSING_SECONDS) return "closing"
  return "active"
}

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"}`
}

/** "3 days", "47 hours", "2 minutes", "30 seconds" — days down to 48 hours, then hours, minutes, seconds. */
export function remainingFigure(remainingSeconds: number): string {
  const seconds = Math.floor(remainingSeconds)
  if (seconds < 60) return plural(Math.max(1, seconds), "second")
  if (seconds < 3600) return plural(Math.floor(seconds / 60), "minute")
  if (seconds <= HOURS_BOUNDARY_SECONDS) return plural(Math.floor(seconds / 3600), "hour")
  return plural(Math.floor(seconds / 86400), "day")
}

/** "2 minutes left" — the right-hand figure on the Countdown card. */
export function countdownRemainingLabel(remainingSeconds: number): string {
  return `${remainingFigure(remainingSeconds)} left`
}

function sameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function shiftDays(date: Date, days: number): Date {
  const shifted = new Date(date)
  shifted.setDate(shifted.getDate() + days)
  return shifted
}

/**
 * When it ends, as a person says it: "today at 00:26", "tomorrow at 09:15",
 * "Sunday at 00:26" inside the week, "4 December 2026" beyond it. The clock
 * time appears whenever the day alone is too coarse to act on.
 */
export function endMoment(expiresAt: number, now: number): string {
  const end = new Date(expiresAt * 1000)
  const today = new Date(now * 1000)
  const time = clock.format(end)
  const ahead = expiresAt >= now
  if (sameLocalDay(end, today)) return `today at ${time}`
  if (ahead && sameLocalDay(end, shiftDays(today, 1))) return `tomorrow at ${time}`
  if (!ahead && sameLocalDay(end, shiftDays(today, -1))) return `yesterday at ${time}`
  // Inside six days a weekday cannot be mistaken for today's own weekday a week on.
  if (Math.abs(expiresAt - now) < 6 * 86400) return `${weekday.format(end)} at ${time}`
  return fullDate.format(end)
}

/** The date line under the state word: "Expires today at 00:26", "Expired 12 September 2026". */
export function countdownDateLabel(state: CountdownState, expiresAt: number, now: number): string {
  return `${state === "expired" ? "Expired" : "Expires"} ${endMoment(expiresAt, now)}`
}
