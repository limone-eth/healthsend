---
name: HealthSend
description: Share part of your health record with a person or an assistant, for exactly as long as the relationship lasts.
colors:
  canvas: "#FBFBFB"
  surface: "#FFFFFF"
  grouped: "#F3F4F6"
  hairline: "#E6E7E9"
  silver: "#DADADA"
  disabled: "#ECEDEF"
  ink: "#15161A"
  secondary: "#686B72"
  muted: "#8A8D95"
  navy: "#1F2A44"
  haze: "#E9EEF2"
  haze-strong: "#DCE6EE"
  sage: "#A8B7AB"
  moss: "#657563"
  chalk: "#F7F5F2"
  umber: "#4A423A"
  sand: "#D9CBBE"
  error: "#B84332"
  grad-focus-from: "#28344F"
  grad-focus-to: "#14151A"
  panel-on-dark: "#FFFFFF14"
  hairline-on-dark: "#FFFFFF33"
  glass-raised: "#FFFFFFBF"
typography:
  display:
    fontFamily: "Switzer, Figtree, -apple-system, Helvetica, Arial, sans-serif"
    fontSize: "44px"
    fontWeight: 700
    lineHeight: 1.09
    letterSpacing: "-0.9px"
  display-mobile:
    fontFamily: "Switzer, Figtree, -apple-system, Helvetica, Arial, sans-serif"
    fontSize: "34px"
    fontWeight: 700
    lineHeight: 1.12
    letterSpacing: "-0.7px"
  headline:
    fontFamily: "Switzer, Figtree, -apple-system, Helvetica, Arial, sans-serif"
    fontSize: "28px"
    fontWeight: 600
    lineHeight: 1.21
    letterSpacing: "-0.5px"
  title:
    fontFamily: "Switzer, Figtree, -apple-system, Helvetica, Arial, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.47
    letterSpacing: "-0.25px"
  body:
    fontFamily: "Switzer, Figtree, -apple-system, Helvetica, Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.47
    letterSpacing: "normal"
  label:
    fontFamily: "Switzer, Figtree, -apple-system, Helvetica, Arial, sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.38
    letterSpacing: "normal"
  eyebrow:
    fontFamily: "Switzer, Figtree, -apple-system, Helvetica, Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "1.2px"
rounded:
  select: "7px"
  glyph: "10px"
  control: "14px"
  inset: "16px"
  card: "22px"
  sheet: "28px"
  capsule: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  xxl: "24px"
  xxxl: "28px"
  gutter: "40px"
  screen-inset: "48px"
components:
  action-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    height: "52px"
    padding: "0 24px"
    typography: "{typography.title}"
  action-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "52px"
    padding: "0 24px"
  action-informational:
    backgroundColor: "{colors.haze}"
    textColor: "{colors.navy}"
    rounded: "{rounded.capsule}"
    height: "44px"
    padding: "0 12px"
  action-destructive:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.error}"
    rounded: "{rounded.capsule}"
    height: "30px"
    padding: "0 12px"
  action-disabled:
    backgroundColor: "{colors.disabled}"
    textColor: "{colors.secondary}"
    rounded: "{rounded.control}"
    height: "52px"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.card}"
    padding: "20px"
  inset-note:
    backgroundColor: "{colors.grouped}"
    textColor: "{colors.secondary}"
    rounded: "{rounded.inset}"
    padding: "16px"
    typography: "{typography.label}"
  field-input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "54px"
    padding: "0 16px"
  scope-row:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "64px"
    padding: "0 18px"
  scope-row-selected:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "64px"
  scope-row-locked:
    backgroundColor: "{colors.disabled}"
    textColor: "{colors.muted}"
    rounded: "{rounded.control}"
    height: "64px"
  checkbox:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.select}"
    size: "22px"
  checkbox-checked:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
    rounded: "{rounded.select}"
    size: "22px"
  countdown:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "56px"
    padding: "0 16px"
  chip-neutral:
    backgroundColor: "{colors.grouped}"
    textColor: "{colors.secondary}"
    rounded: "{rounded.capsule}"
    height: "28px"
    padding: "0 11px"
  chip-active:
    backgroundColor: "{colors.haze}"
    textColor: "{colors.navy}"
    rounded: "{rounded.capsule}"
    height: "28px"
    padding: "0 11px"
  chip-claimed:
    backgroundColor: "{colors.sage}"
    textColor: "{colors.moss}"
    rounded: "{rounded.capsule}"
    height: "28px"
    padding: "0 11px"
  chip-ending:
    backgroundColor: "{colors.chalk}"
    textColor: "{colors.umber}"
    rounded: "{rounded.capsule}"
    height: "28px"
    padding: "0 11px"
  glyph-container:
    backgroundColor: "{colors.haze}"
    textColor: "{colors.navy}"
    rounded: "{rounded.glyph}"
    size: "32px"
  rail:
    backgroundColor: "{colors.surface}"
    width: "264px"
    padding: "28px 20px"
  rail-item-selected:
    backgroundColor: "{colors.haze}"
    textColor: "{colors.navy}"
    rounded: "{rounded.control}"
    height: "44px"
    padding: "0 14px"
---

# HealthSend — Design

## Overview

**North star: The Lent Window.**

HealthSend lends a view onto a health record and then closes it. Everything in this
system exists to make that sentence literal:

- **A window, not a file.** The recipient gets a page of readings — no save, no
  export, no print, no original PDF. She can read it; she cannot keep it.
- **The record is the picture.** The interface brings no imagery and almost no colour
  of its own: `canvas` ground, `surface` cards, `hairline` rules, almost-black type,
  one cool slate-blue accent, warm beige for small marks. The numbers are the only
  thing on the page worth looking at, so nothing competes with them.
- **A date closes the window, not a person.** Expiry is drawn as a date, never as a
  depleting gauge. Nobody has to remember to shut anything, which is why there is no
  "renew" and no red alarm when a share ends.
- **Light means readings; dark means there is nothing to read.** The ended page is
  the only surface that inverts, and that is the whole signal.

The system descends from the **Omea V8.0** mobile kit — palette, five-step scale,
Phosphor Light, 22pt cards, the shadow triplets and the spacing ratios are all
inherited — re-calibrated for a desktop-first browser app that holds together down to
a phone. **The one deliberate break is photography**, which Omea uses throughout and
HealthSend drops entirely: see *No photography* below. This file is self-contained.
The visual source of truth is `healthsend.pen`, sheets 0–4.

**Mode: Operate**, with one Persuade surface. The sender's app (archive, new share,
your shares, your assistant) is a tool — scanability, consistency and precision win
over expression. The recipient's page is the exception: it is the only surface a
stranger ever sees, it has to be understood in four seconds on a phone with no
account, and it is allowed to be beautiful first.

**Two readers, one primitive.** A share is a share whether a human or an assistant
opens it. Same scoping screen, same end date, same states, same words. The only
difference is the recipient step: a link for a person, a connection code for an
assistant.

---

## Colors

Colour is never the only signal. Every state that uses colour also changes a word,
a weight, or a glyph — so the interface survives greyscale, colour-blindness and a
projector at a hackathon.

### Neutral ramp — carries almost everything

| Token | Value | Use |
|---|---|---|
| `canvas` | `#FBFBFB` | App ground, beneath every card and the rail |
| `surface` | `#FFFFFF` | Every repeated card, field, rail and sheet on paper |
| `grouped` | `#F3F4F6` | Inset notes, segmented tracks, log rows inside a card |
| `hairline` | `#E6E7E9` | Dividers and control borders on paper |
| `silver` | `#DADADA` | Unticked checkbox borders, inactive tracks |
| `disabled` | `#ECEDEF` | Disabled fills. Never opacity alone |
| `ink` | `#15161A` | Primary type, primary action fill, selected outline |
| `secondary` | `#686B72` | Body support, and every assistive line under 15px |
| `muted` | `#8A8D95` | Metadata, timestamps, inert carets. **Never assistive copy** |

### Cool — informational, never brand

| Token | Value | Use |
|---|---|---|
| `navy` | `#1F2A44` | Eyebrows, informational labels, chart bars, rules. Never a button fill |
| `haze` | `#E9EEF2` | Go-deeper glyph containers, active chips, selected rail item |
| `haze-strong` | `#DCE6EE` | Pressed state of the above; eyebrow type over media |

### Warm — small marks only

| Token | Value | Use |
|---|---|---|
| `chalk` | `#F7F5F2` | The "ending soon" chip and its glyph container |
| `umber` | `#4A423A` | Type and glyphs on `chalk` |
| `sand` | `#D9CBBE` | Warm selected state. Rare |

Warm neutrals never fill a button or a card, and never carry a generic secondary
action.

### Confirmed and destructive

| Token | Value | Use |
|---|---|---|
| `sage` | `#A8B7AB` | "On their device" chip; the success glyph container |
| `moss` | `#657563` | Type and glyphs on `sage` |
| `error` | `#B84332` | **"End access now" and nothing else in this product** |

`error` is reserved for the one destructive, irreversible action. An expired share is
not an error — it is a completed relationship, and it renders in `muted`.

### No photography

The parent kit is built on photography behind glass. HealthSend drops it. Omea earns
its imagery — it is a wellness product and the picture *is* the mood. HealthSend shows
somebody's thyroid results to their nutritionist, and stock imagery behind that reads
as decoration at best, and as a lifestyle brand handling clinical data at worst.

Two consequences:

**One gradient replaces it,** used at most once per screen and only where the parent
kit would have put a photo:

```css
linear-gradient(155deg, #28344F 0%, #14151A 100%)   /* grad-focus-from → grad-focus-to */
```

It appears in exactly two places: the archive's status surface, and the whole ended
page. Every other screen is paper, and most now have **no focus surface at all** —
they are better for it.

**Panels over the gradient are flat, not glass.** `panel-on-dark` (`#FFFFFF14`) with a
`hairline-on-dark` (`#FFFFFF33`) border, and **no backdrop blur**. A gradient is not
media: there is nothing behind it to see through to, so a blur would render as a
slightly paler rectangle pretending to be glass. Type on the gradient is `surface`
white, with `silver` for labels and `haze-strong` for eyebrows.

**What survives of the glass ladder:** one tier, one use. `glass-raised` (`#FFFFFFBF`,
`backdrop-filter: blur(24px)`, plus a 1px top edge because 75% white over white paper
has no body on its own) under the **mobile bottom bar**, where real content scrolls
beneath it. `glass-transparent`, `glass-input` and `glass-tabbar` have no callers in
this product. Under `prefers-reduced-transparency` the bottom bar becomes an opaque
`surface`, not a lighter tint.

---

## Typography

**Switzer**, throughout, from [Fontshare](https://fontshare.com) (free, no user
ceiling). Body at Regular, UI labels at Medium. Load the variable family.

> `healthsend.pen` renders in **Figtree**, the nearest Google-hosted stand-in,
> because the canvas only serves its own font catalogue. Figtree is a fallback, not
> the shipping face. Every text node points at a token, so the swap is one value.

The scale is locked to five steps plus an eyebrow. Four of the six are identical on
desktop and mobile; only Display moves.

| Role | Desktop | Mobile (<768px) | Weight | Tracking |
|---|---|---|---|---|
| Display | 44 / 48 | 34 / 38 | 700 | −0.9 / −0.7 |
| Headline | 28 / 34 | same | 600 | −0.5 |
| Title | 17 / 25 | same | 600 | −0.25 |
| Body | 15 / 22 | same | 400 | — |
| Label | 13 / 18 | same | 500 | — |
| Eyebrow | 12 / 16 | same | 600 | +1.2 |

- **Tabular numerals for every date, count, value and countdown.** Dates that shift
  width as they tick are the one typographic defect this product cannot afford.
  `font-variant-numeric: tabular-nums`.
- Assistive copy under 15px uses `secondary`, never `muted`.
- A screen header is Display over a Body-17 lede at an 8px gap.
- Eyebrows are uppercase, `muted` for structural group headings and `navy` when they
  label something informational.

---

## Layout

Desktop first, and it holds together down to a phone. Three breakpoints, and only one
of them changes a component.

| Width | Layout | Navigation |
|---|---|---|
| ≥ 1280 | Rail + a 1176px content region, padded 44/48 to a 1080px measure. The send screen runs two columns: groups left, a sticky summary panel right | Left rail, 264px, opaque `surface` on a hairline |
| 768–1279 | Rail collapses to a 72px icon rail; content becomes one column at a 32px inset | Icon rail, labels as tooltips |
| < 768 | One column at a 20px inset. Display drops to 34px | Floating bottom bar, `glass-raised`, 72px |

**Measurements**

- Screen inset: **48px** desktop, 32px tablet, 20px mobile.
- Content measure: **1080px** max. Body at 15px wants a 60–75 character line; 1080
  with a two-column split keeps every measure inside that.
- **The region and the measure are two numbers, and both matter.** `ACUf3`, `hCcwO` and
  `HMa4U` all draw the same shape: a 1440 frame, the 264px rail, and a Content region at
  `x=264 w=1176` with `padding: [44, 48]`. 1176 is the region; 1080 is what is left inside
  it. Cap the container at 1080 *and then* apply the 48px inset and the measure comes out
  at 984 — which is what shipped until 2026-09-12, because H-41 widened an inner wrapper
  that a 1080px `main` was already clamping. The 1176 belongs on the element that carries
  the padding.
- Rail: **264px**, `surface`, 1px `hairline` on its right edge, 28/20 padding.
- Two-column split on the send screen: **640px + 400px** at a 40px gutter.
- Spacing scale: **4 / 8 / 12 / 16 / 20 / 24 / 28**, then a 40px gutter.

**Form rhythm** — the single most-copied defect if you get it wrong:

- Label → input: **8px**. Field → field: **12px**. Section gap: 20 or 28px.
- **The 12:8 ratio is the rule, not the numbers.** If those two gaps converge, the
  grouping cue disappears and the form reads as a flat list of disconnected rows.
- Every assistive line — hint, echo or error — occupies the same reserved row, so
  turning an error on never moves the fields below it.

**What moves at mobile**

- The send screen's right panel becomes **step 2 of 2**, with a fixed bottom bar
  carrying the running summary and the primary action.
- The access log stops being a table and stacks into rows. **Tables never scroll
  sideways.**
- The bottom bar must never obscure the last row of content.

**The recipient page is different.** A 64px top bar carrying the wordmark, the scope
chips and the countdown, then a single centred column — 1080px on desktop, full width
at a 20px inset on a phone. **No rail, no bottom bar, no account control, no route
into the sender's archive.** The only thing that resembles navigation is the single
*Create your archive* invitation below the readings (see Growth hook).

It is a **data page, not a hero page**: no cover surface, no display-size headline,
no photograph. The first thing in the column is a one-line attribution — *"Shared with
you"*, naming nobody (see Decisions from the brief) — and the second is a chart. Desktop uses the extra width for a real table with lab reference ranges
side by side; the phone stacks the range under the marker name. Both views show the
**same markers** — a share is a share, and the two renderings must never disagree
about what is in it.

**Touch targets** are 44px minimum everywhere, including the desktop build.

---

## Elevation & Depth

Depth comes from two places, and a surface uses **one or the other, never both**:
**shadow** for opaque cards on paper, **blur** for glass over media. Moving a
component onto glass means removing its shadow.

| Name | Recipe | Use |
|---|---|---|
| Card | `0 0 0 1px rgba(0,0,0,.05)`, `0 2px 5px rgba(27,35,42,.035)`, `0 16px 38px rgba(33,45,54,.075)` | Every repeated card, sheet, field |
| Focus | `0 0 0 1px rgba(255,255,255,.10)`, `0 2px 6px rgba(27,35,42,.06)`, `0 18px 42px rgba(33,45,54,.12)` | The gradient focus surface only |
| Control | `0 0 0 1px rgba(0,0,0,.045)`, `0 5px 14px rgba(33,45,54,.055)` | Inputs, segmented selection, anchored callouts |
| Glass | `backdrop-filter: blur(24px)`, 1px top edge `rgba(0,0,0,.06)` | The mobile bottom bar, and nothing else |

**At most one focus surface per screen**, and it is the gradient — never a tint, never
two of them, and never on a screen that does not need one. Repeated cards below it
stay white and untinted. A surface carries a shadow **or** a blur, never both.

---

## Shapes

Radii are continuous, not stepped, and each one has a job.

| Token | Radius | Applies to |
|---|---|---|
| `select` | 7px | Checkboxes. A checkbox must stay legibly square against a radio's capsule, which is why it has its own radius and not the control's |
| `glyph` | 10px | Glyph containers (28–34px squares behind an icon) |
| `control` | 14px | Buttons, fields, scope rows, countdowns, segments |
| `inset` | 16px | Inset notes inside a card |
| `card` | 22px | Every card and panel. 20–22px internal padding |
| `sheet` | 28px | Sheet top corners |
| `capsule` | 999px | Chips, radios, switch tracks, compact in-card actions |

Capsules are limited to chips, state badges, radios, switches and compact in-card
actions. A capsule never carries a full-width primary action.

**Iconography: Phosphor, Light weight (300), 24px default inside a 44px target.**
Fill weight only for a selected navigation item. Never mix in another icon family.

The sanctioned subset:

```
Structure   grid-four  paper-plane-tilt  sparkle  user-circle  caret-left
            caret-right  caret-down  arrow-down  arrows-left-right
Buckets     first-aid-kit  moon  person-simple-walk  pill  book-open
State       check  check-circle  x-circle  lock-simple  fingerprint
            calendar-blank  shield-check  link-simple  cloud-slash
```

`paper-plane-tilt`, `fingerprint`, `link-simple` and `calendar-blank` are
HealthSend's additions to the parent kit — send, device-bound, link mode, and the
date that ends it.

---

## Components

### Countdown — the one primitive this product invented

A 56px row at `control` radius on `surface` with a `hairline` border. A 30px glyph
container at `glyph` radius holds `calendar-blank`; the state word sits above the
date at 10/600/+1.3 tracking; the remaining figure is right-aligned in tabular
numerals. Over media it moves to the Inputs glass tier and its type flips white.

| State | Container / glyph | Word | Date | Remaining |
|---|---|---|---|---|
| Active | `haze` / `navy` | `ACTIVE` in `navy` | `ink` | `muted` |
| Ending soon (≤7 days) | `chalk` / `umber` | `ENDING SOON` in `umber` | `ink` | `umber` |
| Ended | `grouped` / `muted`, `lock-simple` | `EXPIRED` in `muted` | `muted` | "Access ended" |

Rules:

- The figure comes from the real share window. **Never a client-side timer counting
  against a stored date** — if the number can drift from what actually governs
  access, the product's central claim becomes decoration.
- **Never a progress bar, ring or depleting meter.** A draining gauge reads as a
  resource someone could top up. This is a date, and dates are read, not filled.
- Days down to 48 hours, then hours. Never minutes or seconds — except the demo
  clock, which is labelled a demo control and lives outside the component.
- **Never red.** The state word changes with the colour, every time.
- Ended is a state of the **whole surface**, not a badge on a live one. When a share
  lapses, the recipient page *becomes* the ended page; the data never renders behind
  an overlay, a blur or a notice.

### Scope row — an accordion with three tick states

The scoping screen is the product, so this is the component that matters most. A
64px header row at `control` radius: checkbox, 32px glyph container, label over
meta, a count pill, and a caret. Opening it reveals per-item rows or a date range on
a `canvas` inset.

| Box | State | The row reads | How it happens |
|---|---|---|---|
| Empty, `silver` border | **Nothing** | `hairline` border, 500 label, no pill | Untouched. All six groups start here |
| `ink` + white check | **Everything** | `ink` 1.5px border, 600 label, an "All" pill | One tap on the header. The fast path, and always enough |
| `ink` + white dash | **Some of it** | `ink` 1.5px border, 600 label, a counting pill: "1 of 4", "84 nights" | Ticking items inside, or narrowing the dates |

Rules:

- **Nothing is pre-selected.** A pre-ticked form makes sharing everything the path of
  least resistance, which is the behaviour this product exists to replace.
- Selection is three signals — **`ink` outline + a checkmark + a weight change** — so
  a ticked group survives greyscale and colour-blindness.
- **The big tick stays one tap.** Granularity is progressive disclosure behind a
  caret, never a step everyone walks through.
- The header follows its children. It is never a third thing to set.
- **Dates offer presets *and* an explicit From/To.** Presets are shortcuts, not the
  whole control — people think in "since I changed the dose", not "last three
  months", and a lab result belongs to a day. This applies to **every** window
  control in the product, including the assistant's *For how long* — a fixed
  interval alone is never the whole answer.
- **A group whose contents are different kinds of thing lists them.** Wearables
  opens to per-metric ticks — sleep, training, heart rate, steps, body weight —
  above a single range that applies to whichever are ticked. One range for the group,
  not one per metric; the echo line then reads for all of them at once.
- Every narrowing is **echoed in words** directly beneath the control: *"84 nights
  included · everything before 12 June stays out."* The user never infers what a
  control did.
- The header pill is the receipt, and it is the same string that later appears on the
  share in Your shares.
- Items inside a group are listed **by date, newest first**, with what they are
  beside them. A blood panel is chosen by when it was taken, not by an id.
- **Identity never opens.** No caret, no children, no range: `disabled` fill, a
  locked checkbox, a "Stays with you" pill, and its own copy.

**The groups are five, not the brief's six.** §5.1 lists *labs, sleep, training,
medications, notes* + identity. Sleep and training are merged into **Wearables**,
because they arrive from the same device in one import and a person choosing what to
send thinks "my watch data", not "two of my five groups". The granularity is not lost —
it moves one level down, into the per-metric ticks inside the group, where it also
covers heart rate, steps and weight. Recorded as a deliberate divergence: the archive
reads **Blood panels · Wearables · Medications · Notes** + Identity. A sixth,
*Documents*, is the natural home for the letters and reports on screen 1.3 and is
marked *Later*. Never rendered at
  reduced opacity and never simply absent — the row has to be visible for the user
  to understand that identifiers were already separated at import.

### Share state chip

Capsule, 28px, at `capsule` radius, with a 13px Light glyph. Six states, fixed
vocabulary, written in the words the user reads — plus one that is deliberately
not a state of the share at all:

| Chip | Fill / type | Glyph | Means |
|---|---|---|---|
| Not opened yet | `grouped` / `secondary` | `user-circle` | Nobody has opened the link |
| Active | `haze` / `navy` | `check-circle` | Opened, and inside its window |
| On their device | `sage` / `moss` | `fingerprint` | Tied to the phone that opened it first |
| Ending soon | `chalk` / `umber` | `calendar-blank` | A week or less to go. Nothing to renew |
| Ended | `grouped` / `muted` | `lock-simple` | Past the date. Nothing left to open |
| Ended by you | `surface` / `error`, `error` border | `x-circle` | The only state a person's action produces |
| Temporarily unavailable | `surface` / `secondary`, `hairline` border | `cloud-slash` | **Not a stage.** The holder could not be reached; the grant is still live |

The seventh is drawn unfilled precisely so it does not join the set. A share moves
through the six; the seventh is our infrastructure failing while the share is
perfectly healthy, and the two say opposite things about the sender's intention.
Rendering it as `Ended` tells the reader their window closed when it did not.

### Action

One component drives every button. Full-width controls use `control` radius and a
**52px** minimum height; compact and informational controls drop to a **44px**
minimum target. Pressed controls scale to `0.98`.

| Variant | Treatment |
|---|---|
| Primary | `ink` fill, white label |
| Secondary | `surface` or `canvas`, `ink` label, `hairline` border |
| Informational | `haze` with `navy`, for go-deeper. `haze-strong` on press |
| Tertiary | Plain `ink` text on a 44px target — no fill, no border |
| Destructive | `surface` with `error` text and `x-circle`, until a dedicated confirmation step |
| Disabled | `disabled` fill with `secondary` label — **state is carried by fill and copy, never opacity alone** |

Never a full red card, a broad red background, or a decorative red rail.

### Field

Label at 15/600 `ink`, a 54px input at `control` radius on the Control elevation with
a 17px value, and **one reserved assistive row** beneath. Placeholders use
`secondary`, never `muted`. Focus is an `ink` outline — no glow, no colour shift.
Confirmed adds `moss` plus a checkmark, never colour alone.

### Segmented control

A 40px capsule on the `grouped` track. The selected segment lifts to `surface` on the
Control elevation at 600 weight. Used for date presets and share windows. Where a
custom option exists it is the **last** segment and reveals From/To fields below.

### Switch row

Label over a 13px `secondary` hint, with a 50×30 capsule track: `ink` when on,
`disabled` when off, and a 24px white knob.

### Card

`surface`, `card` radius, 20–22px padding, Card elevation. A plain-language headline
always leads; supporting copy is one line beneath. Repeated cards stay white and
never get a tint. Depth is on demand.

### Focus surface

At most one per screen, and only where the screen genuinely has a headline status to
report. The `grad-focus` gradient at `card` radius with a `#FFFFFF1A` border and Focus
elevation. Eyebrow in `haze-strong`, headline in `surface` white at Headline size,
supporting copy in `#E4E5E7`, and a flat `panel-on-dark` strip holding the figures.
Used on the archive (status) and the ended page (the whole surface).

### Data cards — the recipient's readings

The recipient page is three card types and nothing else:

- **Chart card.** Title row (glyph container + title, meta right), a bar chart, a
  sparse axis row, then a `grouped` stat strip of two or three figures. Bars are
  `navy`, with `haze-strong` for values under the threshold — so a bad night is
  legible by lightness, not only by height. 14 bars on desktop with three axis labels
  spaced `space_between`; 7 bars with day letters on a phone.
- **Progress rows.** For training: a week label with its figures right-aligned, over
  an 8px `grouped` track filled `navy`. Never a pie, never a radial.
- **Biomarker table.** Marker, result, unit, **lab reference range**, and a flag chip.
  The range is not optional — it is what replaces the original PDF (see Decisions).
  `sage`/`moss` for in range, `chalk`/`umber` for out of range. **Never `error` red:**
  an out-of-range marker is a clinical finding, not an application failure. A footnote
  states how many of the panel's markers were shared and that the values are the
  laboratory's own.

### Charts

One hue, four forms, and **the form follows the range** — never a third control asking
the reader to pick a chart type.

**The only data ramp is sequential navy.** `navy-900` `#1F2A44` → `navy-700` `#4A5B7D`
→ `navy-500` `#8595AF` → `navy-300` `#C3CEDD`, with `grouped` for zero. There is no
categorical palette: a comparison to a previous period is the *same* navy drawn as an
outline. A quiet product does not get a second data hue for free.

Validated rather than eyeballed — CVD separation passes at ΔE 17.9 (worst adjacent
pair), lightness is monotonic. **One binding finding: `navy-500` (2.93:1) and
`navy-300` (1.54:1) fall under 3:1 against paper**, which obligates visible labels.
That is why every stacked chart's legend carries values (`Deep 1h 21m · Light 2h 48m ·
REM 2h 49m`) — fill alone is not readable there, and no amount of taste fixes it.

| The job | Form | When |
|---|---|---|
| A value each day | **Bar** | Up to 31 points. The default, and the only form on the recipient's page |
| A value over months | **Weekly / monthly bars** | Above 31 points — 90 hairlines is not a chart. Say the aggregation in the axis label |
| What something is made of | **Stacked bar** | 3–4 segments, 2px gaps, values in the legend |
| When something happened | **Floating bar** | Time in bed, session start/end. Time axis, not magnitude |
| How often it hit a mark | **Cell grid** | Consistency across weeks. One row per week, scale legend plus the count in words |
| A value against a range | **Threshold bar** | A biomarker against its lab range — position carries in-range, the status chip stays |
| One number | **Stat tile, no plot** | Most headline figures are not charts |

Rules for every chart:

- **Never two y-scales.** Two measures of different size are two charts, or one indexed
  to a common base.
- **The target line is drawn, not implied.** Colour splits at the threshold *and* a
  hairline marks it, so "under target" survives greyscale.
- **Range and metric are two controls; form is derived.** Range: 7 nights · 28 nights ·
  3 months · 2 years · Custom. Metric: Duration · Efficiency · Time in bed · Stages.
- Axes labelled at their ends and at most three points between, `muted` at 11px. No
  gridline behind every bar.
- **Values wear text tokens, never the series colour.** A swatch beside a number
  carries identity.
- **Scale to the plot before you draw.** The first version of the stages chart summed
  to 185px inside a 130px plot and overran its own title.

**Where exploration belongs.** The rich surface (screen L) is the *sender's* — she owns
the data. The recipient keeps the bar and the threshold bar only: §10 puts recipient
dashboards on the cut list, and that still holds. Screen L is post-hackathon.

### Where the extracted values actually live

Worth stating plainly, because "we have no database" is easy to misread as "the numbers
are nowhere."

A parsed panel — `Ferritin 38 µg/L, range 15–300` — is **encrypted in the browser and
stored as a bucket blob on Swarm**, with a manifest feed owned by the user's identity
pointing at the current blobs (§5.4). The values are plaintext in exactly two places:
her browser while she is looking at them, and the local app's memory while her
assistant is asking. Nowhere else, and on no server we run.

Three rules follow, and the first is the one that could quietly destroy the product:

- **No value ever becomes an Arkiv attribute.** Arkiv's indexed attributes are
  *publicly queryable* (§6). A convenience index like `marker=ferritin, value=38` would
  publish the thing the entire architecture exists to protect. Sensitive attributes are
  HMAC'd; only timestamps stay plaintext, for ordering.
- **Filtering happens after decryption, in the client.** There is no server-side query
  layer, so "ferritin over two years" means fetching and opening the relevant blobs
  locally. Fine at fixture scale; it is the honest scaling limit.
- **Chunk blobs by period, not by bucket.** This has a direct UI consequence: screen
  L's range control (7 nights → 2 years) is cheap only if a 28-night view opens one or
  two monthly chunks instead of the whole history. If the archive is one blob per
  bucket, the longest range becomes the slowest, and the control will feel broken
  precisely where it is most impressive.

This is also why the remote-connector question never turned on storage. The values were
always stored; encrypted storage is not the risk. The change remote would introduce is a
**decryption capability sitting with us** — a different thing entirely.

### Adding data — ask what it is first

The kind of thing being added determines the parser, the destination group, and
**whether a review step exists at all**. So the picker comes before the drop zone, not
after it.

| Kind | Input | What follows |
|---|---|---|
| Lab or test result | A file | Parsed → **Check what we read** (H) |
| Wearable export | A file | Parsed → H, split across sleep / training |
| A letter or report | A file | Stored as written, with its date and author. Nothing read out of it |
| Medications | You type it | **No review step** |
| Your health history | A questionnaire, ~10 min | **No review step** |
| Notes | You type it | **No review step** |

The asymmetry is the point: **anything the user typed skips *Check what we read*,
because there is nothing to have misread.** Sending a typed answer through a
verification screen would teach people that the screen is a formality, which is exactly
what it must never become.

Two rules for the picker:

- **Never show an unavailable source as available.** Sources that do not work yet carry
  a `Later` pill on a `grouped` card and cannot be tapped. Discovering a dead end on the
  first screen is worse than a short list.
- **Each card says what happens next**, under a rule: *"We read the markers and their
  ranges, then show you what we read"* versus *"You type these in, so there is nothing
  to check afterwards."*

The health-history questionnaire is the one input with no file behind it and no parse
to verify — which makes it the most trustworthy data in the archive and the only kind
that can be added on a phone with no computer nearby. It is specced, not drawn.

### Removing data — the sharpest screen in the product

Deleting from the archive collides with a fact the rest of the product works hard to
keep quiet: **a share is a scoped copy, made at the moment you sent it** (§5.4, "sends
are snapshots"). So removing a panel from the archive stops it appearing in anything
*new* — and does nothing to the copies already out there.

Hiding that would be the single most dishonest thing this product could do. The sheet
therefore does four things in order:

1. **Names what goes**, including the source file: *"32 markers, and the file it came
   from."* Deleting readings while silently keeping the PDF would be a lie by omission.
2. **Says who can still see it**, in `chalk`/`umber`, with each share named and its end
   date: *"The two shares below were each given their own copy when you made them, so
   they keep it until they end — unless you end them now."*
3. **Offers the fix as a ticked default** — *"End both shares now, so nobody keeps it."*
   Checked by default, because someone deleting data almost certainly means it, and the
   product's bias is toward less access. It stays a checkbox rather than an
   automatic consequence, because ending a share is visible to another person.
4. **Refuses to overclaim.** *"Elena opened this panel on 14 September. Ending her
   access stops anything further — it cannot un-read what she has already seen, and we
   will not pretend it can."* This is §9's retrieval-versus-disclosure distinction, in
   the one place a user will actually feel it.

Layout rules: destructive action is an **outlined** `error` button, never filled — a
filled red button invites the reflex tap. The safe action (*Keep it*) takes the `ink`
fill, so the visually dominant control is the harmless one. No undo is promised, and
the footnote says so.

### Growth hook

One quiet invitation at the foot of the recipient page: `grouped` fill at `card`
radius, a `haze` glyph container, a 15/600 question, one line of `secondary`
explanation, and a **secondary** action — never primary, never `ink`-filled. It has to
be ignorable, because the recipient came to read a lab result and not to sign up. The
copy must say that nothing she just read follows her into her own archive.

### Provenance — the import review row

Because a share carries readings and not the file, every reading has to earn its place
at import. The review row is the component that does it, and it has one job: put the
parsed value **next to the raw text it came from** so a mistake is visible without
opening anything.

A 66px row: name over a plain-language description on the left, the parsed value in a
44px editable cell, the **source snippet** in a `grouped` pill at 12.5px with slightly
open tracking, and a flag chip.

| Flag | Fill / type | Glyph | Means |
|---|---|---|---|
| Matches | `sage` / `moss` | `check-circle` | Value and unit both found in the file, unambiguous |
| Check the unit | `chalk` / `umber` | `x-circle` | Read a number with no unit beside it |
| Check the maths | `chalk` / `umber` | `x-circle` | Converted between units — the original figure is in the snippet |
| Confirm the date | `chalk` / `umber` | `x-circle` | Ambiguous date order, e.g. `12/08/26` |

Rules:

- **Never `error` red.** A low-confidence parse is a question, not a failure — and red
  is spent on "End access now".
- Flagged rows sort to the top, and the default filter is *Needs a look*, not *All*.
  Nobody scrolls 32 markers to find three problems.
- The flagged reason sits **under the snippet**, in `umber`, in a few words:
  "Converted from ng/mL", "Read day-first". Say what happened, not what to do.
- A unit conversion always shows the original figure in the snippet. `54 nmol/L` from
  `21.6 ng/mL` is only checkable if both numbers are on screen.
- The summary bar states the split plainly — "29 of 32 read cleanly · 3 need a look" —
  with the shortfall in `umber`. Never a percentage, never a confidence score.
- The primary action names the judgement she is making: *"Looks right — add to
  archive"*, not "Continue". Nothing is shareable until she does.

**Edited values must stay distinguishable.** If she corrects a parsed value, the
reading is no longer "as reported by the laboratory" and the recipient has to be able
to tell. An edited reading carries a small `chalk`/`umber` **Edited** marker in the
recipient's table, and the card footnote changes from *"Values as reported by the
issuing laboratory"* to *"Values as reported by the issuing laboratory, except where
marked."* This is the one place where honesty costs a little visual noise and gets it
anyway.

### Assistant connection state

The assistant is a third recipient type, so it reuses the share card, the state chips
and the Countdown unchanged. It needs one thing no other recipient does: a visible
answer to *"is this still current?"*, because two halves of it behave oppositely.

- **Scope and window are live.** The local connector polls the grant registry, so a
  scope change or a new end date reaches it within a minute. Pairing happens **once
  per machine, ever** — never on a scope change. Any design that asks the user to
  re-pair to widen a scope has broken the promise the flow is selling.
- **The connector build is not.** A sideloaded bundle has no update channel, so a new
  version means downloading and opening it again. The UI owns telling them: a version
  row with `sage`/`moss` **Up to date** or `chalk`/`umber` **Update available**, and a
  reassurance that the connection and dates survive the reinstall.

Render these as two adjacent cards, deliberately parallel and deliberately opposite —
a `sage` glyph for the half that looks after itself, a `chalk` glyph for the half that
does not. Never bury the distinction in a paragraph; it is the one thing a user will
get wrong.

**Three connector states**, all documented on Sheet 0:

| State | Fill / type | When | What she must do |
|---|---|---|---|
| Up to date | `sage` / `moss`, `check-circle` | Current build, understands every group pointed at it | Nothing |
| Update available | `chalk` / `umber`, `arrow-down` | A newer build exists; the current one keeps working | Download and open it when convenient |
| Older than this share | `chalk` / `umber`, `x-circle` | A share includes a group this build cannot read yet | Update to include the skipped groups |

Rules that follow, and the first is an architecture constraint the design depends on:

- **Re-installing must never re-pair.** The connector's keypair lives in the user's app
  data, *outside* the bundle, so an update replaces code and nothing else. Get this
  wrong and every release costs every user a re-pair — the worst outcome available.
- **Prefer a new share over a new build.** Because the tool surface is generated from
  the grant, a capability that can be expressed as a scope the connector already
  renders ships as a *share*, and nobody downloads anything. Keep the bundle a thin,
  generic renderer — crypto, a fetch-aggregate-summarise pipeline, and a tool
  generator driven by the grant — not six hardcoded tools. The thinner it is, the
  rarer a re-download becomes.
- **An unknown group is skipped and named, never fatal.** The connector reads what it
  understands and the interface says which groups it could not, by name, on the share.
- **An update is never blocking and never a modal.** A state on a version row, at most
  a dot on the rail item. Nobody is locked out of a working connection for a nicety.
- **The update prompt says what survives it** — connection, scope, dates — because the
  fear it has to answer is losing the thing that already works.

### Installing it — a flow we only half control

The hardest thing about the install is that **most of it happens outside our UI.** We
own the web page and the connector's own window. We do not own the browser's download
shelf, the Finder, or the assistant's install dialog. Two consequences shape the
design:

**The page waits, and says it is waiting.** There is no way to detect an install from
a browser, so the page cannot auto-advance. What it *can* do is make the state of each
step legible: step 1 **done** (`ink` circle, white check), step 2 **active** (`ink`
1.5px ring, plus a `haze` "Do this now" pill), step 3 **waiting** (`grouped` circle,
`muted` number, a "Waiting" pill) with the code boxes already on screen and the first
one focused. The code is the completion signal for everything before it, so it is the
only input on the page.

- Name the artefact and where it went: *"healthsend-connector.mcpb · 1.2 MB. Look in
  your Downloads folder if your browser did not show it."* Never "your download has
  started".
- Say plainly which dialog is not ours: *"that dialog is its own, not ours, and it
  only appears once."* A confirmation prompt nobody warned them about is where trust
  in an install flow dies.
- Keep *Download again* present and quiet. The most common failure is a lost file.

**The connector's own window is a designed surface, not an afterthought.** It is the
one place the user is most lost, and it carries the code. Draw it as an app window —
title bar with three `silver` dots, centred name — so it reads as a running program
rather than another web page. Inside: a `sage` confirmation glyph, "Running on this
machine", the code at 26/700 with +4 tracking on a `grouped` field, and one line
telling them they may close it: *"You can close this window afterwards. The connector
keeps running."* Without that line people leave a window open for twelve weeks, or
close it and assume they broke something.

**An escape hatch, always visible, never a modal.** Three named failures with one line
each — the file will not open, no dialog appeared, this is a work laptop — because §11
lists org extension policy as a real risk and "a personal laptop will work" is the
actual mitigation. It ends with the most important sentence on the page: *"You can skip
this entirely — your shares to people work without it."* The assistant is an addition,
never a gate, and a user stuck at step 2 must never believe the product is unusable.

### Writing instructions

Setup is the only place this product asks somebody to leave the page and act in
another application, and the only place a non-technical person can get properly stuck.
The stuck ones do not write in — they close the tab. Nine rules, all applied on screen
I:

| The rule | Not this | This |
|---|---|---|
| **One action per step** | "Download the connector and open it" | Two steps, numbered separately |
| **Name the file as they will see it** | "Open the .mcpb file" | "A file called HealthSend — it may appear as HealthSend.mcpb" |
| **Say whose software is speaking** | "Confirm the installation" | "Claude Desktop asks whether to add HealthSend — that prompt comes from Claude, not from us" |
| **End every step with success** | *(nothing)* | "You will know it worked when a small HealthSend window appears with a code in it" |
| **Recovery beside the step** | "See our help centre" | "Nothing happening?" — three named failures, in the panel |
| **Numbers, not vagueness** | "a short code, in a moment" | "six characters · about a minute · lasts fifteen minutes" |
| **Never a word they must look up** | MCP, server, stdio, manifest, bundle, localhost, JSON, **connector** | the app, the file, the window, the code |
| **Name the escape, once** | *(nothing)* | "You can skip all of this. Sharing with people works without it." |
| **Never imply they got it wrong** | "If you followed the steps correctly…" | "Double-clicking did nothing" |

Why these specifically:

- **File extensions are hidden by default** on most machines, so leading with `.mcpb`
  describes something the reader cannot see. Name it, then mention the extension as an
  alternative spelling.
- **A third-party prompt reads as ours the moment it goes wrong.** Naming Claude as its
  author before it appears is the difference between "this is normal" and "something
  is wrong with HealthSend".
- **The success line is the highest-value sentence in the flow.** The most common
  reason people stall is not failure — it is not knowing whether what is on screen is
  the right thing. `moss` for a completed step, `navy` for the one in progress.
- **Recovery must sit beside the step.** Somebody stuck at step two will not go looking
  for a FAQ.
- The technical variant (screen J, with the JSON block) is the **only** place jargon is
  allowed, because its reader has already self-selected by looking for it.

### The paste fallback, and why it is fenced

For assistants that cannot run a local connector, the fallback is **not an export.**
Copy-paste into a chat window is the exact behaviour §1 and §3 build the product
against — *"pasting a thyroid panel into a chat feels irreversible"* is the persona's
stated reason for never doing it. Shipping a Download-your-data button would hand the
user the thing they came here to stop doing, with our name on it.

What ships instead is narrow and honest:

- **Aggregates in prose, never rows.** The same shape the connector's tools return —
  "6h 12m average against a 7h 30m need, 4 nights over 7h" — and never individual
  readings. Small enough to read in full before pasting, because reading it *is* the
  consent moment.
- **Already de-identified**, and it says so in the copied text itself, so the property
  travels with the paste.
- **It states that it does not expire.** This is the only surface in the product that
  says so, and it must say it in `chalk`/`umber` at the same weight as the copy action:
  *"Everything else here stops on a date. A paste does not."* Never `error` red — this
  is a consequence to understand, not a failure — and never a checkbox to dismiss.
- **It ends by pointing back at the connector**, in `navy`, as the option that expires.
- **It is never the primary path**, never sits beside the share flow, and is
  **sender-only**. Recipients get no export of any kind; that is already a preflight
  rule.

The reasoning to hold onto: withholding this entirely does not stop anyone — they can
screenshot a chart and paste that, with identifiers and all. What the product can
usefully do is offer the *least harmful* version of an act the user will otherwise
improvise, and be blunt about what it costs. That is a different thing from endorsing
it.

### Can the recipient connect her own assistant?

**Not today, and not without the sender's explicit permission.** §14 files this as *"the
recipient's own agent — the genuinely unsolved version."* The interesting part is that
it is unsolved for *consent* reasons, not technical ones. It would be almost free to
build: the same local app, holding the recipient's key instead of the sender's, reading
the scoped copy from Swarm.

**What does *not* break, and it is most of the list.** Expiry applies to the recipient's
app exactly as it applies to the sender's — same grant, same date, same inability to
decrypt afterwards. And because *we* build the app, the tool surface is aggregate-first
by construction (§5.3): the assistant can ask for "average sleep over four weeks" and
there is no tool that returns the underlying nights. An assistant that can only obtain
summaries is not an export pipe. Those two properties together answer most of the
obvious objection.

**What actually remains is governance, not leakage:**

1. **The person bearing the risk is not the person operating the machine.** Giulia's app
   decrypts Giulia's data on Giulia's laptop. The recipient's app decrypts *Giulia's*
   data on *Elena's* laptop, under Elena's choice of vendor and Elena's security
   habits. This is the asymmetry §14 means by "the genuinely unsolved version" — and it
   is a consent problem, not a cryptographic one.
2. **The sender's log stops meaning what it says.** "Opened 9 times" would no longer
   distinguish *Elena read this* from *Elena's assistant read all of it and summarised
   it into a third party's storage*.
3. **The scope was a person, not their tooling.** Giulia chose to show Elena. She did not
   choose to show whichever assistant vendor Elena happens to use.
4. **Summaries still persist past expiry.** §9's retrieval-versus-disclosure caveat is
   unchanged — but it now applies to a party the sender never chose. Aggregate-first
   shrinks what persists; it does not decide who gets to hold it.

**If it is ever built, the shape is already determined by those four:**

- A switch on the send screen — *"Let them use their own assistant"* — **off by default**,
  sitting with the link-mode choice, because it is a security property and belongs where
  the other one is.
- When off, the recipient's page says so plainly rather than hiding the possibility:
  *"This one is for reading. Giulia hasn't allowed an assistant to read it."*
- When on, the access log distinguishes the two kinds of read by name, and the share card
  carries a mark — Giulia must be able to see at a glance which of her shares are machine-readable.
- Expiry and aggregate-first apply unchanged, and are load-bearing: the recipient's app
  must ship the same summary-only tool surface. A raw-row tool on the recipient side
  turns every objection above back on.

Not drawn, deliberately — adding the switch to screen B would imply it ships this
weekend. But the gap is narrower than "unsolved" suggests: with the switch, a
distinguishable log and aggregate-first enforced, this is a **buildable
post-hackathon feature**, not a research problem. The research problem is only the
part nobody can design around — that decryption happens on a machine the data's owner
does not control.

### Why the connector is local, and not a remote endpoint

This heading records the old decision so the reversal stays visible. The connector is
now a remote MCP endpoint.

The original objection assumed that there was no HealthSend gatekeeper. Under that
premise, a remote endpoint had to be the recipient of the whole encrypted archive. It
would keep the private key that opened the archive for the full consent window. A
compelled or compromised server could then read more than the user selected. That was
a sound objection to that design.

The split-key holder invalidated the premise. HealthSend already has a server-side
gatekeeper that asks Arkiv whether a grant still exists before it completes an unlock.
The product no longer rests on the claim that no HealthSend service can refuse access.
The relevant question is now what a service receives and how far its power reaches.

The remote MCP receives only a slice made in the browser. The browser opens the archive,
selects the allowed records and sends no archive key and no route back to the archive.
The endpoint stores the slice under a fresh per-grant encryption key. The store contains
ciphertext; the bearer capability carries or derives the key. The endpoint decrypts
separately for each request and does not persist that key.

The browser signs once at consent with the existing `signedMessage` scheme and the
`mcp` action. That signed request mints the bearer capability and pairing code. This is
not OAuth. The capability cannot extend the Arkiv grant. Before every tool response,
the endpoint asks Arkiv whether the grant still exists. If Arkiv says it does not, the
endpoint serves nothing. If Arkiv cannot answer, the endpoint also serves nothing.
Every tool call is checked against the scoped records, and an out-of-scope request is
refused rather than represented as an empty result.

The assistant receives a per-grant pseudonym, not the sender's stable derived address.
The assistant is never told whose numbers these are. This sentence is deliberately
narrower than a claim that identity can never be inferred from the records or from a
conversation.

**The remaining exposure is real.** A running endpoint must see one active grant's
scoped slice while it answers. A stolen bearer capability can open that same slice
until Arkiv expires the grant. A compelled or compromised running service can see it
during that window. The boundary is one grant's selected records and Arkiv expiry, not
the whole archive and not an indefinite server-held key. A dump of the store alone has
ciphertext without the nearby key needed to read it.

Anything the assistant writes into its own conversation history can remain on that
assistant company's systems after the grant ends. Expiry stops new reads; it cannot
remove an answer already returned. Screen 4.1 and the permission sheet state both facts
before consent.

The endpoint is internet-reachable, so it rate-limits capability and network sources,
caps request size and range width, and refuses when the abuse-control store is
unavailable. These controls reduce scraping and resource abuse. They do not turn a
bearer capability into an identity or remove the running-server exposure above.

### Top bar (recipient)

64px, `surface`, 1px `hairline` bottom. Wordmark left; scope chips and the countdown
right, separated by a 1px `hairline` divider. This is the only chrome the recipient
ever gets.

### Rail

264px, `surface`, 1px `hairline` right edge. Wordmark at the top (21/600, −0.5),
three destinations, a flexible spacer, the primary "New share" action, then the
account row. Selected item: `haze` fill, `navy` icon and label at 600, Fill-weight
icon. Three destinations only:

```
Your archive · Your shares · Your assistant
```

"Your assistant" is a **connection surface, not a chat.** It exists to hand a slice of
the archive to the assistant the user already has, for a set window. There is no
integrated conversation anywhere in this product.

### Access log

Rows inside the share card on a `canvas` fill: when (190px, `ink` 500), what
(`secondary`), where (`muted`). **An audit trail the sender owns, not analytics** — no
time-on-page, no scroll depth, no engagement heatmap, nothing the sender did not ask
to know.

---

## Do's and Don'ts

### Do

- Lead every card with a plain-language headline, then one line of why.
- Change a word whenever you change a colour.
- State the end date as a date, and repeat it in the reassurance line.
- Give the recipient less: fewer controls, no navigation, no account, no download.
- Use tabular numerals for anything that ticks.
- Echo in words what a control just did.
- Keep the fast path one tap; hide granularity behind a caret.

### Don't — reject or revise a screen when any of these is true

**Inherited from the parent kit**

- A warm neutral fills a button or a card, or carries a generic secondary action.
- Repeated cards are tinted, or cool and warm tints are stacked as decoration.
- Radii or shadows differ from the locked system; a surface carries shadow *and* blur.
- A resting icon is not Phosphor Light, or another icon family appears.
- Contrast, Dynamic Type, or 44px touch targets fail.
- The screen resembles a generic dashboard or a wellness moodboard.

**HealthSend's own**

- **A photograph appears anywhere.** No stock imagery, no illustration, no avatar
  photos. One gradient, at most once per screen.
- A backdrop blur is used over anything that is not scrolling content.
- More than one focus surface on a screen — or one on a screen that has no status to
  report.
- A download, save, export, print, copy-all or "view original PDF" control appears on
  the recipient page.
- A date of birth or provider reference appears anywhere on the recipient page next
  to a *parsed* reading, or a surname sits in the same block as one. (A PDF the
  sender chose to share is the deliberate exception, reversed 2026-09-12 — see
  "Original files and PDFs" below.)
- Any group is pre-ticked on the send screen.
- Expiry is drawn as a progress bar, ring or depleting meter.
- A countdown runs on a stored date rather than the real window.
- The words *anonymous, secure, encrypted, key, grant* or *ciphertext* appear in a
  user-facing string.
- Red appears anywhere other than "End access now" — an out-of-range marker uses the
  warm flag, not `error`.
- An ended page renders the data behind an overlay, a blur or a notice.
- The access log shows time-on-page, scroll depth, or anything the sender did not ask
  to know.
- A human share offers renew, extend or top up.
- The assistant path shows raw rows where a summary would do.
- The recipient page offers navigation, account controls, or any route into the
  sender's archive. The single *Create your archive* invitation is the one exception,
  and it is a secondary action below the readings.
- The desktop and phone renderings of the same share disagree about what is in it.

---

## Words we use

The security story is the product, and the fastest way to lose it is to explain it.
Nobody outside the team wants to know about keys or storage protocols — they want to
know who can see their blood panel and until when. **Every user-facing string names
the consequence; the mechanism stays in the code.** This table is not a tone
preference, it is the interface.

| Instead of | We say | Why |
|---|---|---|
| Encrypted client-side | **Only you can open this** | She needs the answer to "who can read it", not where the maths happens |
| The decryption key is destroyed | **Access has ended** | Our proudest engineering fact is her least interesting one |
| Revoke access | **End access now** | Revoke is a permissions word from software she resents |
| Grant · entity · record | **Share** | One noun for the thing she made. A second noun means the model is wrong |
| Scoped copy · payload | **Only what you chose** | Names the reassurance, not the data structure |
| De-identified · anonymised | **Your name and date of birth stay with you** (a CSV or JSON record — a PDF goes out as issued, see "Original files and PDFs") | And never *anonymous*: health data re-identifies, so that is the one promise we would actually be breaking |
| The ciphertext becomes noise | **There is nothing left to open** | Same fact, no vocabulary lesson |
| Expires in 84 days | **Ends 4 December** | A date can be planned around; a duration has to be computed |
| Bearer link · anyone-with-link | **Anyone with the link can open it** | Say the risk in the sentence that offers the option |
| Claim on first open · device binding | **Lock it to their phone the first time they open it** | What happens, in the order it happens |
| Pairing code · MCP server | **Connect your assistant · Connection code** | She is connecting an assistant she already uses. The protocol is our problem |
| Connector · bundle · extension | **The HealthSend app**, then just *the app* | Connector is our word for our own plumbing. Nobody arrives knowing it, and a setup screen is the worst place to teach a noun. The downloaded file is named `HealthSend` for the same reason |
| Access log · audit trail | **When she looked** | Audit sounds like something done to her. This is a record she owns |
| Storage and index protocols | **Named once on an About row, never in a flow** | Credit where due, without making her learn two protocols to share a lab result |
| Bank-grade · military-grade · secure | **Describe the consequence instead** | Every product says secure. "Nobody can open it after the 4th" is checkable |
| You are protected from screenshots | **She can read it. She can't keep it.** | Never claim what cannot be enforced — a live recipient can always photograph a screen |

Two further rules:

- **Name the person, not the role**, wherever the sender named them. "Send it to
  Elena", not "Send it to the recipient".
- **Numbers over adjectives.** "84 nights" beats "a few months".

---

## Upload once, bundle per share

**Settled 2026-09-12 by the operator.** A person uploads a document **once**. It lands in their
archive, de-identified on the way in. Every share afterwards is a **bundle assembled out of that
archive** at the moment the link is created and authorised — never another upload.

This is the whole shape of the product, and it is worth writing down because the code currently
does the opposite. `createSend` maps browser `File` objects straight into the envelope: each send
re-uploads, nothing is de-identified, and the recipient receives the original bytes including
markers the sender did not select (review 2, R2-001). That is not a missing feature at the edge —
it is the model inverted.

What follows from it:

- **Import is the only write path.** Identifiers are set aside once, at import, and never travel.
  A de-identification step on the *way out* would be a filter, which is a weaker promise and a
  different one — see H-16, which chose the ordering deliberately.
- **A share is a scope, not a file list.** `scopeArchive` produces what the recipient gets. The
  send path selects records; it does not read the disk again.
- **"What's in it" describes a selection.** The Link ready summary row names what was scoped, and
  the recipient screen renders records, not documents. Both currently describe files because
  files are all there are.
- **Authorisation happens at bundle time.** The grant, the holder's half-key and — once H-22
  lands — the assistant's scoped slice are all minted against that one selection, at that one
  moment. There is no later step that can widen it.
- **Re-sharing the same panel to a second person costs nothing new.** Same archive record, second
  scope, second grant, second expiry. Today it would mean finding and uploading the file again.

Stories that carry this: **H-44** (the archive is never written or read), **H-36**
(de-identification never runs), **H-14 / H-23** (scope selection), **H-22** (the assistant is
served a scope).

## Decisions from the brief

Three questions the design keeps running into. The brief settles two; the third is a
judgement call, recorded here with its reasoning so it is not re-argued from scratch.

### Whose name appears on the recipient page

**Nobody's. The attribution line reads "Shared with you" and names no one.**
Settled 2026-09-12, superseding an earlier "first name only" rule recorded here.

The brief is firm that the *payload* carries no identifiers (§5.2 "no name, no date of
birth"; §8 identifiers are split off at import; the demo script's line 230 is
literally "data renders — no name on it"). It is equally firm that this is not
anonymity: §8 concedes "the nutritionist necessarily knows it's Giulia", and §9 warns
that a distinctive lab timeline re-identifies on its own.

That tension produced the earlier rule — a first name, on the reasoning that hiding it
protects nothing against a recipient who already knows who sent the link, while a
*surname* above a thyroid panel would destroy §8's stated benefit that "a leaked
screenshot is numbers without an owner, not a named panel."

The reasoning was sound and the premise was not: **this product has no name to print.**
Identity here is a passkey-derived Swarm ID. There is no profile, no first name, no
last name, nothing the sender ever typed — which is also why the sidebar avatar was
removed rather than restyled. Rendering any name would mean inventing a field, and a
fabricated one is worse than none.

That leaves one option that would have worked — a **"from" the sender types per send**
— and it is **declined for now** (2026-09-12). It buys human context at the cost of a
free-text field on the send path that is, by construction, unverified: whatever the
sender types is what the recipient trusts. A recipient who needs to know who sent a
link already knows, because a link arrives inside a conversation. Revisit only if a
real recipient reports being unable to tell.

So the line names nobody, and the leaked-screenshot property is stronger than either
alternative would have made it. It sits **outside** the data cards, because identity
binds at grant time and travels separately from the readings (§8) — the layout should
say so.

The sender is told plainly what this means: screen C's summary row reads *"What she
sees about you — No name, no date of birth."*

### Whether the recipient can become a sender

**Yes — one quiet invitation, below the readings.** §5.4 makes recipients full users
("a recipient who claims a send can later create her own archive under the same
passkey") and §14 names the recipient growth loop as the WeTransfer lesson. This
overrode an earlier, stricter rule of ours that banned any route out of the recipient
page; the ban now covers navigation and account chrome, not this one secondary action.

### Original files and PDFs

**Reversed for PDFs, 2026-09-12 — see docs/stories/H-62.md.** Everything below this
paragraph was the design until then, and it still holds for a blood panel or a
wearable export: those are parsed, and only the parsed readings ever reach a
recipient. The operator's decision for a PDF specifically is the opposite: **a PDF
goes to the recipient exactly as issued, rendered in place with no download
control, including any name or date of birth printed on it.** The reasoning below —
why the original was withheld, what it would cost to keep withholding it — is kept
as the record of why that took this long to reverse, not as a description of what
the build does today.

**Parsed readings only. No original PDF is shown, linked or downloadable.**

The brief never contemplates serving the source file: import is "parse → split
identifiers into their own bucket → encrypt → upload" (§5.1), what the recipient gets
is a read-only page with "no download button… She received access, not a file" (§5.2,
§10 step 5), and the whole product exists because "a nutritionist gets a PDF of your
labs that lives in her inbox forever" (§1). Shipping the PDF would reinstate the
problem.

The honest cost: a clinician sometimes wants the source report — the issuing lab, the
assay method, the footnotes. The mitigation is the **lab reference range column** on
the biomarker table plus a footnote naming the laboratory as the source of the values.
That carries the clinically load-bearing part of the PDF without handing over a file.
If this proves insufficient in testing, the next step is more metadata (lab name,
method, collection time) — **not** a download.

**"But the storage layer encrypts it, so why not just send the file?"** Because
encryption is not the reason we withhold it. Two reasons that survive any amount of
crypto:

1. **The original is not de-identified — it is the opposite.** A lab report has her
   name, date of birth, patient number and provider references *printed on it*. §8's
   whole design is that identifiers are split off at import so that "every share is
   de-identified as a structural consequence — no transform to remember." Attaching
   the source document re-attaches every identifier and turns de-identification back
   into a redaction chore, on arbitrary third-party PDFs, with metadata and embedded
   thumbnails to miss. That is the "transform to remember" the architecture exists to
   avoid.
2. **Encryption governs who can open it, not what happens next.** Once she opens an
   encrypted PDF she has a decrypted PDF: saveable, forwardable, printable, and living
   in her inbox after the window closes. Expiry only governs *future retrieval* (§9).
   A rendered page leaks screenshots; a file leaks the file — which is the exact
   opening complaint in §1, "a nutritionist gets a PDF of your labs that lives in her
   inbox forever."

Encryption is, however, precisely what makes it safe to **keep** the original: it sits
in the sender's archive encrypted, locked to her, never in scope. Same protection,
opposite conclusion.

*Where-next, not weekend:* a **redacted render** — the source page rasterised with
identifier regions removed, shown view-only with no download — would give a clinician
the lab's own layout and method notes without handing over a file. Reliable redaction
of arbitrary lab PDFs is real work, and §10 rules out general import work, so it is
explicitly out of scope.

**This decision has a price, and it is paid at import.** If the recipient never
sees the source, *the parse is the record*. A misread unit is no longer a cosmetic
bug — it is a wrong number in front of a clinician with no way to catch it. Two
consequences, both non-negotiable:

- **Import cannot be silent.** Every import passes through *Check what we read*
  (screen H) before anything becomes shareable. See Provenance below.
- **The source file is retained in the archive, locked to the sender.** It is treated
  exactly like the identity bucket: visible to her, never in scope, never shareable —
  so she can always go back and compare. Discarding it would leave nobody able to
  verify the parse, including her.

---

## Screen inventory

Thirty-five frames in `healthsend.pen`, below the design-system sheets. Laid out in
flow order — one horizontal band per stage — with **each screen's desktop and mobile
version side by side**, `d` then `m`.

**1 · Getting started**

| # | Screen | What it proves |
|---|---|---|
| 1.1 d/m | Landing | The only Persuade surface. Problem → three steps → the claim, with the honest limit stated on the page |
| 1.2 d/m | Sign in | Passkey, one tap, no password to lose |
| 1.3 d/m | What are you adding | The kind comes first — it decides the parser, the group, and whether a review step exists. Unavailable sources marked *Later* |
| 1.4 d/m | Check what we read | Import review: parsed value beside the raw text, three flagged rows, nothing shareable until confirmed |

**2 · Your archive and sending**

| # | Screen | What it proves |
|---|---|---|
| 2.1 d/m | Your archive | Five groups, per-group *Add*, one focus surface, identity visibly locked |
| 2.2 d/m | Wearables in detail | **Post-hackathon.** Metric picker, range control, 28-night bars with a target line, stacked stages, consistency grid |
| 2.3 d/m | New share | **The core screen.** Accordions, three tick states, per-metric ticks inside Wearables, custom date range |
| 2.4 | What her assistant can see · sheet | The permission explained before it is given, including the one thing it cannot undo |
| 2.5 d/m | Link ready | The WeTransfer moment: link, summary, what she will and won't see |
| 2.6 d/m | Your shares | Three live shares, three states, real countdowns, the access log, "End access now" |
| 2.7 | Remove data · sheet | Deletion against live shares: what goes, who still has it, end-them-too as a ticked default |

**3 · What the recipient sees**

| # | Screen | What it proves |
|---|---|---|
| 3.1 d/m | First open | The PIN and the claim, before any data renders |
| 3.2 d/m | What she opens | Attribution, charts, biomarkers with ranges, assistant offer, growth hook |
| 3.3 d/m | Temporarily unavailable | The holder could not be reached. Says so, and says the window has *not* closed |
| 3.4 d/m | After it ends | The payoff. The one page that inverts |

**3.3 is drawn in the ordinary light chrome on purpose.** 3.4 inverts because ending is
the payoff; if 3.3 borrowed any of that treatment it would read as the ending to anyone
skimming, which is the one thing it must never do. It is a live share that cannot load,
and it looks like one.

**4 · Your assistant**

| # | Screen | What it proves |
|---|---|---|
| 4.1 d/m | Your assistant · not connected | The consent screen: what it can and can't do, what it may read, for how long |
| 4.2 d | Connect your assistant | The install wait: stepped states with success lines, and an escape hatch |
| 4.2 m | Connect your assistant · mobile | **The one deliberate d/m divergence.** A phone cannot host the app, so it hands over the link, previews the three steps, and offers the paste fallback |
| 4.3 d/m | Assistant connected | The live state, and the split between what updates itself and what does not |
| 4.4 | Paste into a conversation · sheet | The fenced fallback: aggregates in prose, and the only surface that says it does not expire |

**Sheets have no separate mobile frame.** 2.4, 2.7 and 4.4 are one component: capped at
560 and centred on desktop, full-bleed and bottom-anchored on a phone. Drawing two of
each would invite them to drift apart.

**What changes between d and m structurally**: the 264px rail becomes the three-tab
bottom bar on `glass-raised`; two columns become one; Display drops 44 → 34; the inset
drops 48 → 20; tables become stacked rows (2.6, 1.4); and the send screen splits into
two steps with a fixed summary bar. The component vocabulary is identical throughout.

**Copy is abridged on mobile, deliberately, on almost every screen.** An earlier version
of this section claimed copy was identical and that any divergence was a bug. It was
measured on 2026-09-12 and it is not true: of eleven d/m pairs, **ten differ**. Only 3.4
*After it ends* matches exactly, and it is the shortest screen in the file at six
strings. 2.3 shares 11 strings of 60; 1.4 shares 19 of 50.

The abridgement is editing, not drift — *"It still has your panel. There was never a
moment where that access was supposed to end, so it did not."* becomes *"It still has
your panel. Nobody built a moment where that access ends."* Same claim, fewer words, on
a surface with less room.

So: **build each frame from its own strings.** Read the desktop and mobile `content`
fields separately; never paste desktop copy into a mobile layout and never assume they
match.

**The one thing abridgement may not do is weaken a claim about personal data.** Two
places in the file currently break this and should be fixed rather than blessed: 1.1's
mobile Problem section drops *"and date of birth"* from the de-identification promise,
and its Final section drops *"Signing in takes one tap and creates nothing we can read"*
entirely. Shortening prose is fine. A shorter promise is a different promise, and a
mobile reader is not owed less of one.

**One screen diverges structurally, and only because the platform does.**
4.2m cannot show what 4.2d shows: installing the app is something a laptop does, and
telling a phone user to double-click a file in their Downloads folder is an
instruction they cannot follow. So the phone hands the job to the computer and says
why. It remains the only place where a mobile screen *does something* its desktop twin
does not — which is a different matter from saying it in fewer words.

The three assistant screens divide cleanly and must not re-merge: **4.1** decides
*whether and what*, **4.2** handles *getting it running*, **4.3** shows *the live state*.

Design-system sheets in the same file:

- **Sheet 0 — HealthSend rules**: desktop shift, token map, expiry, share lifecycle,
  scope granularity, breakpoints, words we use, preflight.
- **Sheets 1–4** — Foundations, Controls and marks, Surfaces and forms, Chrome and
  composition: the inherited kit, unchanged.

---

## The demo dataset

Every figure on the canvas comes from one dataset. It is written down here because
the screens cross-check each other: an average on one screen is a count on another
and a sentence in the paste fallback. Change a number here, change it in all four
places or the demo contradicts itself in front of an audience.

**The clock.** Two moments, and only two:

| Moment | Date | Screens |
|---|---|---|
| The share is made | 11 September 2026 | 2.3, 2.5 |
| Now | 21 September 2026 | 2.1, 2.6, 2.7, 3.2, 4.1, 4.3 |

3.4 sits after everything has ended and reports the window in the past tense.

**What that makes true.** Elena ends 4 December (84 days at creation, 74 days left
now). Marco ends Sunday 20 September — 6 days, the soonest, which is what the archive
status surface says. The assistant connection runs 21 September to 5 October: fourteen
days, so it is *not* the soonest and the archive's "this Sunday" holds.

**Sleep, 28 nights, 7 August – 3 September 2026.** Hours per night:

```
6.9 5.4 6.6 5.8 7.1 6.0 5.2 6.8 6.3 5.6 7.2 5.9 6.5 5.5
7.7 4.9 7.6 5.1 6.4 5.3 7.8 4.7 6.1 5.8 7.6 5.0 6.2 6.6
```

Mean 6h 12m. Target 7h 30m. Four nights reach it. The second fortnight is the
window the recipient sees, and it has the same mean and the same four nights — that
is deliberate, so 2.2 ("4 of 28") and 3.2 ("4 / 14") can both be true.

Bars are placed on a 3h–9h axis, so a bar's pixel height is `(hours − 3) × (plot
height ÷ 6)`. The target line sits at `4.5 × (plot height ÷ 6)`. A bar at or over it
is `$navy-900`, under it `$navy-300`, and **the same two steps carry the legend** —
never a colour without a key.

**Stages** average Deep 1h 05m, Light 2h 51m, REM 2h 16m. They sum to 6h 12m,
because a reader will add them up.

**Training, same fortnight.** Week of 21 Aug: 4 sessions, 3h 10m. Week of 28 Aug:
2 sessions, 1h 25m. Totals 6 sessions, 4h 35m, −55% week on week (85 ÷ 190).

**The blood panel** is 32 markers taken 12 August 2026, of which 5 are shared and 3
were flagged at import. Every screen that counts them says 32, 5 and 3.

---

## Open questions

Not yet drafted, in rough priority order:

1. **The file drop itself.** The review step exists (1.4); what is still missing is
   the moment before it — drag a file in, watch it parse — and the moment identifiers
   are separated, which is where the de-identification promise is actually made.
2. **Where the source file lives in the archive.** DESIGN.md commits to retaining it,
   locked, so the parse stays checkable. 2.1 now shows five groups with Identity as
   the locked fifth; the retained file has no home in that grid yet. Options: a "Source
   files · 2" line under it, or a row inside the group the file produced.
3. **Re-checking a reading later.** The review happens once, at import. If she doubts
   a number in week six, the path back to the source is undesigned — probably a
   "compare with the file" action on the reading itself.
4. **First-run empty states.** Zero groups, zero shares, and the send screen with
   nothing ticked and the primary action correctly disabled. The "nothing
   pre-selected" rule makes the disabled state the *default* first experience, so it
   has to be good.
5. **The demo clock control.** "Wind the clock" is step 4 of the 90-second demo. It
   needs a home that is unmistakably a demo control and cannot be mistaken for a
   product feature.
6. **Offline and error states.** Venue wifi is a named risk. What the recipient page
   shows when the network is gone matters more than any other error in the product.
7. **Snapshot vs refresh.** Does the coach see data imported after the share was made?
   Whichever ships, one line of copy on the share card has to say so — it is the first
   question anyone actually imagining this asks.
8. **Chart accessibility beyond the legend.** Both sleep charts now carry a two-step
   legend, so identity is not colour-alone. Still missing: a text alternative — per-bar
   values on hover and a table view.
9. **A truncated bar baseline.** The sleep bars start at 3h, not zero. It reads well
   and it is conventional for sleep, but it is a knowing exception to the rule that bar
   length encodes magnitude from zero. If anyone screenshots a single bar out of
   context, it overstates the difference. Revisit if these charts ever leave the app.
10. **`3.3` does not exist.** The recipient band runs 3.1, 3.2, 3.4 — a gap left by a
    screen that was cut. Renumber before anyone treats the inventory as a checklist.
11. **The name.** "-Send" on a document-sharing product sits close to an existing mark.
    Fine for the weekend, worth revisiting before anything after it.
12. **Swarm and Arkiv in the footer.** The one place the product names its
    infrastructure. It is sponsor attribution and it reads as credibility rather than
    jargon, but it is a deliberate exception to the no-mechanism rule — keep it to the
    footer.

---

## What the verification pass found

Every frame was rendered at 2× and read, and every subtree checked for overflow. The
defects below were real and are fixed; they are recorded because they are the kinds
of thing that come back.

**Geometry.** Two target lines were drawn wider than their plots (1000px in 980,
400px in 368). Sleep bars in the recipient charts were taller than the plot that held
them — the tallest was 92px in a 76px box — so four bars were clipped at the top,
which silently flattened the very comparison the chart exists to make.

**Arithmetic.** The 28 bars averaged 7h 01m while every label beside them said
6h 12m, and 11 of them cleared a target the heatmap said 17 cleared. The stage
averages summed to 6h 58m. The training decline was rounded to −54% from a figure
that is −55%. All of it now derives from the one dataset above.

**State that contradicted itself.** The send screen counted three groups with two
ticked; a partially-ticked group wore a full tick instead of a dash; the archive said
"five groups" over four cards; "12 times opened" summed from 11; the assistant was
counted as a person. The PIN toggle was off on a share whose recipient is asked for a
four-digit code.

**Staleness after the Wearables merge.** The import screen still said sleep and
training "land in their own groups"; the mobile send screen wore a moon icon and
counted "2 of 3 wearables"; the archive card still read "sleep and heart rate".

**Mobile screens that quietly said less than their desktop twin.** The recipient page
dropped the training card and the assistant offer and showed 7 nights against the
desktop's 14 — the same share, two different windows. The Wearables detail showed
three metrics of five, no view picker and one chart of three. The shares list dropped
the ended section, the connected-assistant screen dropped its actions.

**One that was wrong rather than thin.** The mobile connect screen told a phone user
to find a file in Downloads and double-click it. A phone cannot host the app. It now
says so, hands over the link, previews the three steps, and offers the paste fallback.
