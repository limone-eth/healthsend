# Archive model

`lib/archive.ts` defines the record archive. It does not replace the current file-send path.
`packEnvelope` and `unpackEnvelope` remain authoritative for live file-based sends.
The archive module is authoritative for stored health records and scoped record payloads.
`/add` parses supported files into records, and the signed-in archive screen opens those records after reload.

## Shapes

A blood panel is one `BloodPanelRecord`. It has a date and an archive-local record ID.
Each marker has its own opaque ID, value, unit, reference range, and import flag.
A sender can therefore select one marker without selecting another marker from the same panel.

A wearable metric is one `WearableSeriesRecord`. It names one metric and one unit.
Its values pair one date with one number. Its inclusive range bounds the requested period.
Missing nights can leave gaps inside that range. A target can travel with the series.
Separate metrics use separate record IDs.

Both shapes have archive-only provenance. The provenance points to an opaque source ID.
It does not contain a filename. Scoped shares remove provenance before they encode recipient bytes.

Provenance also carries `setAside`: name, date of birth, address and any patient or
record identifier that `lib/import.ts` found and held back at import, before a record
is ever archived. Neither `BloodPanelRecord` nor `WearableSeriesRecord` has a field for
any of those, so there is nothing for `scopeArchive` to filter at share time — the
identifiers are held back before the record exists, not stripped from it afterwards.
`setAside` is visible to the sender through `openArchive`, and it leaves recipient bytes
the same way the rest of provenance does: `selectRecords` builds every `SharedRecord`
field by field, so an omitted field is never in the object to begin with.

## Archive and addressing

An archive document contains many records. AES-256-GCM seals the complete document under a stable sender key.
The binary format is `HSAR`, one version byte, a 12-byte nonce, and authenticated ciphertext.
The format publishes no record metadata. It reveals only the total ciphertext length.
The caller can open, add records, and reseal it over time.

Each successful update uploads the resealed archive as a new immutable Swarm blob. An identity-owned
Swarm epoch feed is the manifest: its latest update contains only that blob's raw Swarm reference.
The archive key and feed topic come from separate Swarm ID app-secret labels. A sender can therefore
recover both from the signed-in identity alone, including in a fresh browser context. No local storage,
user database, or additional service is part of the address path.

`/add` reads supported source files in the browser and retains only fields represented by an
`ArchiveRecord`. The original file and filename are not retained. Record metadata stays inside the
encrypted blob; the feed exposes only its current reference. The update path uploads replacement
ciphertext before moving the feed reference, so a failed blob upload leaves the previous archive
readable.

The current update is a read-modify-write operation over the complete archive. Two tabs that start
from the same feed value can overwrite one another; the last successful feed update wins. The model
does not yet provide compare-and-swap or merge-on-conflict behavior.

Selections use two address forms:

- Blood panel: `recordId` plus a set of `markerIds`.
- Wearable series: `recordId` plus an inclusive `from` and `through` date.

Record IDs must be unique inside an archive. Marker IDs must be unique inside their panel.
Together, the record ID and marker ID form one marker address. Wearable dates must be unique and ordered.
The model rejects unknown addresses, duplicate selections, empty selections, and reversed ranges.

## Why a scoped share cannot leak an unselected marker

`scopeArchive` opens the encrypted archive in sender memory. It then builds a new object from selected fields only.
It does not slice the encrypted archive. It does not send an archive key, source reference, or provenance.
It serializes only the new object. An unselected marker never enters the recipient bytes.

Those bytes are recipient plaintext. The existing send transport must encrypt them before network or Swarm storage.
The selection must stay inside that encrypted payload. Arkiv can hold only opaque commitments and blinded attributes.
No record ID, marker name, value, unit, range, metric, or selection belongs in an Arkiv attribute.
Only required timestamps can remain plaintext for range queries.

`scripts/archive-roundtrip.mjs` uses `lib/archive-demo.ts` as a proof-only fixture. No application
module imports the fixture, and the archive screen never seeds itself with demo records. The proof
selects five markers from 32 and opens the result. It also checks every unselected marker ID and name
against the complete recipient byte sequence. Because the handwritten fixture has no parser input,
none of its markers claims `flaggedAtImport` uncertainty.
