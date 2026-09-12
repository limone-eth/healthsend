"use client"

/**
 * Stopgap notice for the compose screen. H-16 sets aside name and date of birth
 * at import — until that ships, this says plainly that nothing here does yet.
 * Delete this component when H-16 lands.
 */
export function DemoNotice() {
  return (
    <div
      role="note"
      className="mb-4 rounded-lg border border-amber-400 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
    >
      <p className="font-medium">This is a hackathon demo.</p>
      <p className="mt-1">
        Anything you upload here is a real upload to a public network. Please use one of the
        sample files in <code className="font-mono">fixtures/</code> instead of your own health
        records.
      </p>
    </div>
  )
}
