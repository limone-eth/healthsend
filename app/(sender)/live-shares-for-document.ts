"use client"

/**
 * Which of the sender's live shares include one archived document, with
 * each one's "opened" state. Combines three things `lib/archive.ts`'s pure
 * `sharesIncludingDocument` cannot reach on its own: a fresh `listMySends`
 * call, this browser's memory of shares the sender ended themselves
 * (`shares/local-history.ts` — Arkiv keeps returning a grant `endSend`
 * revoked until it would have expired anyway), and each share's holder
 * access log.
 */

import { listMySends } from "@/lib/sends"
import { sharesIncludingDocument, type ShareIndexEntry } from "@/lib/archive"
import type { LiveShareView } from "@/components/remove-document-sheet-logic"
import { reconcileKnownShares } from "./shares/local-history"
import { fetchAccessLog } from "./shares/access-log-client"

export type LiveSharesForDocument = { shares: LiveShareView[]; indexUnknown: boolean }

export async function loadLiveSharesForDocument(
  documentId: string,
  shareIndex: ShareIndexEntry[] | undefined,
  senderAddress: string,
): Promise<LiveSharesForDocument> {
  const grants = await listMySends()
  const known = reconcileKnownShares(senderAddress, grants)
  const liveEntityKeys = new Set(
    known.filter((entry) => !entry.endedByYou && entry.naturallyGoneAt === null).map((entry) => entry.entityKey),
  )

  const matches = sharesIncludingDocument(shareIndex, liveEntityKeys, documentId)

  const shares = await Promise.all(
    matches.map(async (entry): Promise<LiveShareView> => {
      const log = await fetchAccessLog(entry.entityKey)
      const openedAt =
        log.status === "ok" && log.reliable && log.opened.length > 0 ? Math.min(...log.opened) : null
      return {
        entityKey: entry.entityKey,
        documentIds: entry.documentIds,
        createdAt: entry.createdAt,
        expiresAt: entry.expiresAt,
        openedAt,
      }
    }),
  )

  /**
   * H-64 (`createSendFromArchive`) is not on `main` yet, so no live share
   * can hold a document today — every archive-document share will carry an
   * index entry from the moment it can exist at all. Once H-64 lands, a
   * share made between that landing and this one predates the index the
   * same way an archive itself can; nothing in the current `Grant` shape
   * marks a grant as "from this archive" without it, so detecting that case
   * is deferred rather than guessed at here — see docs/stories/H-18.md,
   * "## Choices".
   */
  const indexUnknown = false

  return { shares, indexUnknown }
}
