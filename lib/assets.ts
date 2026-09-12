"use client"

/**
 * The one-time encrypted asset — DESIGN.md § "Upload once, bundle per share".
 *
 * Splitting the send in two starts here. A blood-test PDF gets exactly one
 * content key, one AES-256-GCM seal, and one Swarm upload, no matter how many
 * times it is later shared. `lib/sends.ts`'s `createThresholdSend` issues a
 * fresh grant against the `EncryptedAsset` this module returns — a different
 * link secret and a different TACo-protected share per recipient, but never a
 * second upload for the same file.
 *
 * `contentKey` lives in memory only: this type carries no serializer and
 * nothing in this module ever hands it to `JSON.stringify`, a storage API, or
 * a network call other than the one Swarm upload. A refresh of the tab holding
 * it discards it — deliberate for this PoC, and recorded as a real product gap
 * in docs/stories/H-53.md `## Choices`.
 */

import { fromBase64Url, generateContentKey, seal } from "./crypto"
import { classify, classifyBundle, packEnvelope, type PackedFile } from "./envelope"
import { uploadEncryptedBlob } from "./swarm"
import { createArchive, scopeArchive, type DocumentRecord, type SetAsideIdentifiers } from "./archive"
import { hasSetAside, importDocument } from "./import"
import type { FileKind } from "./arkiv"

export type EncryptedAsset = {
  /** Swarm content hash of `iv || ciphertext`. Reused by every grant issued against this asset. */
  ref: string
  /** The one content encryption key. Never leaves the browser, never serialized. */
  contentKey: Uint8Array
  fileKind: FileKind
  fileCount: number
  /** Pre-encryption file names, joined — the blinded HMAC input each grant's `label` attribute uses. */
  labelSource: string
  /** H-36: what import set aside, per file that actually had something to set aside. */
  setAside: { fileName: string; setAside: SetAsideIdentifiers }[]
}

export type AssetProgress = (stage: string) => void

type CreateEncryptedAssetDependencies = {
  uploadEncryptedBlob: typeof uploadEncryptedBlob
}

const defaultCreateEncryptedAssetDependencies: CreateEncryptedAssetDependencies = {
  uploadEncryptedBlob,
}

/** A packed file's name with its extension swapped — what it actually holds now, not what it arrived as. */
function withExtension(name: string, extension: string): string {
  return `${name.replace(/\.[^./]+$/, "")}.${extension}`
}

/**
 * Import one file and turn it into what actually travels.
 *
 * Every file passes through `importDocument` before anything is encrypted, so
 * identifiers are set aside on the way in, never filtered on the way out. A
 * recognized blood panel is run back through `scopeArchive` so what a
 * recipient receives is a scoped share carrying only that record's fields,
 * never the archive's own provenance. The key used here is generated fresh
 * and discarded immediately after; nothing about this archive persists past
 * this call. Moved from `lib/sends.ts` verbatim by H-53 — see
 * `docs/stories/H-53.md`.
 */
async function importForAsset(
  file: File,
  accountName: string | undefined,
  importedAt: string,
): Promise<{ packed: PackedFile; fileName: string; setAside: SetAsideIdentifiers }> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const imported = importDocument({
    bytes,
    format: classify(file),
    recordId: `record:send:${crypto.randomUUID()}`,
    sourceId: `source:${crypto.randomUUID()}`,
    importedAt,
    takenOn: importedAt.slice(0, 10),
    accountName,
  })

  if (imported.kind === "blood-panel") {
    const ephemeralKey = crypto.getRandomValues(new Uint8Array(32))
    const encryptedArchive = await createArchive(ephemeralKey, [imported.record])
    const scoped = await scopeArchive(encryptedArchive, ephemeralKey, [
      {
        kind: "blood-panel",
        recordId: imported.record.id,
        markerIds: imported.record.markers.map((marker) => marker.id),
      },
    ])
    const name = withExtension(file.name, "json")
    return {
      packed: { header: { name, mime: "application/json", size: scoped.length }, body: scoped },
      fileName: file.name,
      setAside: imported.record.provenance.setAside ?? {},
    }
  }

  const body = new TextEncoder().encode(imported.cleanedText)
  const name = withExtension(file.name, "txt")
  return {
    packed: { header: { name, mime: "text/plain", size: body.length }, body },
    fileName: file.name,
    setAside: imported.setAside,
  }
}

/**
 * Pack, encrypt and upload one reusable asset.
 *
 * Everything here happens exactly once per file set: one envelope, one fresh
 * content key, one AES-256-GCM seal, one Swarm upload. Callers reuse the
 * returned `EncryptedAsset` for as many `createThresholdSend` calls as they
 * like — the whole point of separating this from grant issuance.
 */
export async function createEncryptedAsset(
  params: {
    files: File[]
    /** The sender's own account name, if known — passed to `importDocument` (H-28). */
    accountName?: string
    onProgress?: AssetProgress
  },
  dependencyOverrides: Partial<CreateEncryptedAssetDependencies> = {},
): Promise<EncryptedAsset> {
  const progress = params.onProgress ?? (() => {})
  if (params.files.length === 0) throw new Error("Pick at least one document")

  const dependencies = { ...defaultCreateEncryptedAssetDependencies, ...dependencyOverrides }

  progress(params.files.length > 1 ? `Reading ${params.files.length} files` : "Reading file")
  const importedAt = new Date().toISOString()
  const imports = await Promise.all(
    params.files.map((file) => importForAsset(file, params.accountName, importedAt)),
  )
  const packed: PackedFile[] = imports.map((entry) => entry.packed)
  const setAside = imports
    .map(({ fileName, setAside }) => ({ fileName, setAside }))
    .filter((entry) => hasSetAside(entry.setAside))

  // One envelope, one key, one blob — however many documents it holds. The
  // bundle is the unit of upload because it is the unit this asset reuses.
  const envelope = packEnvelope(packed)

  progress("Encrypting")
  const contentKey = generateContentKey()
  const sealed = await seal(contentKey, envelope)
  // The nonce rides with the ciphertext so the blob is self-describing.
  const blob = new Uint8Array(sealed.iv.length + sealed.ciphertext.length)
  blob.set(sealed.iv, 0)
  blob.set(sealed.ciphertext, sealed.iv.length)

  progress("Uploading to Swarm")
  const { reference } = await dependencies.uploadEncryptedBlob(blob)

  return {
    ref: reference,
    contentKey,
    fileKind: classifyBundle(params.files),
    fileCount: params.files.length,
    labelSource: params.files.map((f) => f.name).join("|"),
    setAside,
  }
}

/**
 * Pack, encrypt and upload a fresh asset from already-imported archive PDFs.
 *
 * H-64: the operator's model — the archive key opens the sender's archive
 * locally, the chosen PDFs come out readable in the browser, and a **brand-new
 * share key** (generated here, never the archive key) seals just those before
 * one upload. `documents[].bytes` is read as-is — no `importDocument` step,
 * because these are not fresh uploads to parse; they were already imported PDF
 * bytes when H-63's Add flow put them in the archive, and the whole point of
 * H-62's operator decision is that a PDF travels exactly as issued, including
 * any name or date of birth printed on it, rather than through the cleaning
 * path `importForAsset` runs fresh files through.
 */
export async function createEncryptedAssetFromArchive(
  documents: DocumentRecord[],
  onProgress?: AssetProgress,
  dependencyOverrides: Partial<CreateEncryptedAssetDependencies> = {},
): Promise<EncryptedAsset> {
  const progress = onProgress ?? (() => {})
  if (documents.length === 0) throw new Error("Pick at least one document")

  const dependencies = { ...defaultCreateEncryptedAssetDependencies, ...dependencyOverrides }

  progress(documents.length > 1 ? `Reading ${documents.length} documents` : "Reading document")
  const packed: PackedFile[] = documents.map((document) => {
    const bytes = fromBase64Url(document.bytes)
    return { header: { name: document.name, mime: "application/pdf", size: bytes.length }, body: bytes }
  })

  // One envelope, one key, one blob — the same shape `createEncryptedAsset`
  // produces for freshly picked files, so the recipient's existing
  // multi-document switcher and `PdfPreview` need no changes to read it.
  const envelope = packEnvelope(packed)

  progress("Encrypting")
  const contentKey = generateContentKey()
  const sealed = await seal(contentKey, envelope)
  const blob = new Uint8Array(sealed.iv.length + sealed.ciphertext.length)
  blob.set(sealed.iv, 0)
  blob.set(sealed.ciphertext, sealed.iv.length)

  progress("Uploading to Swarm")
  const { reference } = await dependencies.uploadEncryptedBlob(blob)

  return {
    ref: reference,
    contentKey,
    fileKind: "pdf",
    fileCount: documents.length,
    labelSource: documents.map((d) => d.name).join("|"),
    // Nothing is set aside for a document record — H-62's consequence is that
    // a PDF is never scanned or scoped, so there is nothing to report back.
    setAside: [],
  }
}
