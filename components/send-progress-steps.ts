/**
 * What the sender sees while a link is being made, in plain words.
 *
 * `lib/sends.ts` and `lib/assets.ts` report technical stages ("Splitting key",
 * "Writing grant to Arkiv", "Handing the key share to the holder"…). Those are
 * right for logs and wrong for a person waiting on a button (operator,
 * 2026-09-13: "make it a nicer loading progress"). This maps every stage onto
 * four steps a sender can follow, and never lets the bar move backwards —
 * the holder path hands the key share over after writing the grant, the
 * Chipotle path protects it before, and both must read as steady progress.
 *
 * Pure, no JSX: `scripts/send-progress-proof.mjs` exercises it directly.
 */

export const SEND_STEPS = [
  "Encrypting your documents",
  "Locking it with its own key",
  "Setting when it ends",
  "Saving it to Your shares",
] as const

const STAGE_TO_STEP: Record<string, number> = {
  "Checking key-share holder": 0,
  Encrypting: 0,
  "Uploading to Swarm": 0,
  "Splitting key": 1,
  "Binding the grant": 1,
  "Protecting the key share": 1,
  "Writing grant to Arkiv": 2,
  "Handing the key share to the holder": 2,
  "Recording the share in your archive": 3,
}

/** -1 before anything has been reported. */
export const NO_STEP = -1

/**
 * The step to show after `stage` arrives, given the step already shown. Unknown
 * stages keep the current step rather than guessing; "Done" completes the bar.
 */
export function nextStepIndex(current: number, stage: string): number {
  if (stage === "Done") return SEND_STEPS.length
  const step = STAGE_TO_STEP[stage]
  if (step === undefined) return Math.max(current, 0)
  return Math.max(current, step)
}

/** The words on the button for a step index. */
export function stepLabel(stepIndex: number): string {
  if (stepIndex >= SEND_STEPS.length) return "Link ready"
  return SEND_STEPS[Math.max(0, stepIndex)]
}
