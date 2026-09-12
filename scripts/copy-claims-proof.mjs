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

// The Link ready screen's footnote assumed a gendered recipient ("she"),
// missed when the chip vocabulary was de-gendered on 2026-09-12. Matched as
// live JSX text, not as the doc comment's historical quotes of what the
// frame used to say.
//
// H-47's other pair here checked the summary row's own "she"/"they" wording
// ("She sees about you" / "What she sees about you"). H-71 dropped that row
// entirely (the operator did not want it), so there is no longer a label to
// regress to "she" in — the guard for that pair is obsolete, not renamed.
assert.ok(
  !newSharePage.includes("and she loses access straight away"),
  'app/(sender)/new/page.tsx must not still read "and she loses access straight away"',
)
assert.ok(
  newSharePage.includes("and they lose access straight away"),
  'app/(sender)/new/page.tsx must read "and they lose access straight away"',
)

// H-64 — a PDF is no longer set aside like a CSV/JSON record (H-62's
// operator decision). `components/demo-notice.tsx` renders inside `/new`'s
// signed-in `ScopeSection` with no offline stub in this repo, so its source
// text is checked directly, the same way the Link ready screen above is.
const demoNotice = read("components/demo-notice.tsx").replace(/\s+/g, " ")
assert.ok(
  !demoNotice.includes(
    "Your name, date of birth, address and any patient ID are set aside before anything is encrypted, and a recognized blood panel is",
  ),
  "demo-notice.tsx must not claim every file has its identifiers set aside — a PDF does not",
)
assert.ok(
  demoNotice.includes("A PDF is different: it goes out exactly as issued, including any name or date of birth printed on it."),
  "demo-notice.tsx must say a PDF goes out as issued",
)

console.log("PASS  README and the Link ready screen no longer carry their stale claims.")
console.log("PASS  demo-notice.tsx no longer claims a PDF's identifiers are set aside")
