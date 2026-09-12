"use client"

/**
 * Stopgap notice for the compose screen. H-16 and H-28 set aside a name and
 * date of birth that a matcher can actually recognize — a labeled field, an
 * unlabeled date near the top, the sender's own account name wherever it
 * appears — and H-36 wired that matcher into the upload path itself, so it
 * actually runs on every send rather than proving itself against fixtures
 * alone. A matcher still cannot catch every case (H-15's import review
 * screen, built but not yet connected to this flow — H-56 — is where a human
 * would catch the rest), so this notice keeps pointing senders at the
 * fixtures instead of their own records.
 *
 * The first draft said only "a real upload to a public network", which reads as
 * though the document itself is exposed. It is not: `lib/swarm.ts` uploads
 * ciphertext, the plaintext never leaves this browser, and the recipient reads
 * over a public gateway *because* what is stored is unreadable without both
 * halves of the key. Overstating the risk is its own kind of dishonesty, and a
 * reader who spots the exaggeration discounts the whole warning.
 *
 * What is actually worth warning about is permanence: the ciphertext cannot be
 * deleted from Swarm, health data stays sensitive for a lifetime, and expiry
 * ends access rather than erasing anything. See README.md, "What expiry does
 * and does not do".
 *
 * A third pass corrected "only you and whoever you send the link to can open
 * them" — true only if the link cannot change hands, and it can: it is a
 * bearer capability with no identity check and no device binding, so anyone
 * the recipient forwards the whole URL to opens it exactly as they would. A
 * one-time code sent apart from the link, claimed on first open, would close
 * that gap (H-7) — it is not built, so the notice says what is true today.
 *
 * A fourth pass (H-64) carves out the one kind that skips all of this: a PDF
 * document (H-62/H-63) is never run past the matcher and never scoped down —
 * the operator's decision is that it travels exactly as issued, identifiers
 * included. The blanket "set aside before anything is encrypted" claim below
 * would otherwise be false for it.
 */
export function DemoNotice() {
  return (
    <div
      role="note"
      className="mb-4 rounded-lg border border-amber-400 bg-amber-50 p-4 text-sm text-amber-900"
    >
      <p className="font-medium">This is a hackathon demo.</p>
      <p className="mt-1">
        Your files are encrypted in this browser before they leave it, and the encrypted copy alone
        opens nothing. But anyone with the link can open it &mdash; including anyone your recipient
        forwards it to. There is no separate code and no device check to confirm it&apos;s still
        them. The encrypted copy also goes to a public network and stays there permanently &mdash;
        expiry ends access, it does not erase anything. For a CSV or JSON file, your name, date of
        birth, address and any patient ID are set aside before anything is encrypted, and a
        recognized blood panel is scoped down to its readings rather than sent as the original file
        &mdash; but detection still only catches what it has been taught to recognize, so an
        identifier in a shape it does not know can still go through. A PDF is different: it goes out
        exactly as issued, including any name or date of birth printed on it. Please use the sample
        files in{" "}
        <code className="font-mono">fixtures/</code> instead of your own health records.
      </p>
    </div>
  )
}
