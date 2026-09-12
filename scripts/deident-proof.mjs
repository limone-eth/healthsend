import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

const { createArchive, openArchive, openScopedShare, scopeArchive } = await import("../lib/archive.ts")
const { importDocument } = await import("../lib/import.ts")

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures")

/**
 * Every fixture under `fixtures/`, plus the awkward pair this story adds:
 * an identifier in a CSV header line rather than a cell, and one inside a
 * PDF text run rather than a top-level field. The other six ship with no
 * identifier at all, which is its own useful case — import must not invent
 * a leak, and must not flag one that was never there.
 */
const FIXTURES = [
  { file: "thyroid-panel.csv", format: "csv", expectIdentifiers: false },
  { file: "thyroid-panel.pdf", format: "pdf", expectIdentifiers: false },
  { file: "sleep-60-days.csv", format: "csv", expectIdentifiers: false },
  { file: "consult-notes.txt", format: "text", expectIdentifiers: false },
  { file: "consult-notes.pdf", format: "pdf", expectIdentifiers: false },
  { file: "training-log.json", format: "text", expectIdentifiers: false },
  {
    file: "patient-panel.csv",
    format: "csv",
    expectIdentifiers: true,
    // The awkward case: the identifiers sit in a metadata line ahead of the
    // real CSV header, not in a data cell.
    identifiers: {
      name: "Priya Anand",
      dateOfBirth: "1991-11-02",
      address: "12 Cedar Court, Leyton",
      patientId: "883217",
    },
  },
  {
    file: "patient-summary.pdf",
    format: "pdf",
    expectIdentifiers: true,
    // The awkward case: the identifiers sit inside a PDF text run, and the
    // name recurs later in a wrapped sentence of the same run.
    identifiers: {
      name: "Jane Rivera",
      dateOfBirth: "1988-03-14",
      address: "44 Birch Lane, Springfield",
      patientId: "552391",
    },
  },
  {
    file: "letterhead-report.txt",
    format: "text",
    expectIdentifiers: true,
    // No label anywhere in this file. The name is only findable because it
    // matches the sender's own account name, passed in as ground truth.
    accountName: "Jordan Vance",
    identifiers: {
      name: "Jordan Vance",
    },
  },
  {
    file: "referral-letter.txt",
    format: "text",
    expectIdentifiers: true,
    // Two unlabeled shapes at once: a name after "Re:" (still found only via
    // the account-name match) and a bare date-of-birth-shaped value near the
    // top that no label precedes.
    accountName: "Jordan Vance",
    identifiers: {
      name: "Jordan Vance",
      dateOfBirth: "14 March 1988",
    },
  },
]

const senderKey = crypto.getRandomValues(new Uint8Array(32))

for (const fixture of FIXTURES) {
  const bytes = new Uint8Array(readFileSync(path.join(fixturesDir, fixture.file)))

  if (fixture.expectIdentifiers) {
    // A positive control: prove the raw file actually carries what we expect
    // import to find, so a pass below means the transform worked rather than
    // the fixture never having the identifier to begin with.
    const rawText = Buffer.from(bytes).toString("latin1")
    for (const value of Object.values(fixture.identifiers)) {
      assert.ok(
        Buffer.from(bytes).includes(Buffer.from(value)) || rawText.includes(value),
        `fixture ${fixture.file} does not actually contain its expected identifier: ${value}`,
      )
    }
  }

  const imported = importDocument({
    bytes,
    format: fixture.format,
    recordId: `record:blood-panel:${fixture.file}`,
    sourceId: `source:${fixture.file}`,
    importedAt: "2026-09-12T09:00:00.000Z",
    takenOn: "2026-09-01",
    accountName: fixture.accountName,
  })

  let recipientBytes
  let setAside

  if (imported.kind === "blood-panel") {
    setAside = imported.record.provenance.setAside ?? {}

    // The identifiers must be visible to the sender: they come back out of
    // the sender's own archive.
    const encryptedArchive = await createArchive(senderKey, [imported.record])
    const archive = await openArchive(encryptedArchive, senderKey)
    assert.deepEqual(
      archive.records[0].provenance.setAside ?? {},
      setAside,
      `sender's own archive must still show what was set aside: ${fixture.file}`,
    )

    // Then the same document goes through the real send seam: a scoped
    // share of every marker, opened as a recipient would open it.
    const sharedBytes = await scopeArchive(encryptedArchive, senderKey, [
      { kind: "blood-panel", recordId: imported.record.id, markerIds: imported.record.markers.map((m) => m.id) },
    ])
    const share = openScopedShare(sharedBytes)
    assert.ok(!("provenance" in share.records[0]), `scoped share must drop provenance entirely: ${fixture.file}`)
    recipientBytes = sharedBytes
  } else {
    setAside = imported.setAside
    recipientBytes = new TextEncoder().encode(imported.cleanedText)
  }

  if (fixture.expectIdentifiers) {
    for (const [key, value] of Object.entries(fixture.identifiers)) {
      assert.equal(setAside[key], value, `import must set aside ${key} from ${fixture.file}`)
    }
  } else {
    assert.deepEqual(setAside, {}, `${fixture.file} has no identifier to set aside, so none should be reported`)
  }

  // The proof that matters: whatever a recipient would receive, scanned as
  // raw bytes, must not contain any identifier this file carries.
  const recipientText = Buffer.from(recipientBytes).toString("latin1")
  for (const value of Object.values(setAside)) {
    if (!value) continue
    assert.ok(
      !recipientText.includes(value),
      `identifier leaked into recipient bytes for ${fixture.file}: ${value}`,
    )
    for (const word of value.split(/\s+/)) {
      if (word.length < 3) continue
      assert.ok(
        !recipientText.includes(word),
        `identifier fragment leaked into recipient bytes for ${fixture.file}: ${word}`,
      )
    }
  }

  console.log(
    `PASS  ${fixture.file} imported as ${imported.kind}` +
      (fixture.expectIdentifiers ? ", identifiers set aside and absent from recipient bytes" : ", no identifier present or introduced"),
  )
}

console.log("\nDe-identification proof passed.")
