/**
 * The countdown says how long is really left, as finely as the share is long.
 *
 * Operator report, 2026-09-13: a two-minute share read "CLOSING · Expires Sunday · 1 hour left"
 * on the recipient page. Hours were the finest unit and rounded up, and the date line named only
 * the weekday.
 *
 * Every instant below is built from local wall-clock parts, so the proof holds in any TZ.
 */
import assert from "node:assert/strict"
import {
  countdownDateLabel,
  countdownRemainingLabel,
  countdownStateFor,
  endMoment,
  remainingFigure,
} from "../components/countdown-copy.ts"

const at = (y, mo, d, h, mi, s = 0) => Math.floor(new Date(y, mo - 1, d, h, mi, s).getTime() / 1000)

// Sunday 13 September 2026, 00:24 local — the moment of the operator's screenshot.
const now = at(2026, 9, 13, 0, 24)

function check(name, fn) {
  fn()
  console.log(`PASS  ${name}`)
}

check("a two-minute share reads in minutes, never '1 hour'", () => {
  assert.equal(countdownRemainingLabel(120), "2 minutes left")
  assert.equal(countdownRemainingLabel(119), "1 minute left", "figures round down, never up")
  assert.equal(countdownRemainingLabel(3599), "59 minutes left")
})

check("under a minute reads in seconds", () => {
  assert.equal(countdownRemainingLabel(45), "45 seconds left")
  assert.equal(countdownRemainingLabel(1), "1 second left")
  assert.equal(countdownRemainingLabel(0.4), "1 second left", "a live share never reads 0 seconds")
})

check("hours from one hour up to the 48-hour boundary, then days", () => {
  assert.equal(countdownRemainingLabel(3600), "1 hour left")
  assert.equal(countdownRemainingLabel(90 * 60), "1 hour left")
  assert.equal(countdownRemainingLabel(47 * 3600), "47 hours left")
  assert.equal(countdownRemainingLabel(48 * 3600), "48 hours left")
  assert.equal(countdownRemainingLabel(49 * 3600), "2 days left")
  assert.equal(remainingFigure(84 * 86400), "84 days")
})

check("the date line gives the clock time when the day alone is too coarse", () => {
  const twoMinutes = now + 120
  assert.equal(countdownDateLabel(countdownStateFor(120), twoMinutes, now), "Expires today at 00:26")
  assert.equal(endMoment(at(2026, 9, 14, 9, 15), now), "tomorrow at 09:15")
  assert.equal(endMoment(at(2026, 9, 17, 18, 0), now), "Thursday at 18:00")
})

check("a week or more away reads as a full date, not an ambiguous weekday", () => {
  assert.equal(endMoment(at(2026, 9, 20, 0, 24), now), "20 September 2026")
  assert.equal(countdownDateLabel("active", at(2026, 12, 4, 12, 0), now), "Expires 4 December 2026")
})

check("an ended share says when it ended, as precisely", () => {
  assert.equal(countdownDateLabel("expired", now - 60, now), "Expired today at 00:23")
  assert.equal(countdownDateLabel("expired", at(2026, 9, 12, 23, 50), now), "Expired yesterday at 23:50")
  assert.equal(countdownDateLabel("expired", at(2026, 9, 1, 10, 0), now), "Expired 1 September 2026")
})

console.log("\nCountdown copy proof passed.")
