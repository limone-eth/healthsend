"use client"

/**
 * Progress while a link is being made — a spinner label for the Create button
 * and a four-segment bar beneath it. Words and step order come from
 * `send-progress-steps.ts`; this file only draws them.
 */

import { SEND_STEPS, stepLabel } from "./send-progress-steps"

/** Button content while sending: a small ring spinner and the current step, e.g. "Locking it with its own key…". */
export function SendingLabel({ stepIndex }: { stepIndex: number }) {
  return (
    <span className="inline-flex items-center gap-2.5" aria-live="polite">
      <span
        aria-hidden
        className="h-4 w-4 shrink-0 rounded-full border-2 border-current border-r-transparent motion-safe:animate-spin"
      />
      <span>{stepLabel(stepIndex)}…</span>
    </span>
  )
}

/** Four segments that fill as the steps complete; the current one pulses gently. */
export function SendProgressBar({ stepIndex }: { stepIndex: number }) {
  const total = SEND_STEPS.length
  const shown = Math.min(Math.max(stepIndex, 0) + 1, total)
  return (
    <div className="flex w-full flex-col gap-2" data-testid="send-progress">
      <div
        className="flex w-full gap-1.5"
        role="progressbar"
        aria-label="Making your link"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={Math.min(Math.max(stepIndex, 0), total)}
      >
        {SEND_STEPS.map((step, index) => {
          const done = index < stepIndex
          const current = index === stepIndex
          return (
            <span
              key={step}
              className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
                done ? "bg-ink" : current ? "bg-ink/60 motion-safe:animate-pulse" : "bg-grouped"
              }`}
            />
          )
        })}
      </div>
      <p className="text-center text-[12.5px] tabular-nums text-muted">
        Step {shown} of {total} · this can take up to a minute
      </p>
    </div>
  )
}
