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
   * A live share with no index entry means the archive cannot say what it
   * holds: it was made before the index existed, its index write failed, or
   * it came from the file picker rather than the archive. Grants carry
   * nothing that tells those apart, so any of them makes the sheet say it
   * cannot check rather than imply the document is in no share. Over-flagging
   * a file-picker share costs one extra sentence; under-flagging would be a
   * false "nobody has this".
   */
  const indexed = new Set((shareIndex ?? []).map((entry) => entry.entityKey))
  const indexUnknown = [...liveEntityKeys].some((entityKey) => !indexed.has(entityKey))

  return { shares, indexUnknown }
}
