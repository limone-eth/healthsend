import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

/**
 * H-47: a static-text regression guard for the copy fixes that a browser
 * test cannot reach.
 *
 * `README.md` needs no server and no browser, so it is checked directly.
 * `app/(sender)/new/page.tsx`'s Link ready screen sits behind a live Swarm ID
 * sign-in with no offline stub in this repo (see
 * `e2e/mobile-tab-bar-clearance.spec.ts`'s comment on the same constraint),
 * so its JSX source is checked directly too, the same way this repo already
 * checks source text it cannot render (`scripts/import-flag-proof.mjs` reads
 * a fixture rather than driving a browser). `app/landing/page.tsx` renders
 * with no auth, so its regressions are covered live instead, by
 * `e2e/landing-page.spec.ts`.
 */
const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (relativePath) => readFileSync(path.join(repoRoot, relativePath), "utf8")

const readme = read("README.md")

// R2-009 — a full compromise of HealthSend, not just of stored data, was
// once claimed to reach nothing. It reaches the plaintext a compromised
// deployment can read on its way through the browser encryption step.
assert.ok(
  !readme.includes("Compromising HealthSend entirely does not reach the documents."),
  "README must not claim a full compromise reaches nothing",
)
assert.ok(
  /what an attacker who controls the \*build\*\s+reaches/.test(readme),
  "README must name what browser encryption does not cover",
)

// R2-023 — app/page.tsx was split into /new and /shares by H-4; revoke and
// the access log both have sender-facing controls today.
assert.ok(
  !readme.includes("app/page.tsx      sender: sign in, upload, share, watch it expire"),
  "README's layout table must not describe the pre-H-4 checkout",
)
assert.ok(readme.includes("app/(sender)/new/"), "README's layout table must name the /new route")
assert.ok(readme.includes("app/(sender)/shares/"), "README's layout table must name the /shares route")
assert.ok(
  !readme.includes("The revoke and access-log\nbackends exist, but their sender controls are **not built**."),
  "README must not claim revoke and the access log have no sender control",
)
assert.ok(
  readme.includes("/api/holder/revoke") && readme.includes("/api/holder/access-log"),
  "README must describe the sender controls that call revoke and the access log",
)
assert.ok(
  !readme.includes("Detection\nbeyond those labelled patterns is designed but **not built**."),
  "README must not claim all unlabelled detection is undesigned scaffolding",
)
assert.ok(
  readme.includes("catches an unlabeled date of birth"),
  "README must describe the unlabelled detection lib/deident.ts already does",
)

const newSharePage = read("app/(sender)/new/page.tsx")

// The Link ready screen's summary row and footnote assumed a gendered
// recipient ("she"/"her"), missed when the chip vocabulary was de-gendered
// on 2026-09-12. Matched as live JSX props/text, not as the doc comment's
// historical quotes of what the frame used to say.
for (const stale of [
  'label="She sees about you"',
  'desktopLabel="What she sees about you"',
  "and she loses access straight away",
]) {
  assert.ok(!newSharePage.includes(stale), `app/(sender)/new/page.tsx must not still read "${stale}"`)
}
for (const current of [
  'label="They see about you"',
  'desktopLabel="What they see about you"',
  "and they lose access straight away",
]) {
  assert.ok(newSharePage.includes(current), `app/(sender)/new/page.tsx must read "${current}"`)
}

console.log("PASS  README and the Link ready screen no longer carry the six stale claims.")
