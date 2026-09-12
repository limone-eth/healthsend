# Fixtures

Synthetic health documents for testing the send flow. All data is made up —
there is no real person here, and nothing in this folder is anyone's health
information.

| File | Kind | Exercises |
|---|---|---|
| `thyroid-panel.csv` | csv | The CSV table view. Out-of-range flags, the shape a clinician reads. |
| `sleep-60-days.csv` | csv | A wider, longer CSV — 60 rows, 7 columns. Scrolling and header stickiness. |
| `consult-notes.txt` | text | The monospace text view. |
| `training-log.json` | text | JSON through the text path (classified as `text`, not a special case). |
| `consult-notes.pdf` | pdf | The embedded PDF view, toolbar suppressed. |
| `thyroid-panel.pdf` | pdf | A second PDF, so two sends of the same kind can run at once. |

Worth sending several at once: each send gets its own content key, its own link
secret and its own grant, so expiring one must leave the others untouched. Give
them different windows (2 minutes, 10 minutes, 1 hour) and watch them drop out of
the dashboard one at a time.

## De-identification fixtures

Four more files carry a made-up name, date of birth, address and patient
identifier — placed somewhere a naive import would miss it — so
`scripts/deident-proof.mjs` (`pnpm verify:deident`) has a real leak to catch,
not just an absence to describe.

The first two carry a label the matcher reads directly. The last two carry no
label at all — they are only caught because the name matches the "sender's"
account name passed into the proof script, and because the date sits near the
top in a shape a birth date is written in.

| File | Kind | Where the identifier hides |
|---|---|---|
| `patient-panel.csv` | csv | A metadata line ahead of the real CSV header, not a data cell. |
| `patient-summary.pdf` | pdf | Inside a PDF text run, including a name that wraps across a line. |
| `letterhead-report.txt` | text | A name alone on a letterhead line, no label, matched against the sender's account name. |
| `referral-letter.txt` | text | A name after `Re:` and an unlabeled date-of-birth-shaped value on the next line. |
