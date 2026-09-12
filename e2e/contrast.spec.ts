import { test, expect } from "@playwright/test"

/**
 * A regression guard for the exact bug H-27 found and H-40 fixed: a token
 * that flipped paired with one that did not, resolving to two near-identical
 * colours (near-black ink on a near-black surface, or the reverse). This is
 * a loose net, not a WCAG audit: the threshold is set to catch genuinely
 * invisible text, not to flag `secondary`/`muted`'s deliberately lower
 * contrast against paper.
 *
 * The app now has one palette, drawn in DESIGN.md, and no `@media
 * (prefers-color-scheme: dark)` block to switch it. `colorScheme: "dark"` is
 * still forced here on purpose: it is the regression case — if a dark token
 * block ever comes back, this proves the light palette held anyway, because
 * the OS asking for dark is exactly the condition that used to change these
 * colours and now must not.
 *
 * `/landing`, `/kitchen-sink` and `/chrome-preview` render with no network
 * dependency, so they need no route stubbing — unlike `recipient.spec.ts`.
 */
test.use({ colorScheme: "dark" })

const PAGES = ["/landing", "/kitchen-sink", "/chrome-preview"]

for (const path of PAGES) {
  test(`${path} has no near-invisible text with the OS set to dark`, async ({ page }) => {
    await page.goto(path)

    const offenders = await page.evaluate(() => {
      function parseColor(value: string) {
        const m = value.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/)
        if (!m) return null
        return { r: +m[1], g: +m[2], b: +m[3], a: m[4] !== undefined ? +m[4] : 1 }
      }

      /** Every opaque colour stop in a `linear-gradient(...)` background-image, resolved to rgb(a) by the browser already. */
      function parseGradientStops(value: string) {
        return Array.from(value.matchAll(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/g))
          .map((m) => ({ r: +m[1], g: +m[2], b: +m[3], a: m[4] !== undefined ? +m[4] : 1 }))
          .filter((c) => c.a > 0.5)
      }

      function relativeLuminance(r: number, g: number, b: number) {
        const [R, G, B] = [r, g, b].map((c) => {
          const channel = c / 255
          return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4)
        })
        return 0.2126 * R + 0.7152 * G + 0.0722 * B
      }

      function contrastRatio(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }) {
        const La = relativeLuminance(a.r, a.g, a.b)
        const Lb = relativeLuminance(b.r, b.g, b.b)
        const lighter = Math.max(La, Lb)
        const darker = Math.min(La, Lb)
        return (lighter + 0.05) / (darker + 0.05)
      }

      // Below this, foreground and background read as the same colour —
      // the failure mode named in the story, not a contrast-grade judgement.
      const NEAR_INVISIBLE = 1.5

      const found: { tag: string; text: string; color: string; backgroundColor: string; ratio: number }[] = []

      for (const el of Array.from(document.querySelectorAll("body *"))) {
        const ownsVisibleText = Array.from(el.childNodes).some(
          (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim().length > 0
        )
        if (!ownsVisibleText) continue

        const style = getComputedStyle(el)
        const fg = parseColor(style.color)
        if (!fg || fg.a === 0) continue

        let bgEl: Element | null = el
        let backgrounds: { r: number; g: number; b: number; a: number }[] | null = null
        while (bgEl) {
          const bgStyle = getComputedStyle(bgEl)
          if (bgStyle.backgroundImage !== "none") {
            // A gradient (the one fixed-dark focus surface, DESIGN.md "No
            // photography") still resolves to concrete colour stops the
            // browser has already computed — check against every stop
            // rather than skip, so text over it is not exempt from this
            // guard. A genuine image (`url(...)`) yields no stops and falls
            // through to the skip below, since a flat colour check cannot
            // judge contrast against a photo.
            backgrounds = parseGradientStops(bgStyle.backgroundImage)
            break
          }
          const candidate = parseColor(bgStyle.backgroundColor)
          if (candidate && candidate.a > 0.5) {
            backgrounds = [candidate]
            break
          }
          bgEl = bgEl.parentElement
        }
        if (!backgrounds || backgrounds.length === 0) continue

        // The worst-case stop, not an average — a foreground only has to be
        // near-invisible against one end of the gradient to be a real bug.
        const ratio = Math.min(...backgrounds.map((bg) => contrastRatio(fg, bg)))
        if (ratio < NEAR_INVISIBLE) {
          found.push({
            tag: el.tagName,
            text: (el.textContent ?? "").trim().slice(0, 60),
            color: style.color,
            backgroundColor: getComputedStyle(bgEl!).backgroundImage !== "none"
              ? getComputedStyle(bgEl!).backgroundImage
              : getComputedStyle(bgEl!).backgroundColor,
            ratio,
          })
        }
      }

      return found
    })

    expect(offenders, JSON.stringify(offenders, null, 2)).toEqual([])
  })
}
