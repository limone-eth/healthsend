"use client"

/**
 * Copy, pure decisions and the removal orchestration for `RemoveDocumentSheet`
 * (`components/remove-document-sheet.tsx`). No JSX here, so
 * `scripts/remove-document-proof.mjs` can exercise it directly — the same
 * split `app/(sender)/shares/confirm-end.ts` uses for its sheet.
 *
 * `lib/archive.ts`'s `sharesIncludingDocument` decides *which* shares are
 * live and hold the document; everything below reads that decision, never
 * repeats it.
 */

import { removeDocumentFromMyArchive } from "@/lib/archive-store"
import type { Archive } from "@/lib/archive"
import { endSend } from "@/lib/sends"
import { markEndedByYou } from "@/app/(sender)/shares/local-history"

export type LiveShareView = {
  entityKey: string
  documentIds: string[]
  createdAt: number
  expiresAt: number
  /** Set only when the holder access log reports a reliable open for this share. */
  openedAt: number | null
}

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"]

function numberWord(n: number): string {
  return n < NUMBER_WORDS.length ? NUMBER_WORDS[n] : String(n)
}

/** "Share of this PDF" for a share that holds only the document being removed, "Share of N documents" otherwise. Callers only pass shares that already include the document. */
export function shareLabel(documentIds: string[]): string {
  return documentIds.length === 1 ? "Share of this PDF" : `Share of ${documentIds.length} documents`
}

const endsWeekday = new Intl.DateTimeFormat("en-GB", { weekday: "long" })
const endsFullDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long" })
const CLOSING_SECONDS = 7 * 86400

/** "Ends 4 December · 74 days" while there is more than a week left, "Ends Sunday · 6 days" inside it. */
export function endsLabel(expiresAt: number, now: number): string {
  const remainingSeconds = Math.max(0, expiresAt - now)
  const days = Math.ceil(remainingSeconds / 86400)
  const date = new Date(expiresAt * 1000)
  const when = remainingSeconds <= CLOSING_SECONDS ? endsWeekday.format(date) : endsFullDate.format(date)
  return `Ends ${when} · ${days} day${days === 1 ? "" : "s"}`
}

/** "It is in two shares that are still open" — the chalk card's head line. */
export function sharesHeadline(count: number): string {
  const noun = count === 1 ? "share" : "shares"
  const verb = count === 1 ? "is" : "are"
  return `It is in ${numberWord(count)} ${noun} that ${verb} still open`
}

/** The ticked-by-default checkbox's own label. */
export function endAllCheckboxLabel(count: number): string {
  if (count === 1) return "End this share now, so nobody can open it again"
  if (count === 2) return "End both shares now, so nobody can open it again"
  return `End all ${count} shares now, so nobody can open it again`
}

const openedDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long" })

/**
 * Only when a listed share has a reliable open — never a guessed date. With
 * one live share, "It was opened on…"; with more than one, "One of these
 * shares was opened on…", naming the earliest reliable open among them.
 */
export function openedNoteText(shares: LiveShareView[]): string | null {
  const openedTimestamps = shares
    .map((share) => share.openedAt)
    .filter((value): value is number => value !== null)
  if (openedTimestamps.length === 0) return null
  const earliest = Math.min(...openedTimestamps)
  const date = openedDate.format(new Date(earliest * 1000))
  const subject = shares.length === 1 ? "It" : "One of these shares"
  return `${subject} was opened on ${date}. Ending it stops anything further — it cannot un-read what was already seen, and we will not pretend it can.`
}

/**
 * The chalk card renders whenever there is something to say about shares:
 * either a known, possibly-empty list, or the "can't be checked" note for an
 * archive whose share index predates this story. It stays hidden only when
 * the index is known and genuinely empty.
 */
export function shouldShowSharesCard(shares: LiveShareView[], indexUnknown: boolean): boolean {
  return indexUnknown || shares.length > 0
}

/**
 * Some live shares have no share-index entry — made before the index existed,
 * sent straight from a file, or a failed index write — so the archive cannot
 * say what they hold. Say that plainly, and point at the one place they can be
 * ended, rather than implying the document is in none of them.
 */
export const UNKNOWN_SHARES_HEADLINE = "Some open shares can't be checked"

export const UNKNOWN_SHARES_NOTE =
  "Shares made before this list, or sent straight from a file, aren't tracked here. If one of them includes this PDF, end it in Your shares."

export type RemoveDocumentOutcome =
  | { outcome: "removed"; archive: Archive; endedShares: string[] }
  | {
      outcome: "removed-partial"
      archive: Archive
      endedShares: string[]
      failedShares: { entityKey: string; message: string }[]
    }
  | { outcome: "refused"; message: string }

type RemoveDocumentDependencies = {
  removeDocumentFromMyArchive: typeof removeDocumentFromMyArchive
  endSend: typeof endSend
  markEndedByYou: typeof markEndedByYou
}

const defaultDependencies: RemoveDocumentDependencies = {
  removeDocumentFromMyArchive,
  endSend,
  markEndedByYou,
}

/**
 * Remove the document, then — only for the shares the caller decided to end
 * — end each one and record it locally as ended by the sender. `sharesToEnd`
 * must already be exactly the live shares that include this document (see
 * `sharesIncludingDocument`, lib/archive.ts): this function ends precisely
 * what it is given, nothing it discovers on its own.
 *
 * One failed `endSend` does not stop the others — every share gets its own
 * attempt, and the caller sees exactly which ones did not end.
 */
export async function performRemoveDocument(
  documentId: string,
  sharesToEnd: LiveShareView[],
  senderAddress: string,
  dependencies: RemoveDocumentDependencies = defaultDependencies,
): Promise<RemoveDocumentOutcome> {
  let archive: Archive
  try {
    archive = await dependencies.removeDocumentFromMyArchive(documentId)
  } catch (error) {
    return { outcome: "refused", message: (error as Error).message }
  }

  if (sharesToEnd.length === 0) return { outcome: "removed", archive, endedShares: [] }

  const ended: string[] = []
  const failed: { entityKey: string; message: string }[] = []
  for (const share of sharesToEnd) {
    const result = await dependencies.endSend(share.entityKey)
    if (result.status === "ended") {
      dependencies.markEndedByYou(senderAddress, share.entityKey)
      ended.push(share.entityKey)
    } else {
      failed.push({ entityKey: share.entityKey, message: result.message })
    }
  }
  if (failed.length > 0) return { outcome: "removed-partial", archive, endedShares: ended, failedShares: failed }
  return { outcome: "removed", archive, endedShares: ended }
}
