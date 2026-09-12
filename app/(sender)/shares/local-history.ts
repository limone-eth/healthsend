"use client"

/**
 * Local memory of shares this browser has already seen, keyed by the
 * sender's own address.
 *
 * Arkiv drops a grant entity the moment it expires — that is the whole of
 * how expiry works here, see `lib/arkiv.ts`. So a share that lapsed
 * naturally is never returned by `listMySends` again, and nothing server-
 * side remembers it existed. The "Already ended" group in the design can
 * only be populated by remembering, ourselves, what we last saw.
 *
 * "Ended by you" is a different problem: `endSend` deletes the holder's
 * half of the key but deliberately leaves the Arkiv grant alone (see
 * `lib/sends.ts`), so a revoked share keeps coming back from `listMySends`
 * until it would have expired anyway. Absence can't detect that — only the
 * act of ending it can — so `markEndedByYou` is called directly from the
 * confirm sheet's success path, not inferred here.
 */

import type { FileKind, Grant } from "@/lib/arkiv"

const STORAGE_PREFIX = "healthsend:shares-history:"
/** Keeps the stored history from growing without bound over a long-lived browser profile. */
const MAX_ENTRIES = 200

export type KnownShare = {
  entityKey: string
  fileKind: FileKind
  fileCount: number
  createdAt: number
  /** Last value Arkiv reported. Stale once the grant is gone, but the only figure left. */
  expiresAt: number
  endedByYou: boolean
  endedByYouAt: number | null
  /** Set the first time a previously-seen grant is missing from a successful live query. */
  naturallyGoneAt: number | null
  /**
   * H-69: a v3, threshold-release grant has no holder, so it has no access
   * log at all — never "not opened", nothing. `false` for a v3 grant; `true`
   * for every grant shape that still hands its key share to the holder.
   */
  hasAccessLog: boolean
}

function storageKey(address: string): string {
  return `${STORAGE_PREFIX}${address.toLowerCase()}`
}

function load(address: string): Record<string, KnownShare> {
  if (typeof window === "undefined") return {}
  try {
    const raw = window.localStorage.getItem(storageKey(address))
    return raw ? (JSON.parse(raw) as Record<string, KnownShare>) : {}
  } catch {
    return {}
  }
}

function save(address: string, entries: Record<string, KnownShare>): void {
  if (typeof window === "undefined") return
  const values = Object.values(entries)
  if (values.length > MAX_ENTRIES) {
    values.sort((a, b) => b.createdAt - a.createdAt)
    entries = Object.fromEntries(values.slice(0, MAX_ENTRIES).map((v) => [v.entityKey, v]))
  }
  try {
    window.localStorage.setItem(storageKey(address), JSON.stringify(entries))
  } catch {
    // Best effort — losing history is a worse outcome than a thrown error here.
  }
}

/**
 * Reconcile a fresh, successful `listMySends` result against what this
 * browser last saw for this address, and return the merged view.
 *
 * Call this only after a query that actually succeeded — folding in a
 * failed fetch's empty result would mark every live share "gone" on a
 * single network hiccup.
 */
export function reconcileKnownShares(address: string, live: Grant[]): KnownShare[] {
  const known = load(address)
  const now = Math.floor(Date.now() / 1000)
  const liveKeys = new Set(live.map((g) => g.entityKey))

  for (const grant of live) {
    const existing = known[grant.entityKey]
    known[grant.entityKey] = {
      entityKey: grant.entityKey,
      fileKind: grant.fileKind,
      fileCount: grant.fileCount,
      createdAt: grant.createdAt,
      expiresAt: grant.expiresAt,
      endedByYou: existing?.endedByYou ?? false,
      endedByYouAt: existing?.endedByYouAt ?? null,
      naturallyGoneAt: null,
      hasAccessLog: grant.payload.v !== 3,
    }
  }

  for (const key of Object.keys(known)) {
    if (!liveKeys.has(key) && known[key].naturallyGoneAt === null) {
      known[key] = { ...known[key], naturallyGoneAt: now }
    }
  }

  save(address, known)
  return Object.values(known)
}

/** Called from the confirm sheet's success path — see the file header. */
export function markEndedByYou(address: string, entityKey: string): KnownShare[] {
  const known = load(address)
  const now = Math.floor(Date.now() / 1000)
  const existing = known[entityKey]
  known[entityKey] = existing
    ? { ...existing, endedByYou: true, endedByYouAt: now }
    : {
        entityKey,
        fileKind: "mixed",
        fileCount: 1,
        createdAt: now,
        expiresAt: now,
        endedByYou: true,
        endedByYouAt: now,
        naturallyGoneAt: now,
        hasAccessLog: true,
      }
  save(address, known)
  return Object.values(known)
}
