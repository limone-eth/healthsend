/**
 * The Create-link progress reads as four plain steps that only move forward, on both key
 * release paths (components/send-progress-steps.ts).
 */
import assert from "node:assert/strict"
import { NO_STEP, SEND_STEPS, nextStepIndex, stepLabel } from "../components/send-progress-steps.ts"

function walk(stages) {
  const seen = []
  let step = NO_STEP
  for (const stage of stages) {
    step = nextStepIndex(step, stage)
    seen.push(stepLabel(step))
  }
  return { step, seen }
}

// The holder path, in the order lib/sends.ts's createSendFromArchive reports it.
const holder = walk([
  "Checking key-share holder",
  "Encrypting",
  "Uploading to Swarm",
  "Splitting key",
  "Writing grant to Arkiv",
  "Handing the key share to the holder",
  "Recording the share in your archive",
  "Done",
])
assert.deepEqual(holder.seen, [
  "Encrypting your documents",
  "Encrypting your documents",
  "Encrypting your documents",
  "Locking it with its own key",
  "Setting when it ends",
  "Setting when it ends",
  "Saving it to Your shares",
  "Link ready",
])
console.log("PASS  holder path reads as four forward steps")

// The Chipotle path protects the key share before writing the grant.
const chipotle = walk([
  "Encrypting",
  "Uploading to Swarm",
  "Binding the grant",
  "Protecting the key share",
  "Writing grant to Arkiv",
  "Recording the share in your archive",
  "Done",
])
assert.equal(chipotle.step, SEND_STEPS.length)
console.log("PASS  Chipotle path completes")

// Never backwards, never a technical word.
assert.equal(nextStepIndex(2, "Splitting key"), 2, "a late earlier stage never moves the bar back")
assert.equal(nextStepIndex(1, "Something new"), 1, "an unknown stage keeps the current step")
for (const label of [...SEND_STEPS, stepLabel(SEND_STEPS.length)]) {
  assert.doesNotMatch(label, /grant|Arkiv|Swarm|holder|split|share key/i, `"${label}" must be plain English`)
}
console.log("PASS  never backwards, never jargon")

console.log("\nSend progress proof passed.")
