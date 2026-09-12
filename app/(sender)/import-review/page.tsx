import { buildReview, FIXTURES } from "./build-review"
import { ReviewScreen } from "./review-screen"

/**
 * 1.4 · Check what we read — pen ids `CEPKc` (desktop), `TbHzg` (mobile).
 *
 * A server component so `importDocument` runs against the real fixture bytes
 * on the server, exactly as the brief requires ("do not hand-write a parsed
 * result"). `ReviewScreen` only ever receives what import actually returned.
 *
 * The fixture list and the build logic live in `build-review.ts` — no JSX,
 * so `scripts/import-review-proof.mjs` can exercise it directly (see R2-018
 * in `docs/stories/H-49.md`).
 */
export default function ImportReviewPage() {
  const reviews = FIXTURES.map(buildReview)

  return <ReviewScreen reviews={reviews} />
}
