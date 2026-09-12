# Archive model

`lib/archive.ts` defines the record archive. It does not replace the current file-send path.
`packEnvelope` and `unpackEnvelope` remain authoritative for live file-based sends.
The archive module is authoritative for stored health records and scoped record payloads.
No application screen uses the archive yet.

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
H-16 can add its de-identification transform at the marked boundary in `scopeArchive`.
That boundary is after selection and before recipient encoding.

## Archive and addressing

An archive document contains many records. AES-256-GCM seals the complete document under a stable sender key.
The binary format is `HSAR`, one version byte, a 12-byte nonce, and authenticated ciphertext.
The format publishes no record metadata. It reveals only the total ciphertext length.
The caller can open, add records, and reseal it over time.

A stored archive is one encrypted period chunk. A later manifest can address several chunks.
This keeps range reads bounded as the archive grows. The manifest is outside this model.

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

`scripts/archive-roundtrip.mjs` uses the design fixture. It selects five markers from 32 and opens the result.
It also checks every unselected marker ID and name against the complete recipient byte sequence.
