# Shipped screens audit — 2026-09-12

## Findings

| Rank | Severity | ID | Screen | Finding | Action |
|---:|---|---|---|---|---|
| 1 | Critical | F-01 | `/landing`, `/add`, `/new` | The public Landing and Add screens say that HealthSend sets aside a name and date of birth before a send. The shipped send path reads each selected file into the envelope unchanged. New share gives the opposite, truthful warning. A sender can rely on the public promise and send identifying health data. Evidence: `app/landing/page.tsx:195-200`, `app/add/page.tsx:122-123`, `components/demo-notice.tsx:36-45`, `lib/sends.ts:127-141`. | Remove or qualify the Landing and Add claims now. Restore them only after Add, import, archive persistence, and send are connected and an end-to-end test proves that source identifiers cannot enter a share. |
| 2 | Critical | F-02 | `/import-review` | The screen says, “The file itself stays in your archive…” although it reads repository fixtures and has no archive write. The real archive has no storage loader and always starts with `records = []`. Evidence: `app/import-review/page.tsx:18-33`, `app/import-review/review-screen.tsx:380-386`, `app/(sender)/page.tsx:127-129`. | Replace the retention claim with a demo/preview statement until a durable archive writer and loader exist. Do not say that a file stays anywhere until reload and a second session prove it. |
| 3 | Critical | F-03 | `/import-review` | “Looks right — add to archive” only adds a document ID to local React state. The success message says “Added to archive — ready to include in a share.” Refresh removes it, and New share cannot read it. Evidence: `app/import-review/review-screen.tsx:63-74`, `app/import-review/review-screen.tsx:419-425`. | Do not show the success claim. Disable or relabel the action as a preview until confirmation writes a durable record that Archive and New share can read. Add reload and cross-route tests before restoring “Added”. |
| 4 | High | F-04 | `/landing` | Landing advertises an assistant that reads a scoped archive and loses access on the selected date. The sender Assistant navigation item is inert, and New share omits assistant controls because no backing path exists. Evidence: `app/landing/page.tsx:291-297`, `app/(sender)/layout.tsx:34-38`, `app/(sender)/new/page.tsx:36-45`. | Mark assistant access as planned or remove it from the shipped landing page until the complete assistant flow exists. |
| 5 | High | F-05 | `/landing` at 400px | The mobile copy weakens two personal-data promises: it drops “and date of birth” from the set-aside claim and omits “Signing in takes one tap and creates nothing we can read.” The build matches the mobile frame, but the design rules identify both omissions as defects. Evidence: `app/landing/page.tsx:195-200`, `app/landing/page.tsx:308-313`, `DESIGN.md:1407-1412`. | Give mobile readers the same personal-data promise as desktop, or remove the unsupported promise at both sizes as required by F-01. |
| 6 | High | F-06 | `/landing`, `/`, `/new` | Landing describes a persistent, five-group archive and record-level selection. The real Archive has no storage loader, and New share scopes only the files selected in the current compose flow. Evidence: `app/(sender)/page.tsx:27-33`, `app/(sender)/page.tsx:127-130`, `app/(sender)/new/page.tsx:20-29`. | Present this as future behavior until Add → Review → Archive → New share works across navigation and reload. Keep the current file-based New share behavior; do not fabricate archive records. |
| 7 | High | F-07 | `/add` | Medications, Health history, and Notes look like supported choices but are disabled and have no “Later” or “Not available” label. Only Letter/report says “Later.” The screen also says typed items skip review although no typed-item flow opens. Evidence: `app/add/page.tsx:122-133`, `app/add/page.tsx:163-172`. | Label every unavailable choice directly, and replace capability descriptions with future-tense copy until those buttons work. |
| 8 | Medium | F-08 | `/`, `/new`, `/shares` | A build-only `HealthSend` introduction, identity card, and protocol footer sit inside all sender pages. They move the frame title and primary task down substantially. On mobile, the archive content starts below two extra blocks. Evidence: `app/(sender)/layout.tsx:42-73`. | Remove this second page header from the sender layout or redesign the frames to include it. Keep identity/account controls in compact chrome that does not displace the task. |
| 9 | Medium | F-09 | `/shares` | The frame promises named recipients, roles, structured scopes, assistant activity, locations, and “On their device.” The shipped history stores only file kind/count and times, so the build can only show generic names such as `CSV share`. Evidence: `app/(sender)/shares/local-history.ts:27-37`, `app/(sender)/shares/page.tsx:186-200`, `app/(sender)/shares/page.tsx:235-239`. | Treat the richer frame as future behavior. Add only fields that the product can derive truthfully; do not infer recipient identity, location, device binding, or assistant activity. |
| 10 | Medium | F-10 | Recipient outcome states | Expired, revoked, unavailable, no-key, and error use an old 672px card with no recipient header. They expose implementation terms (`grant`, `Arkiv`, `Swarm`, `decryption key`, `link secret`) even though the design rules ban those terms in flows. Unavailable and error also print raw backend messages. Evidence: `app/s/[key]/page.tsx:355-455`, `DESIGN.md:1169-1173`. | Use the branded outcome family and plain language. Keep revoked separate from natural expiry. Log raw errors; do not render them to the recipient. |
| 11 | Medium | F-11 | `/new` at 400px | The extra sender header, identity card, and large truthful demo notice dominate the first viewport. The fixed summary bar overlays the notice, while the first selectable scope begins below it. | Keep the warning, but make it short and place detail behind disclosure. Reserve bottom padding equal to the fixed summary bar and move the task before account detail. |
| 12 | Low | F-12 | `/add`, `/import-review` at 400px | Both mobile frames begin with `healthsend`; neither build does. Their desktop rail has the brand, but the mobile top edge has no product identity. | Add the compact mobile brand header or update the frames consistently. |

**Audit verdict: fail.** Layout geometry is sound, but F-01 through F-06 make unsupported statements about personal-data handling, persistence, archive scope, and assistant access.

## Scope and method

- Branch: `story/screens-audit`
- Audited revision: `bc185b6b4ea6fcb2fa19cdd732550fdf51b1dfb4` (`board: file H-44 — the archive is never written and never read`)
- Viewports: `1440x1024` and `400x900`
- Design source: every desktop and mobile frame was read independently from `healthsend.pen` through read-only Pencil calls. The design file was not changed.
- Browser source: Playwright ran the actual Next.js app on `http://localhost:3107`. Recipient outcomes used the existing encrypted fixture and offline Arkiv, holder, and Swarm stubs.
- Sender authentication: `/`, `/new`, and `/shares` require a passkey that headless Playwright cannot complete. A temporary `/audit-preview/[screen]` route supplied deterministic data to the real screen components under the real sender layout. The preview route, exports, fixture identity injection, and audit spec were removed after capture. No product-code change remains.
- Dynamic fixture strings such as `Audit fixture`, its address, dates, filenames, counts, and recipient labels are listed in the string audit because they were visible. They are evidence data, not fixed product copy.
- New share input values require a separate note: `document.body.innerText` does not include input values. The final desktop screenshot visibly contains `Elena Rossi` and `4 December 2026`, so those two frame values match.
- Full measured text and geometry are in `measurements.json` beside the screenshots. Extracted comparison data are in `actual-text.json` and `target-frames.json` in the same audit directory.

Screenshot root:

`/private/tmp/claude-501/-Users-limone-Documents-personal-projects-healthsend/6bda6b6b-d5b4-4c59-b7f2-e3e6183dba70/scratchpad/audit/`

### Work in flight

The audit is against the revision above. Work is in flight in these required areas and can invalidate individual observations after merge:

- `app/s/`
- `app/(sender)/new/`
- `app/(sender)/layout.tsx`
- `lib/import.ts`
- `app/import-review/`

Re-run this audit after those changes land.

## Measurements

`overflow` is exactly `document.documentElement.scrollWidth - window.innerWidth`. Any positive value would be a finding. All 24 results are `0`, so there is no horizontal-overflow finding. At 1440px, every sender `<main>` is the required `1176px`. The Landing and recipient routes intentionally use other shells.

| Screen | Viewport | `scrollWidth` | `innerWidth` | `overflow` | `<main>` width(s) |
|---|---:|---:|---:|---:|---:|
| Landing | 1440x1024 | 1440 | 1440 | 0 | 1440 |
| Your archive | 1440x1024 | 1440 | 1440 | 0 | **1176** |
| New share | 1440x1024 | 1440 | 1440 | 0 | **1176** |
| Your shares | 1440x1024 | 1440 | 1440 | 0 | **1176** |
| Add | 1440x1024 | 1440 | 1440 | 0 | **1176** |
| Import review | 1440x1024 | 1440 | 1440 | 0 | **1176** |
| Recipient — OK | 1440x1024 | 1440 | 1440 | 0 | 1080 |
| Recipient — expired | 1440x1024 | 1440 | 1440 | 0 | 672 |
| Recipient — revoked | 1440x1024 | 1440 | 1440 | 0 | 672 |
| Recipient — unavailable | 1440x1024 | 1440 | 1440 | 0 | 672 |
| Recipient — no-key | 1440x1024 | 1440 | 1440 | 0 | 672 |
| Recipient — error | 1440x1024 | 1440 | 1440 | 0 | 672 |
| Landing | 400x900 | 400 | 400 | 0 | 400 |
| Your archive | 400x900 | 400 | 400 | 0 | 400 |
| New share | 400x900 | 400 | 400 | 0 | 400 |
| Your shares | 400x900 | 400 | 400 | 0 | 400 |
| Add | 400x900 | 400 | 400 | 0 | 400 |
| Import review | 400x900 | 400 | 400 | 0 | 400 |
| Recipient — OK | 400x900 | 400 | 400 | 0 | 400 |
| Recipient — expired | 400x900 | 400 | 400 | 0 | 400 |
| Recipient — revoked | 400x900 | 400 | 400 | 0 | 400 |
| Recipient — unavailable | 400x900 | 400 | 400 | 0 | 400 |
| Recipient — no-key | 400x900 | 400 | 400 | 0 | 400 |
| Recipient — error | 400x900 | 400 | 400 | 0 | 400 |

No uncaught page error appeared. The mocked holder responses produced two expected browser resource errors in each viewport for revoked (`410`), unavailable (`503`), and error (`403`). Other captures had no console error.

## String-audit notation

- **Frame → build** means related visible strings differ.
- **Frame only** means the frame string is absent from the build.
- **Build only** means the build string is absent from the frame.
- Repeated strings include an occurrence count when the count differs.
- “All other strings match” means exact visible copy after whitespace normalization. It does not approve the truth of the shared string.

## 1. Landing — `/landing`

Frames: desktop `xKspH`; mobile `t659K4`.

Screenshots:

- `landing-1440.png`
- `landing-400.png`

Measurements: `1440`: overflow `0`, main `1440px`; `400`: overflow `0`, main `400px`.

### Visual and behavior audit

The desktop and mobile layouts closely match their respective frames. The serious defect is not visual: the identifier and archive claims describe an end-to-end flow that does not ship. `importDocument()` does perform a de-identification pass for recognized input (`lib/import.ts:46-70`), but New share never calls it; `createSend()` reads each `File` directly into `packEnvelope()` (`lib/sends.ts:127-141`).

The assistant section also describes an unavailable product path. This is a capability claim, not harmless roadmap copy.

### Complete string differences

- **Desktop vs `xKspH`:** none. The two-line hero is one Pencil text node and two rendered lines; its wording is exact.
- **Mobile vs `t659K4`:** none. The two-line hero has the same line-only rendering difference.
- **Cross-viewport personal-data defect:** desktop says `Drop in an export from your watch and a lab result. Your name and date of birth are set aside as they come in, so they are never part of anything you send.` Mobile says `Drop in an export and a lab result. Your name is set aside as it comes in.`
- **Cross-viewport personal-data defect:** desktop includes `Signing in takes one tap and creates nothing we can read.` Mobile omits it.

All other mobile abridgements preserve their desktop meaning and are permitted by `DESIGN.md:1392-1405`.

## 2. Your archive — `/`

Frames: desktop `ACUf3`; mobile `zsDfc`.

Screenshots:

- `archive-1440.png`
- `archive-400.png`

Measurements: `1440`: overflow `0`, main **`1176px`**; `400`: overflow `0`, main `400px`.

### Visual and behavior audit

The archive cards, focus strip, and responsive navigation are polished and use the correct width. The shared sender introduction and identity card push the frame content down. The preview proves the populated layout, but the shipped route does not have an archive loader and renders empty groups after a real sign-in.

The build is correct to reject the desktop frame’s unsupported identity claim. It says that identifier separation is intended but not wired, instead of repeating “no share has ever included them.” The populated frame depicts future behavior until persistence and sending from archive records exist.

### Complete desktop string differences (`ACUf3`)

**Frame → build**

- `Two people and your assistant can see part of your archive` → `3 people can see part of your archive` (fixture-dependent count; the model cannot name the assistant).
- `In 2 shares`, `In 3 shares`, `In 1 share` → `Not shared`. The frame contains one other `Not shared`; the build has three extra occurrences.
- `2 years · five kinds` → `5 kinds · latest 3 September`.
- `3 current · updated in July` → `Nothing here yet`.
- `9 notes · latest 28 August` → `Nothing here yet`.
- `Your name and date of birth were separated from the rest the moment you imported. They stay on this page — no share has ever included them, and none can.` → `Your name and date of birth are meant to stay on this page and never travel with a share. That step is built and tested but not yet wired into the upload path, so for now a document is sent exactly as it is.` This build change is truthful and must stay until the protection ships.

**Build only**

- `HealthSend`
- `Share a document with someone for exactly as long as you mean to. When the window closes, we delete our half within the hour.`
- `Audit fixture` and `Swarm ID · 0x1111111111111111111111111111111111111111` (preview data)
- `Advanced`
- `Documents are encrypted in this browser and stored on Swarm. The key that opens them is split in two: half is in the link, half is held for the length of the window and deleted soon after. An Arkiv grant decides when that window ends, and nothing has to run for it to.`

All other desktop strings match.

### Complete mobile string differences (`zsDfc`)

**Frame → build**

- `healthsend` → `HealthSend` (different capitalization and the wrong sender-header treatment).
- `Two people and your assistant see part of it` → `3 people see part of it`.
- `4 panels · latest 12 Aug` → `4 panels · latest 12 August`.
- `In 2 shares`, `In 3 shares`, `In 1 share` → `Not shared`; the build has four total `Not shared` labels.
- `2 years · five kinds` → `5 kinds · latest 3 September`.
- `3 current` → `Nothing here yet`.
- `9 notes` → `Nothing here yet`.

**Build only**

- `Share a document with someone for exactly as long as you mean to. When the window closes, we delete our half within the hour.`
- `Audit fixture`, `Swarm ID · 0x1111111111111111111111111111111111111111` (preview data), and `Advanced`
- `Add a panel`, `Add wearable data`, `Add a medication`, `Write a note`
- The full protocol footer quoted in the desktop list above.

All other mobile strings match.

## 3. New share — `/new`

Frames: desktop `HMa4U`; mobile `ammIs`.

Screenshots:

- `new-1440.png`
- `new-400.png`

Measurements: `1440`: overflow `0`, main **`1176px`**; `400`: overflow `0`, main `400px`.

### Visual and behavior audit

The desktop two-column geometry is correct. The current screen truthfully scopes picked files and leaves all files unticked after selection. It truthfully disables device locking and omits PIN and assistant controls. Those are correct current-product decisions: the frames depict unsupported future behavior and the build must not fake it.

The amber demo notice correctly contradicts the public de-identification claim. On mobile it is too large for the first task view and is partly covered by the fixed summary bar.

The final desktop screenshot visibly contains the frame fixture value `Elena Rossi` and a custom end date of `4 December 2026`. Input values are not returned by `body.innerText`; they are not missing strings.

### Complete desktop string differences (`HMa4U`)

**Frame-only structured archive scope**

- `2 groups · 1 of 4 panels · 2 of 5 wearables`
- `Blood panels`; `4 panels · latest 12 August`; `1 of 4`
- `Wearables`; `2 years · five kinds of data`; `2 of 5 · custom`
- `Sleep`; `731 nights`; `Training`; `412 sessions`; `Heart rate`; `Resting and variability`; `Steps`; `Daily count`; `Body weight`; `Weekly readings`
- `How far back, for the ones you ticked`; `4 weeks`; `3 months`; `All 2 years`; `From`; `12 Jun 2026`; `To`; `3 Sep 2026`; `84 nights included · everything before 12 June stays out.`
- `Medications`; `3 current · updated in July`; `Notes`; `9 notes · latest 28 August`; `Identity`; `Your name and date of birth`; `Stays with you`

**Frame → build**

- `A label just for you. It never appears on her page.` → `A label just for you. It never appears on their page.`
- `How she opens it` → `How they open it`.
- `She opens it once and it stops working anywhere else. You'll see when she did.` → `Not available in this build.`
- `Twelve weeks from today.` → `Custom — ends when you pick a date and time.`
- `On 4 December her access ends on its own. There is nothing for you to remember and nothing for her to give back.` → `On 4 December 2026 their access ends on its own. There is nothing for you to remember and nothing for them to give back.`

The gender-neutral `they/their` changes are correct because a label does not establish a person’s gender.

**Frame only: unsupported future controls**

- `Add a PIN`
- `Send it to her in a different app, not with the link.`
- `Let her assistant read it too`
- `She can connect the assistant she already uses.`
- `What her assistant can see`

**Build only**

- `HealthSend`; the shared sender introduction; `Advanced`; and the full protocol footer.
- `Audit fixture` and its Swarm ID address (preview data).
- `This is a hackathon demo.`
- `Your files are encrypted in this browser before they leave it, and the encrypted copy alone opens nothing. But anyone with the link can open it — including anyone your recipient forwards it to. There is no separate code and no device check to confirm it's still them. The encrypted copy also goes to a public network and stays there permanently — expiry ends access, it does not erase anything. And nothing strips your name or date of birth from a file today: that code exists and is tested, but the upload path does not call it yet (story H-36), so whatever is in the document goes in as it is. Please use the sample files in fixtures/ instead of your own health records.`
- `Replace files`; `All 2 included`; `Documents`; `2 files picked this send`; `All`; `thyroid-panel.csv`; `csv · 331 B`; `consult-notes.txt`; `text · 918 B` (current file scope and fixture data).
- `2 min`; `10 min`; `1 hr`; `7 days`; `12 wks`.
- The browser’s visible native custom input also shows `04/12/2026, 08:00`.

`Elena Rossi`, `4 December 2026`, `Anyone with the link`, its risk explanation, and `Create the link` match the frame. All other desktop strings match.

### Complete mobile string differences (`ammIs`)

**Frame only**

- `Back`
- `healthsend`
- `Step 1 of 2 — choose what to include. Tap a group to share all of it, or open it to pick.`
- `Blood panels`; `1 of 4 panels`; `1 of 4`
- `Wearables`; `2 of 5 kinds · custom range`; `2 of 5 · custom`
- `Medications`; `3 current`; `Notes`; `9 notes`; `Identity`; `Name, date of birth`; `Stays with you`
- `2 groups · 1 of 4 panels · 2 of 5 wearables`

**Build only**

- `HealthSend`; the shared sender introduction; `Audit fixture`; its Swarm ID address; `Advanced`; the full protocol footer; `Archive`; `Shares`; `Assistant`.
- `Choose what to include and when it should end. Nothing is included until you tick it.`
- Both demo-notice strings quoted in the desktop list.
- `Replace files`; `WHAT TO INCLUDE`; `All 2 included`; `Documents`; `2 files picked this send`; `All`; `thyroid-panel.csv`; `csv · 331 B`; `consult-notes.txt`; `text · 918 B`; `2 of 2 files included`.

`New share` and `Continue` match. No other frame strings appear.

## 4. Your shares — `/shares`

Frames: desktop `hCcwO`; mobile `aOxXo`.

Screenshots:

- `shares-1440.png`
- `shares-400.png`

Measurements: `1440`: overflow `0`, main **`1176px`**; `400`: overflow `0`, main `400px`.

### Visual and behavior audit

The cards, chips, countdowns, access-log disclosure, ended group, and responsive stacking are coherent. The content model cannot support the frame’s named-person and assistant stories. The build is correct to show generic file-share labels instead of inventing names, relationships, device binding, scope, location, or assistant questions. The frame depicts unsupported future behavior.

The preview sorts current entries by send time, which puts the ending-soon CSV first rather than the frame’s Elena card. This reflects shipped sort behavior, not a capture error.

### Complete desktop string differences (`hCcwO`)

**Frame only**

- `Two people and your assistant can see part of your archive. Each one ends on its own date — you don't have to do anything.`
- `Elena Rossi`; `On their device`; `Nutritionist · twelve-week block`; `Ends 4 December`; `Blood panels · 1 of 4`; `Wearables · sleep + training`; `Training`
- `Opened 9 times. Last on Tuesday at 08:14, from Rome.`; `Tuesday 08:14`; `Opened` (two occurrences); `Rome, Italy` (two occurrences); `Monday 19:02`
- `Marco Fabbri`; `Second opinion · one-off, anyone with the link`; `ENDING SOON`; `Ends Sunday`; `Blood panels · 1 of 4` (three target-only occurrences total); `Training`; `Nobody has opened this yet. You can end it before it is ever seen.`; `When it's opened`
- `Claude`; `Your assistant · connected on this laptop`; `Ends 5 October`; `Wearables · 14 days`; `Sleep and training only` (two occurrences); `Answered 4 questions from your data. Last on Monday.`; `What it asked`
- `Laboratorio Bianchi`; `One blood panel · opened twice`

**Build only**

- `HealthSend`; the shared sender introduction; `Advanced`; and the full protocol footer.
- `Audit fixture` and its Swarm ID address (preview data).
- `Every document you've shared, and how long is left. Each one ends on its own — you don't have to do anything.`
- `CSV share`; `1 document · Sent 20 September`; `CLOSING`; `Expires Sunday`; `Not opened yet. You can end it before it is ever seen.`; `No opens recorded yet.`
- `Mixed share`; `Active`; `2 documents · Sent 11 September`; `Expires 4 December 2026`; `Opened 3 times. Last on Monday 10:00.`; `When she looked`
- `Text share`; `1 document · Sent 7 September`; `Expires 5 October 2026`; `Opened once. Last on Sunday 10:00.`; a second `When she looked`
- `PDF share`; `1 document · opened 2 times`; `Ended`

Exact common strings include `Not opened yet`, `ACTIVE`, `6 days left`, `74 days left`, `14 days left`, `Hide`, `End access now`, `ALREADY ENDED`, and `Ended 2 August`. All other desktop strings match.

### Complete mobile string differences (`aOxXo`)

**Frame only**

- `healthsend`
- `Two people and your assistant. Each ends on its own.`
- `Elena Rossi`; `Nutritionist · 12 weeks`; `On their device`; `Ends 4 December`; `74 days`; `Blood panels · 1 of 4`; `Wearables`
- `Marco Fabbri`; `Second opinion · one-off`; `Ends Sunday`; `6 days`; `Blood panels · 1 of 4`
- `Claude`; `Your assistant`; `Ends 5 October`; `14 days`; `Wearables · 14 days`
- `Laboratorio Bianchi`; `One blood panel · opened twice`; `Ended 2 Aug`

**Build only**

- `HealthSend`; the shared sender introduction; `Audit fixture`; its Swarm ID address; `Advanced`; and the full protocol footer.
- `Every document you've shared, and how long is left. Each one ends on its own — you don't have to do anything.`
- `CSV share`; `1 document · Sent 20 September`; `CLOSING`; `Expires Sunday`; `6 days left`; `Not opened yet. You can end it before it is ever seen.`; `When she looked`; `End access now`
- `Mixed share`; `Active`; `2 documents · Sent 11 September`; `ACTIVE`; `Expires 4 December 2026`; `74 days left`; `Opened 3 times. Last on Monday 10:00.`; `When she looked`; `End access now`
- `Text share`; `Active`; `1 document · Sent 7 September`; `ACTIVE`; `Expires 5 October 2026`; `14 days left`; `Opened once. Last on Sunday 10:00.`; `When she looked`; `End access now`
- `PDF share`; `1 document · opened 2 times`; `Ended`

`Your shares`, `Not opened yet`, `ALREADY ENDED`, and the bottom tabs match. All other mobile strings match.

## 5. Add — `/add`

Frames: desktop `gxi6Y`; mobile `TdVX6`.

Screenshots:

- `add-1440.png`
- `add-400.png`

Measurements: `1440`: overflow `0`, main **`1176px`**; `400`: overflow `0`, main `400px`.

### Visual and behavior audit

The card/row layouts closely match. Desktop copy is exact. The unsupported cards are grey, but Medications, Health history, and Notes still retain capability labels and descriptions. Their disabled controls give no direct reason.

Selecting either supported file card opens a picker. After selection the screen says `Reading and checking it is not built on this screen yet — that is H-15.` (`app/add/page.tsx:203-212`). That directly conflicts with the screen-level claim that files are read here and identifiers are lifted out.

### Complete string differences

- **Desktop vs `gxi6Y`:** none.
- **Mobile vs `TdVX6`:** frame only: `healthsend`. Every other mobile string matches exactly. There is no build-only string.

The exact match does not approve the false behavior claim in F-01 or the unavailable choices in F-07.

## 6. Import review — `/import-review`

Frames: desktop `CEPKc`; mobile `TbHzg`.

Screenshots:

- `import-review-1440.png`
- `import-review-400.png`

Measurements: `1440`: overflow `0`, main **`1176px`**; `400`: overflow `0`, main `400px`.

### Visual and behavior audit

The build uses real parser output from three repository fixtures instead of hand-written Lab Bianchi values. That is a valid fixture difference. It is not a visual defect. The screen does not, however, write the result anywhere. The persistent-file note and post-click success state are false.

Desktop shows a responsive table and mobile shows stacked marker rows as designed. Mobile adds the false retention note even though `TbHzg` omits it.

### Complete desktop string differences (`CEPKc`)

**Frame → build fixture differences**

- `These came out of Lab Bianchi · 12 Aug 2026.pdf. Anything you send later is built from this list, not from the file — so it is worth thirty seconds now.` → `These came out of thyroid-panel.csv. Anything you send later is built from this list, not from the file — so it is worth thirty seconds now.`
- `29 of 32 read cleanly` → `7 of 10 read cleanly`.
- `All 32` → `All 10`.
- `Fix the three flagged` → `Fix the 3 flagged`.

**Frame only: Lab Bianchi fixture**

- `Thyroid antibody`; `122`; `Anti-TPO 122`; `No unit in the file`; `Check the unit`
- `Vitamin D`; `25-hydroxy`; `54`; `nmol/L`; `25-OH-D 21.6 ng/mL`; `Converted from ng/mL`; `Check the maths`
- `Sample date`; `When blood was taken`; `12 Aug 2026`; `Prelievo: 12/08/26`; `Read day-first`; `Confirm the date`
- `Ferritin`; `Iron store`; `38`; `µg/L`; `Ferritin 38 ug/L (15-300)`; `Matches`
- `Thyroid stimulating`; `3.9`; `TSH 3.90 mIU/L`; `Matches`

**Build only: repository fixture**

- `Thyroid panel`; `Patient panel`; `Consult note`
- `TSH`; `4.82`; `mIU/L`; `TSH,4.82,mIU/L,0.40,4.00,HIGH`; `Needs a look`; `Flagged HIGH in the file`
- `TPO antibodies`; `212`; `IU/mL`; `TPO antibodies,212,IU/mL,0,34,HIGH`; a second `Needs a look`; a second `Flagged HIGH in the file`
- `Vitamin D 25-OH`; `21`; `ng/mL`; `Vitamin D 25-OH,21,ng/mL,30,100,LOW`; a third `Needs a look`; `Flagged LOW in the file`

`· 3 need a look` differs from the frame only in source spacing (`·  3 need a look`). All other desktop strings, including the false archive-retention note, match.

### Complete mobile string differences (`TbHzg`)

**Frame → build fixture differences**

- `From Lab Bianchi · 12 Aug 2026.pdf. Anything you send is built from this list.` → `From thyroid-panel.csv. Anything you send is built from this list.`
- `29 of 32 read cleanly` → `7 of 10 read cleanly`.
- `Fix the three flagged` → `Fix the 3 flagged`.

**Frame only: Lab Bianchi fixture**

- `healthsend`
- `122 IU/mL`; `Anti-TPO 122`; `Check the unit`; `No unit in the file`
- `Vitamin D`; `54 nmol/L`; `25-OH-D 21.6 ng/mL`; `Check the maths`; `Converted from ng/mL`
- `Sample date`; `12 Aug 2026`; `Prelievo: 12/08/26`; `Confirm the date`; `Read day-first`
- `Ferritin`; `38 µg/L`; `Ferritin 38 ug/L`; `Matches`

**Build only: repository fixture and claim**

- `Thyroid panel`; `Patient panel`; `Consult note`
- `TSH`; `4.82 mIU/L`; `TSH,4.82,mIU/L,0.40,4.00,HIGH`; `Needs a look`; `Flagged HIGH in the file`
- `212 IU/mL`; `TPO antibodies,212,IU/mL,0,34,HIGH`; a second `Needs a look`; a second `Flagged HIGH in the file`
- `Vitamin D 25-OH`; `21 ng/mL`; `Vitamin D 25-OH,21,ng/mL,30,100,LOW`; a third `Needs a look`; `Flagged LOW in the file`
- `The file itself stays in your archive so you can come back and compare. It is locked to you like your name is — no share can ever include it, which is exactly why these readings need to be right.`

All other mobile strings match.

## 7. Recipient OK — `/s/[key]` (`ok`)

Frames: desktop `XhRxB`; mobile `X4AJCV`.

Screenshots:

- `recipient-ok-1440.png`
- `recipient-ok-400.png`

Measurements: `1440`: overflow `0`, main `1080px`; `400`: overflow `0`, main `400px`.

### Visual and behavior audit

The build decrypts and displays the actual two-file fixture. It does not invent parsed sleep, training, or biomarker records. This is correct current behavior: the frame depicts the unsupported future structured-record model. The current recipient screen is much sparser, but its file list and CSV table are truthful.

The build also omits the frame’s assistant connector because no assistant path exists. That omission is correct until the feature ships.

### Complete desktop string differences (`XhRxB`)

**Frame only: structured future content**

- Header/status: `Wearables`; `1 blood panel`; `Ends 4 December`; `74 days`; `on 11 September · readings only, nothing to download`
- Sleep: `Sleep`; `Last 14 nights`; `21 Aug`; `28 Aug`; `3 Sep`; `At or over 7h 30m`; `Under 7h 30m`; `6h 12m`; `Nightly average`; `4 / 14`; `Nights over 7h 30m`; `−1h 18m`; `Against 7h 30m`
- Training: `Training`; `Last 14 days`; `Week of 21 Aug`; `4 sessions · 3h 10m`; `Week of 28 Aug`; `2 sessions · 1h 25m`; `6`; `Sessions`; `4h 35m`; `Total time`; `−55%`; `Week on week`
- Blood panel: `Blood panel`; `Taken 12 August 2026 · 32 markers, 5 shared`; `MARKER`; `RESULT`; `UNIT`; `LAB REFERENCE RANGE`; `Ferritin`; `38`; `µg/L`; `15 – 300`; `In range` (four occurrences); `TSH`; `3.9`; `mIU/L`; `0.4 – 4.0`; `Free T4`; `14.2`; `pmol/L`; `12 – 22`; `TPO antibodies`; `122`; `IU/mL`; `under 34`; `Above range`; `Vitamin D`; `54`; `nmol/L`; `50 – 125`
- Scope note: `Values as reported by the issuing laboratory, with their reference ranges. The sender chose which markers to include — the other 27 were not shared.`
- Assistant: `Read this with your own assistant`; `The sender allowed it. Your assistant can answer questions from these numbers in summaries, never the individual readings, and it stops on 4 December with the rest of this page.`; `Connect your assistant`

**Build only: real encrypted fixture content**

- `CLOSING`; `Expires Saturday`; `1 hour left`
- `2 documents · nothing to download`
- `thyroid-panel.csv` (two occurrences); `Viewing`; `consult-notes.txt`; `CSV · 52 B`
- `marker value unit`; `TSH 4.82 mIU/L`; `Free T4 0.91 ng/dL` (the rendered table uses tabs between columns)

`healthsend`, `Shared with you`, the sender invitation, and `Create your archive` match. All other desktop strings are listed above.

### Complete mobile string differences (`X4AJCV`)

**Frame only: structured future content**

- Header/status: `Ends 4 December`; `on 11 September · readings only, nothing to download`; `Wearables`; `1 panel`
- Sleep: `Sleep`; `Last 14 nights`; `21 Aug`; `28 Aug`; `3 Sep`; `At or over 7h 30m`; `Under 7h 30m`; `6h 12m`; `Nightly average`; `4 / 14`; `Nights over 7h 30m`
- Training: `Training`; `Last 14 days`; `Week of 21 Aug`; `4 sessions · 3h 10m`; `Week of 28 Aug`; `2 sessions · 1h 25m`; `6`; `Sessions`; `4h 35m`; `Total time`; `−55%`; `Week on week`
- Blood panel: `Blood panel`; `12 August`; `Ferritin`; `15 – 300 µg/L`; `38`; `In range` (four occurrences); `TSH`; `0.4 – 4.0 mIU/L`; `3.9`; `Free T4`; `12 – 22 pmol/L`; `14.2`; `TPO antibodies`; `under 34 IU/mL`; `122`; `Above`; `Vitamin D`; `50 – 125 nmol/L`; `54`; `5 of 32 markers shared, with the lab's own ranges.`
- Assistant: `Read this with your own assistant`; `The sender allowed it. Your assistant can answer from these numbers in summaries, never the individual readings, and it stops on 4 December with the rest of this page.`; `Connect your assistant`

**Build only**

- The same current-fixture strings as desktop: `CLOSING`; `Expires Saturday`; `1 hour left`; `2 documents · nothing to download`; two `thyroid-panel.csv` occurrences; `Viewing`; `consult-notes.txt`; `CSV · 52 B`; `marker value unit`; `TSH 4.82 mIU/L`; `Free T4 0.91 ng/dL`.

`healthsend`, `Shared with you`, `Do you send health data too?`, `Same sign-in you used to open this.`, and `Create yours` match. All other mobile strings are listed above.

## 8. Recipient expired — `/s/[key]` (`expired`)

Frames: desktop `WtHlp`; mobile `zHvvF` (“After it ends”). The same six frame strings apply at both sizes.

Screenshots:

- `recipient-expired-1440.png`
- `recipient-expired-400.png`

Measurements: `1440`: overflow `0`, main `672px`; `400`: overflow `0`, main `400px`.

### Visual and behavior audit

Natural expiry maps to the ended frame family. The build’s technical caveat that expiry is not erasure is accurate, but the recipient flow uses protocol vocabulary and loses the frame’s branded status shell, date, next step, and opening-history context.

### Complete string differences at both sizes

**Frame only**

- `healthsend`
- `Ended 4 December`
- `This has ended`
- `Access ran out on 4 December, on its own. Nobody closed it and nobody needs to — there is nothing left on this page to open.`
- `Still working together? Ask for a new link and you will get a fresh twelve weeks.`
- `You opened this 9 times between 11 September and 2 December.`

**Build only**

- `This link has expired`
- `The grant reached the end of its life and no longer appears in Arkiv’s index. The holder checks for it before serving its half of the key, so there is no longer a second half to put this one together with.`
- `Nobody ended this early. No job ran. The access simply ran out.`
- `To be precise about what that does and does not mean: the encrypted document is still on Swarm, and the grant’s contents remain in the transaction that created it. Expiry ends access through this app. It is not erasure.`

There are no exact common strings.

## 9. Recipient revoked — `/s/[key]` (`revoked`)

No dedicated Pencil frame exists.

Screenshots:

- `recipient-revoked-1440.png`
- `recipient-revoked-400.png`

Measurements: `1440`: overflow `0`, main `672px`; `400`: overflow `0`, main `400px`.

### Visual and behavior audit

Do not reuse `WtHlp`/`zHvvF` verbatim: those frames say nobody closed access, which would be false after a revoke. The build correctly distinguishes sender-ended access from natural expiry and correctly says that ending is not erasure. A dedicated branded revoked state is still needed.

### Complete build-only strings at both sizes

- `Access to this send has ended`
- `The sender ended it early, before the window they set had closed. Nothing went wrong on either side.`
- `To be precise about what that does and does not mean: the encrypted document is still on Swarm, and the grant’s contents remain in the transaction that created it. Ending access stops it being reopened through this app. It is not erasure.`

The mock’s expected `410 Gone` response produced two resource-error console entries at each viewport. It did not cause a page exception.

## 10. Recipient unavailable — `/s/[key]` (`unavailable`)

Frames: desktop `RqJ31`; mobile `f9lYQS`. The same six frame strings apply at both sizes.

Screenshots:

- `recipient-unavailable-1440.png`
- `recipient-unavailable-400.png`

Measurements: `1440`: overflow `0`, main `672px`; `400`: overflow `0`, main `400px`.

### Visual and behavior audit

The build correctly distinguishes infrastructure failure from expiry. It should adopt the frame’s branded shell and calmer plain language. The raw holder error should not be shown.

### Complete string differences at both sizes

`Temporarily unavailable` is the only exact common string.

**Frame only**

- `healthsend`
- `Ends 4 December`
- `This has not ended. The window runs until 4 December. The service that holds half the key could not be reached just now, so this page cannot put it back together yet.`
- `Try again in a moment. If it keeps failing, ask the sender — they still have the documents and can send a fresh link.`
- `Nothing is wrong with your link.`

**Build only**

- `This link has not expired. The service that holds half of the decryption key could not be reached just now, so the key cannot be put back together. Try again in a moment.`
- `If it keeps failing, ask the sender — they still hold the document and can re-share it.`
- `Could not reach the holder` (raw backend message)

The mock’s expected `503 Service Unavailable` response produced two resource-error console entries at each viewport. It did not cause a page exception.

## 11. Recipient no-key — `/s/[key]` (`no-key`)

No matching Pencil outcome frame exists.

Screenshots:

- `recipient-no-key-1440.png`
- `recipient-no-key-400.png`

Measurements: `1440`: overflow `0`, main `672px`; `400`: overflow `0`, main `400px`.

### Visual and behavior audit

`wIxCY`/`e1Zud2` are not no-key frames. They depict a valid unopened share with a separately delivered four-digit code and device binding. No-key is a malformed URL whose fragment is absent. Mapping it to first-open would hide the actual recovery step and falsely claim PIN/device support.

The current no-key state is semantically correct but visually belongs to the old card family and uses the banned term “decryption key.”

### Complete build-only strings at both sizes

- `Incomplete link`
- `This link is missing the part after the #, which carries half the decryption key. It was probably truncated when it was copied — ask the sender for the full link.`

### Unsupported first-open frame strings

Both first-open frames contain:

- `healthsend`
- `Ends 4 December`
- `Health data, shared with you`
- `Sleep, training and one blood panel — yours to read until 4 December. No account, and nothing to install.`
- `The four-digit code you were sent separately`
- `She sent this on its own, away from the link — check your messages.`
- `Open it`

Desktop `wIxCY` adds:

- `This will be tied to this device`
- `You will be asked to confirm once. After that the link stops working anywhere else, and the sender can see when it was opened.`

Mobile `e1Zud2` instead adds:

- `This will be tied to this phone`
- `Your phone will ask for Face ID once. After that the link stops working anywhere else, and the sender can see when it was opened.`

The build is correct not to render any of these strings because PIN and device binding do not ship.

## 12. Recipient error — `/s/[key]` (`error`)

No matching Pencil frame exists.

Screenshots:

- `recipient-error-1440.png`
- `recipient-error-400.png`

Measurements: `1440`: overflow `0`, main `672px`; `400`: overflow `0`, main `400px`.

### Visual and behavior audit

The error has a distinct semantic state, but it exposes grant and link-secret terminology plus the raw authorization response. It needs a branded, non-technical recovery state. It must not claim expiry, revoke, or erasure.

### Complete build-only strings at both sizes

- `Could not open this send`
- `The grant was found but the document would not decrypt. That usually means the link secret does not match this grant.`
- `Not authorised for this grant` (raw backend message)

The mock’s expected `403 Forbidden` response produced two resource-error console entries at each viewport. It did not cause a page exception.

## Recommended order of work

1. Correct the public data-handling claims (F-01, F-05).
2. Remove false persistence and success claims from Import review (F-02, F-03).
3. Mark archive-group and assistant stories as future behavior (F-04, F-06, F-07).
4. Keep the truthful file-based New share and recipient rendering while the structured model is absent.
5. Rebuild recipient outcome chrome and remove protocol/raw-error copy (F-10).
6. Resolve sender chrome displacement and mobile first-viewport issues (F-08, F-11, F-12).
7. Re-audit both viewports after the in-flight paths merge.

## Contract amendments received

None.

## Choices

Entries are in ascending confidence order.

1. **Choice:** Report missing mobile `healthsend` branding as a low visual finding. **Gap:** The brief did not set a severity for brand-only drift. **Reach:** A later story can fix the mobile shell without changing data behavior. **Verdict:** sound. **Confidence:** 92.
2. **Choice:** List dynamic fixture text, but do not treat fixture-value differences as fixed product-copy defects. **Gap:** The brief required every string difference but did not classify runtime data. **Reach:** Future audits can change fixtures without filing false copy regressions. **Verdict:** sound. **Confidence:** 96.
3. **Choice:** Map natural expiry to the ended frames. Do not map revoked, no-key, or error to them. **Gap:** The design has no dedicated frames for those three outcomes. **Reach:** Later outcome designs must preserve each state’s different cause and recovery step. **Verdict:** sound. **Confidence:** 99.
