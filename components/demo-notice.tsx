"use client"

/**
 * Stopgap notice for the compose screen. H-16 sets aside name and date of birth
 * at import — until that ships, this says plainly that nothing here does yet.
 * Delete this component when H-16 lands.
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
        there permanently &mdash; expiry ends access, it does not erase anything &mdash; and nothing
        yet sets aside your name and date of birth before a file is shared. Please use the sample
        files in <code className="font-mono">fixtures/</code> instead of your own health records.
      </p>
    </div>
  )
}
