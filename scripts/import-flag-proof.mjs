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
  ["Cortisol", "Homocysteine", "Potassium"],
  "only genuinely parse-uncertain rows may be flagged",
)
assert.equal(byName("Cortisol").flagReason, "No unit in the file")
assert.equal(byName("Homocysteine").flagReason, "No reference range in the file")
assert.equal(byName("Potassium").flagReason, "Reference range is reversed")
console.log(`PASS  ${flaggedForParse.length} marker(s) flagged, every one for parse uncertainty`)

// R3-014: `thyroid-panel.csv` is the fixed 32-marker dataset `DESIGN.md`
// demos ("29 of 32 read cleanly · 3 need a look"), read for real rather than
// hand-typed to match. This is what makes that true rather than coincidental.
assert.equal(markers.length, 32, "the fixed dataset has 32 markers")
assert.equal(markers.length - flaggedForParse.length, 29, "29 of 32 must read cleanly")
console.log("PASS  the fixed dataset reads as 29 of 32 cleanly · 3 need a look")

// R3-018: a lab-style qualifier is a confident, conventional reading, not a
// parse failure — it must keep its qualifier as data and never flag.
const qualified = byName("hs-CRP")
assert.equal(qualified.value, 0.3)
assert.equal(qualified.qualifier, "<")
assert.equal(qualified.flaggedAtImport, false, "a qualified reading is not parse-uncertain")
assert.equal(qualified.flagReason, undefined)
console.log("PASS  a qualified reading (\"<0.3\") keeps its qualifier and reads cleanly")

// R3-018: a blank cell is missing, never a clean zero. This case never
// occurs in `thyroid-panel.csv` — proved directly against a constructed row.
{
  const blankValueCsv = [
    "marker,value,unit,ref_low,ref_high,flag",
    "TSH,,mIU/L,0.40,4.00,",
  ].join("\n")
  const result = importDocument({
    bytes: new TextEncoder().encode(blankValueCsv),
    format: "csv",
    recordId: "record:blank-value-proof",
    sourceId: "source:blank-value-proof",
    importedAt: "2026-09-12T09:00:00.000Z",
    takenOn: "2026-09-01",
  })
  assert.equal(result.kind, "blood-panel")
  const marker = result.record.markers[0]
  assert.ok(!Object.is(marker.value, 0), "a blank reading must never become a clean zero")
  assert.ok(Number.isNaN(marker.value), "a blank reading has no value to show")
  assert.equal(marker.flaggedAtImport, true, "a blank reading must be flagged, never read as a match")
  assert.equal(marker.flagReason, "No value in the file")
  console.log("PASS  a blank reading is flagged as missing, never parsed as zero")
}

// R3-002: a row with a non-numeric bound must flag, not silently drop that
// bound and read as a clean, unqualified match.
{
  const brokenBoundCsv = [
    "marker,value,unit,ref_low,ref_high,flag",
    "Broken range,7,mg/L,not-a-number,10,",
  ].join("\n")
  const result = importDocument({
    bytes: new TextEncoder().encode(brokenBoundCsv),
    format: "csv",
    recordId: "record:broken-range-proof",
    sourceId: "source:broken-range-proof",
    importedAt: "2026-09-12T09:00:00.000Z",
    takenOn: "2026-09-01",
  })
  assert.equal(result.kind, "blood-panel")
  const marker = result.record.markers[0]
  assert.equal(marker.referenceRange.min, undefined, "an unreadable bound must not enter the range as a number")
  assert.equal(marker.referenceRange.max, 10)
  assert.equal(marker.flaggedAtImport, true, "an unreadable bound must flag, not read as a clean match")
  assert.equal(marker.flagReason, "Reference range could not be read")
  console.log("PASS  a non-numeric reference bound is flagged, never silently dropped")
}

console.log("\nImport flag proof passed.")
