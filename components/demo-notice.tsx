"use client"

/**
 * Stopgap notice for the compose screen. H-16 and H-28 set aside a name and
 * date of birth that a matcher can actually recognize — a labeled field, an
 * unlabeled date near the top, the sender's own account name wherever it
 * appears. A matcher still cannot catch every case (H-15's import review
 * screen, unbuilt, is where a human catches the rest), so this notice keeps
 * pointing senders at the fixtures instead of their own records.
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
 */
export function DemoNotice() {
  return (
    <div
      role="note"
      className="mb-4 rounded-lg border border-amber-400 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
    >
      <p className="font-medium">This is a hackathon demo.</p>
      <p className="mt-1">
        Your files are encrypted in this browser before they leave it, so only you and whoever you
        send the link to can open them. But the encrypted copy goes to a public network and stays
        there permanently &mdash; expiry ends access, it does not erase anything &mdash; and a name
        or date of birth we don&apos;t recognize can still slip through before a file is shared.
        Please use the sample files in <code className="font-mono">fixtures/</code> instead of your
        own health records.
      </p>
    </div>
  )
}
