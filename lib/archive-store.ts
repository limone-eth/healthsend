"use client"

import {
  addArchiveRecords,
  addShareIndexEntry,
  createArchive,
  openArchive,
  removeDocument,
  scopeArchive,
  type Archive,
  type ArchiveRecord,
  type ArchiveSelection,
  type ShareIndexEntry,
} from "./archive"
import { getIdentity, type Identity } from "./identity"
import { readArchiveReference, writeArchiveReference } from "./archive-manifest"
import { fetchBlobFromGateway, uploadEncryptedBlob } from "./swarm"
import { toHex } from "./crypto"

type ArchiveStoreDependencies = {
  getIdentity: () => Promise<Identity>
  readArchiveReference: (topic: Uint8Array) => Promise<string | null>
  writeArchiveReference: (topic: Uint8Array, reference: string) => Promise<void>
  fetchBlobFromGateway: (reference: string) => Promise<Uint8Array>
  uploadEncryptedBlob: (bytes: Uint8Array) => Promise<{ reference: string }>
}

const defaults: ArchiveStoreDependencies = {
  getIdentity,
  readArchiveReference,
  writeArchiveReference,
  fetchBlobFromGateway,
  uploadEncryptedBlob,
}

type RememberedWrite = { reference: string; rev: number }

/**
 * The last archive this device wrote, per identity archive topic.
 *
 * A Swarm feed reference carries no order of its own, and the feed can keep
 * answering the reference from before a write for a while after that write
 * lands. Without a memory of its own write, the next read-modify-write in
 * this tab would start from that stale archive and silently discard the
 * edit just made (see docs/stories/H-70.md).
 *
 * In memory for this tab, and mirrored to `localStorage` so a reload during
 * the lag window still remembers. Only ever a reference and a revision
 * number: never plaintext, never key material.
 */
const rememberedInTab = new Map<string, RememberedWrite>()

function storageKey(topic: Uint8Array): string {
  return `healthsend:archive-last-write:${toHex(topic)}`
}

function rememberWrite(topic: Uint8Array, write: RememberedWrite): void {
  const key = storageKey(topic)
  rememberedInTab.set(key, write)
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(key, JSON.stringify(write))
  } catch {
    // Private browsing or a full quota still leaves the in-memory copy for this tab.
  }
}

function recallWrite(topic: Uint8Array): RememberedWrite | null {
  const key = storageKey(topic)
  const inMemory = rememberedInTab.get(key)
  if (inMemory) return inMemory
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as RememberedWrite).reference === "string" &&
      typeof (parsed as RememberedWrite).rev === "number"
    ) {
      rememberedInTab.set(key, parsed as RememberedWrite)
      return parsed as RememberedWrite
    }
  } catch {
    // Corrupt or inaccessible storage: fall through to "nothing remembered".
  }
  return null
}

/**
 * Read whichever of the feed's current reference and this device's own
 * remembered write opens to the higher `rev`.
 *
 * A plain feed read is not enough: after a write lands, the feed can keep
 * answering the previous reference for a while. When the two disagree,
 * both are opened and compared by `rev` rather than trusted by recency —
 * that is also what lets another device's genuinely newer write win, since
 * its `rev` is higher than anything remembered here.
 *
 * On a tie (`rev` equal but references differ) the feed's reference wins.
 * That is a real conflict this scheme does not resolve — two devices wrote
 * from the same base `rev` — and one of the two writes is silently kept,
 * the other silently dropped; see H-70's "Choices".
 */
async function readStoredArchive(
  identity: Identity,
  dependencies: ArchiveStoreDependencies,
): Promise<Uint8Array | null> {
  const remembered = recallWrite(identity.archiveTopic)
  const feedReference = await dependencies.readArchiveReference(identity.archiveTopic)

  if (!feedReference && !remembered) return null
  if (!remembered) return dependencies.fetchBlobFromGateway(feedReference!)
  if (!feedReference || feedReference === remembered.reference) {
    return dependencies.fetchBlobFromGateway(remembered.reference)
  }

  const [feedBytes, rememberedBytes] = await Promise.all([
    dependencies.fetchBlobFromGateway(feedReference),
    dependencies.fetchBlobFromGateway(remembered.reference),
  ])
  const [feedArchive, rememberedArchive] = await Promise.all([
    openArchive(feedBytes, identity.archiveKey),
    openArchive(rememberedBytes, identity.archiveKey),
  ])
  return feedArchive.rev >= rememberedArchive.rev ? feedBytes : rememberedBytes
}

/** Read the signed-in sender's archive. A missing feed is a real empty archive. */
export async function loadMyArchive(
  dependencyOverrides: Partial<ArchiveStoreDependencies> = {},
): Promise<Archive> {
  const dependencies = { ...defaults, ...dependencyOverrides }
  const identity = await dependencies.getIdentity()
  const encrypted = await readStoredArchive(identity, dependencies)
  if (!encrypted) return { v: 1, kind: "healthsend-archive", records: [], rev: 0, updatedAt: 0 }
  return openArchive(encrypted, identity.archiveKey)
}

/**
 * One archive write at a time, in this tab.
 *
 * A second pick starting while the first is still uploading, or a share
 * finishing while a removal is in flight, must queue behind whichever write
 * is already running rather than both reading the same starting archive and
 * racing to write last — the second writer would otherwise silently discard
 * the first writer's edit, feed lag or not.
 */
let writeChain: Promise<unknown> = Promise.resolve()

function serialized<T>(run: () => Promise<T>): Promise<T> {
  const result = writeChain.then(run, run)
  writeChain = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

/**
 * Add records with a read-modify-write cycle.
 *
 * The feed changes only after the replacement ciphertext exists. A failed
 * upload or feed update therefore leaves the previous archive readable.
 */
export async function addRecordsToMyArchive(
  records: ArchiveRecord[],
  dependencyOverrides: Partial<ArchiveStoreDependencies> = {},
): Promise<Archive> {
  if (records.length === 0) throw new Error("Add at least one archive record")

  const dependencies = { ...defaults, ...dependencyOverrides }
  return serialized(async () => {
    const identity = await dependencies.getIdentity()
    const stored = await readStoredArchive(identity, dependencies)
    const current = stored ?? (await createArchive(identity.archiveKey))
    const encrypted = await addArchiveRecords(current, identity.archiveKey, records)
    const { reference } = await dependencies.uploadEncryptedBlob(encrypted)
    await dependencies.writeArchiveReference(identity.archiveTopic, reference)
    const opened = await openArchive(encrypted, identity.archiveKey)
    rememberWrite(identity.archiveTopic, { reference, rev: opened.rev })
    return opened
  })
}

/**
 * Remove one document with the same read-modify-write cycle `addRecordsToMyArchive`
 * uses: the feed moves only after the replacement ciphertext exists, so a failed
 * upload or feed update leaves the previous archive — document included — readable.
 */
export async function removeDocumentFromMyArchive(
  documentId: string,
  dependencyOverrides: Partial<ArchiveStoreDependencies> = {},
): Promise<Archive> {
  const dependencies = { ...defaults, ...dependencyOverrides }
  return serialized(async () => {
    const identity = await dependencies.getIdentity()
    const stored = await readStoredArchive(identity, dependencies)
    if (!stored) throw new Error("Your archive is empty")
    const encrypted = await removeDocument(stored, identity.archiveKey, documentId)
    const { reference } = await dependencies.uploadEncryptedBlob(encrypted)
    await dependencies.writeArchiveReference(identity.archiveTopic, reference)
    const opened = await openArchive(encrypted, identity.archiveKey)
    rememberWrite(identity.archiveTopic, { reference, rev: opened.rev })
    return opened
  })
}

/**
 * Record one more share in the archive's own share index. Called by
 * `createSendFromArchive` (H-64) once that share's grant and key hand-off
 * both succeed — never before, and never for a share this archive did not
 * make.
 */
export async function addShareIndexEntryToMyArchive(
  entry: ShareIndexEntry,
  dependencyOverrides: Partial<ArchiveStoreDependencies> = {},
): Promise<Archive> {
  const dependencies = { ...defaults, ...dependencyOverrides }
  return serialized(async () => {
    const identity = await dependencies.getIdentity()
    const stored = await readStoredArchive(identity, dependencies)
    const current = stored ?? (await createArchive(identity.archiveKey))
    const encrypted = await addShareIndexEntry(current, identity.archiveKey, entry)
    const { reference } = await dependencies.uploadEncryptedBlob(encrypted)
    await dependencies.writeArchiveReference(identity.archiveTopic, reference)
    const opened = await openArchive(encrypted, identity.archiveKey)
    rememberWrite(identity.archiveTopic, { reference, rev: opened.rev })
    return opened
  })
}

/** Prepare the selected archive records for the existing encrypted send path. */
export async function scopeMyArchive(
  selections: ArchiveSelection[],
  dependencyOverrides: Partial<ArchiveStoreDependencies> = {},
): Promise<Uint8Array> {
  const dependencies = { ...defaults, ...dependencyOverrides }
  const identity = await dependencies.getIdentity()
  const encrypted = await readStoredArchive(identity, dependencies)
  if (!encrypted) throw new Error("Your archive is empty")
  return scopeArchive(encrypted, identity.archiveKey, selections)
}
