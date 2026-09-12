/**
 * Proves R2-018: the "in your file" column binds each parsed marker to its
 * own raw row, by position — not by re-searching the file for the marker's
 * name.
 *
 * The two real fixtures this screen ships (`thyroid-panel.csv`,
 * `patient-panel.csv`) happen to have no repeated marker name, so the old
 * by-name lookup (`findSourceLine`, since replaced) already looked correct
 * against them — the bug only shows on a panel that measures the same
 * marker twice, which is exactly the case built here.
 */
import assert from "node:assert/strict"

const { markerSourceLines } = await import("../app/(sender)/import-review/build-review.ts")

const HEADER = "marker,value,unit,ref_low,ref_high,flag"

// --- a repeated marker name still lines up 1:1 with the rows import produces ---
{
  const text = [
    HEADER,
    "TSH,4.82,mIU/L,0.40,4.00,HIGH",
    "Free T4,0.91,ng/dL,0.82,1.77,",
    "TSH,3.10,mIU/L,0.40,4.00,",
  ].join("\n")

  const lines = markerSourceLines(text)

  // `parseBloodPanelMarkers` (lib/import.ts) would read these same three
  // rows, in this same order, into three markers named TSH / Free T4 / TSH —
  // so position 0 and position 2 both being named "TSH" is exactly the case
  // a name-based lookup cannot tell apart.
  assert.equal(lines.length, 3, "one line per data row, in file order")
  assert.equal(lines[0], "TSH,4.82,mIU/L,0.40,4.00,HIGH", "the first TSH row must bind to its own line")
  assert.equal(lines[1], "Free T4,0.91,ng/dL,0.82,1.77,")
  assert.equal(
    lines[2],
    "TSH,3.10,mIU/L,0.40,4.00,",
    "the second TSH row must bind to its own later line, not the first TSH row again",
  )

  // The bug this replaces: search-by-name over the same text always finds
  // the *first* occurrence, so both TSH markers would have resolved to
  // `lines[0]` — position 2's real reading (3.10) would have been shown
  // next to position 0's line (4.82, flagged HIGH).
  const byNameLookup = (name) =>
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.toLowerCase().startsWith(`${name.trim().toLowerCase()},`))
  assert.equal(byNameLookup("TSH"), lines[0], "demonstrating the old bug: by-name lookup collapses both TSH rows to the first")

  console.log("PASS  a repeated marker name still binds each row to its own line, by position")
}

// --- blank lines and a stray malformed row do not shift the alignment ---
{
  const text = [
    HEADER,
    "Ferritin,14,ng/mL,15,150,LOW",
    "",
    "not,a,valid,row", // fewer than five cells — parseBloodPanelMarkers skips it too
    "Vitamin D 25-OH,26,ng/mL,30,100,LOW",
  ].join("\n")

  const lines = markerSourceLines(text)
  assert.deepEqual(lines, ["Ferritin,14,ng/mL,15,150,LOW", "Vitamin D 25-OH,26,ng/mL,30,100,LOW"])
  console.log("PASS  blank and malformed lines are skipped the same way import skips them, so the index still lines up")
}

// --- no header line at all yields no candidate lines, not a false match ---
{
  const lines = markerSourceLines("just,some,text\nwith,no,header,at,all")
  assert.deepEqual(lines, [])
  console.log("PASS  text with no recognised header yields no source lines")
}

console.log("\nAll checks passed.")
