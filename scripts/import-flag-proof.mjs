import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

const { importDocument } = await import("../lib/import.ts")

/**
 * H-38: `/import-review` must flag parse uncertainty, never the lab's own
 * H/L/HIGH/LOW call. `thyroid-panel.csv` reads three values the lab itself
 * marked HIGH or LOW — TSH, TPO antibodies, Vitamin D 25-OH — and every one
 * of them is a clean, unambiguous parse. None of the three may end up
 * flagged; the lab's own call must still be readable as `labFlag`, because a
 * clinician reading the archived record later needs it.
 */
const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures")
const bytes = new Uint8Array(readFileSync(path.join(fixturesDir, "thyroid-panel.csv")))

const imported = importDocument({
  bytes,
  format: "csv",
  recordId: "record:import-flag-proof",
  sourceId: "source:import-flag-proof",
  importedAt: "2026-09-12T09:00:00.000Z",
  takenOn: "2026-09-01",
})
assert.equal(imported.kind, "blood-panel")
const markers = imported.record.markers
const byName = (name) => {
  const marker = markers.find((candidate) => candidate.name === name)
  assert.ok(marker, `fixture must contain ${name}`)
  return marker
}

for (const name of ["TSH", "TPO antibodies", "Vitamin D 25-OH"]) {
  const marker = byName(name)
  assert.equal(
    marker.flaggedAtImport,
    false,
    `${name} was read cleanly — an abnormal lab result is not a parse failure`,
  )
  assert.equal(marker.flagReason, undefined, `${name} must carry no flag reason`)
}
assert.equal(byName("TSH").labFlag, "HIGH", "the lab's own call must still be carried as data")
assert.equal(byName("TPO antibodies").labFlag, "HIGH", "the lab's own call must still be carried as data")
assert.equal(byName("Vitamin D 25-OH").labFlag, "LOW", "the lab's own call must still be carried as data")
console.log("PASS  a lab's own HIGH/LOW call is carried as data, never raised as a flag")

const clean = byName("Free T4")
assert.equal(clean.flaggedAtImport, false)
assert.equal(clean.labFlag, undefined, "a row the lab did not flag must carry no lab flag")
console.log("PASS  an unflagged lab row carries no lab flag")

const flaggedForParse = markers.filter((marker) => marker.flaggedAtImport)
assert.ok(
  flaggedForParse.every((marker) => typeof marker.flagReason === "string" && marker.flagReason.length > 0),
  "every marker flagged at import must say why",
)
assert.ok(
  flaggedForParse.every((marker) => marker.flagReason !== "Flagged HIGH in the file" && marker.flagReason !== "Flagged LOW in the file"),
  "a flag reason must be about the parse, never a restatement of the lab's own call",
)
assert.deepEqual(
  flaggedForParse.map((marker) => marker.name).sort(),
  ["Cortisol", "Homocysteine"],
  "only genuinely parse-uncertain rows may be flagged",
)
assert.equal(byName("Cortisol").flagReason, "No unit in the file")
assert.equal(byName("Homocysteine").flagReason, "No reference range in the file")
console.log(`PASS  ${flaggedForParse.length} marker(s) flagged, every one for parse uncertainty`)

console.log("\nImport flag proof passed.")
