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

/**
 * The sender's live (not ended, not naturally lapsed) share entity keys —
 * one `listMySends` call, reused by every caller in this file. F8
 * (docs/stories/H-74.md) needs this once for the whole archive list rather
 * than once per row; the remove sheet needs it once per open.
 */
export async function loadLiveEntityKeys(senderAddress: string): Promise<Set<string>> {
  const grants = await listMySends()
  const known = reconcileKnownShares(senderAddress, grants)
  return new Set(
    known.filter((entry) => !entry.endedByYou && entry.naturallyGoneAt === null).map((entry) => entry.entityKey),
  )
}

/**
 * Some live shares have no share-index entry — see the file-level comment on
 * `indexUnknown` below. Pure and synchronous so the archive list can call it
 * once per page render rather than once per row.
 */
export function isShareIndexUnknown(
  shareIndex: ShareIndexEntry[] | undefined,
  liveEntityKeys: ReadonlySet<string>,
): boolean {
  const indexed = new Set((shareIndex ?? []).map((entry) => entry.entityKey))
  return [...liveEntityKeys].some((entityKey) => !indexed.has(entityKey))
}

/**
 * How many live, indexed shares hold this document — the archive row pill
 * (F8). Pure: no access-log fetch, so the whole list can be computed from one
 * `loadLiveEntityKeys` call instead of a fetch per row.
 */
export function countLiveSharesForDocument(
  shareIndex: ShareIndexEntry[] | undefined,
  liveEntityKeys: ReadonlySet<string>,
  documentId: string,
): number {
  return sharesIncludingDocument(shareIndex, liveEntityKeys, documentId).length
}

export async function loadLiveSharesForDocument(
  documentId: string,
  shareIndex: ShareIndexEntry[] | undefined,
  senderAddress: string,
): Promise<LiveSharesForDocument> {
  const liveEntityKeys = await loadLiveEntityKeys(senderAddress)

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
  return { shares, indexUnknown: isShareIndexUnknown(shareIndex, liveEntityKeys) }
}
