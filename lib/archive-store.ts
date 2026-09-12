"use client"

import {
  addArchiveRecords,
  createArchive,
  openArchive,
  scopeArchive,
  type Archive,
  type ArchiveRecord,
  type ArchiveSelection,
} from "./archive"
import { getIdentity, type Identity } from "./identity"
import { readArchiveReference, writeArchiveReference } from "./archive-manifest"
import { fetchBlobFromGateway, uploadEncryptedBlob } from "./swarm"

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

async function readStoredArchive(
  identity: Identity,
  dependencies: ArchiveStoreDependencies,
): Promise<Uint8Array | null> {
  const reference = await dependencies.readArchiveReference(identity.archiveTopic)
  if (!reference) return null
  return dependencies.fetchBlobFromGateway(reference)
}

/** Read the signed-in sender's archive. A missing feed is a real empty archive. */
export async function loadMyArchive(
  dependencyOverrides: Partial<ArchiveStoreDependencies> = {},
): Promise<Archive> {
  const dependencies = { ...defaults, ...dependencyOverrides }
  const identity = await dependencies.getIdentity()
  const encrypted = await readStoredArchive(identity, dependencies)
  if (!encrypted) return { v: 1, kind: "healthsend-archive", records: [] }
  return openArchive(encrypted, identity.archiveKey)
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
  const identity = await dependencies.getIdentity()
  const stored = await readStoredArchive(identity, dependencies)
  const current = stored ?? (await createArchive(identity.archiveKey))
  const encrypted = await addArchiveRecords(current, identity.archiveKey, records)
  const { reference } = await dependencies.uploadEncryptedBlob(encrypted)
  await dependencies.writeArchiveReference(identity.archiveTopic, reference)
  return openArchive(encrypted, identity.archiveKey)
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
