"use client"

/**
 * The send primitive, end to end.
 *
 * Creating a send and opening one are the only two operations this product
 * really has, so both live here in full rather than being spread across the UI.
 */

import {
  generateContentKey,
  generateLinkSecret,
  seal,
  open,
  wrapContentKey,
  unwrapContentKey,
  blindAttribute,
  toBase64Url,
  fromBase64Url,
} from "./crypto"
import {
  classifyBundle,
  packEnvelope,
  unpackEnvelope,
  type FileMeta,
  type PackedFile,
} from "./envelope"
import { uploadEncryptedBlob, fetchBlobFromGateway } from "./swarm"
import {
  createGrant,
  getCurrentBlock,
  getGrant,
  listGrants,
  type FileKind,
  type Grant,
} from "./arkiv"
import { getIdentity, ensureFunded } from "./identity"

const IV_BYTES = 12

export type CreateSendResult = {
  entityKey: string
  txHash: string
  expiresAt: number
  swarmRef: string
  /** The full share URL, link secret in the fragment. Never sent to a server. */
  url: string
}

export type SendProgress = (stage: string) => void

/**
 * Encrypt → Swarm → grant → link.
 *
 * Note the order: the bytes are encrypted before they leave the browser, the
 * ciphertext goes straight to Swarm from the browser, and only then is a grant
 * written. Our own origin is never in the path of the plaintext, which is the
 * claim the README makes and the reason this app has no upload endpoint.
 */
export async function createSend(params: {
  files: File[]
  recipientLabel: string
  ttlSeconds: number
  onProgress?: SendProgress
}): Promise<CreateSendResult> {
  const progress = params.onProgress ?? (() => {})
  const identity = await getIdentity()
  if (params.files.length === 0) throw new Error("Pick at least one document")

  progress(params.files.length > 1 ? `Reading ${params.files.length} files` : "Reading file")
  const packed: PackedFile[] = await Promise.all(
    params.files.map(async (file) => ({
      header: {
        name: file.name,
        mime: file.type || "application/octet-stream",
        size: file.size,
      } satisfies FileMeta,
      body: new Uint8Array(await file.arrayBuffer()),
    })),
  )

  // One envelope, one key, one blob, one grant — however many documents it
  // holds. The bundle is the unit of sharing because it is the unit of expiry.
  const envelope = packEnvelope(packed)

  progress("Encrypting")
  const contentKey = generateContentKey()
  const sealed = await seal(contentKey, envelope)
  // The nonce rides with the ciphertext so the blob is self-describing.
  const blob = new Uint8Array(sealed.iv.length + sealed.ciphertext.length)
  blob.set(sealed.iv, 0)
  blob.set(sealed.ciphertext, sealed.iv.length)

  progress("Uploading to Swarm")
  const { reference } = await uploadEncryptedBlob(blob)

  progress("Wrapping key")
  const linkSecret = generateLinkSecret()
  const wrapped = await wrapContentKey(contentKey, linkSecret, reference)

  progress("Funding grant key")
  await ensureFunded(identity.address)

  progress("Writing grant to Arkiv")
  const fileKind = classifyBundle(params.files)
  const grant = await createGrant({
    privateKey: identity.privateKey,
    payload: {
      v: 1,
      ref: reference,
      wrap: { iv: toBase64Url(wrapped.iv), ct: toBase64Url(wrapped.ciphertext) },
    },
    fileKind,
    recipientBlind: await blindAttribute(identity.blindKey, params.recipientLabel),
    labelBlind: await blindAttribute(identity.blindKey, params.files.map((f) => f.name).join("|")),
    fileCount: params.files.length,
    ttlSeconds: params.ttlSeconds,
  })

  const url = `${window.location.origin}/s/${grant.entityKey}#${toBase64Url(linkSecret)}`
  progress("Done")

  return { ...grant, swarmRef: reference, url }
}

export type OpenedSend = {
  files: PackedFile[]
  expiresAt: number
  fileKind: FileKind
}

export type OpenFailure =
  | { status: "expired" }
  | { status: "no-key" }
  | { status: "error"; message: string }

/**
 * Open a send.
 *
 * The two halves have to meet here: the link secret from the URL fragment and
 * the wrapped key from the Arkiv grant. A missing grant is the ordinary,
 * expected outcome once the window closes — it is reported as "expired" rather
 * than as an error, because nothing went wrong.
 */
export async function openSend(
  entityKey: string,
  linkSecretB64: string,
): Promise<{ status: "ok"; send: OpenedSend } | OpenFailure> {
  if (!linkSecretB64) return { status: "no-key" }

  let grant: Grant | null
  try {
    grant = await getGrant(entityKey)
  } catch (error) {
    return { status: "error", message: (error as Error).message }
  }
  if (!grant) return { status: "expired" }

  // Check the boundary the engine actually enforces, not a wall clock.
  //
  // The grant dies at a block height. Reading the head and comparing against it
  // asks the same question the engine will ask, so "expired" here means the same
  // thing it means on-chain. This is defence in depth rather than the guarantee:
  // the guarantee is that a moment later the grant is gone and the wrapped key
  // with it, so there is nothing left to refuse.
  if (grant.expiresBlock > 0) {
    const head = await getCurrentBlock()
    if (Number(head) >= grant.expiresBlock) return { status: "expired" }
  }

  try {
    const linkSecret = fromBase64Url(linkSecretB64)
    const contentKey = await unwrapContentKey(
      {
        iv: fromBase64Url(grant.payload.wrap.iv),
        ciphertext: fromBase64Url(grant.payload.wrap.ct),
      },
      linkSecret,
      grant.payload.ref,
    )

    const blob = await fetchBlobFromGateway(grant.payload.ref)
    const envelope = await open(contentKey, {
      iv: blob.subarray(0, IV_BYTES),
      ciphertext: blob.subarray(IV_BYTES),
    })

    const files = unpackEnvelope(envelope)
    return {
      status: "ok",
      send: { files, expiresAt: grant.expiresAt, fileKind: grant.fileKind },
    }
  } catch (error) {
    return { status: "error", message: (error as Error).message }
  }
}

/** The sender's dashboard. Compound filter, owner-scoped. */
export async function listMySends(filter?: {
  fileKind?: FileKind
  createdAfter?: number
  minFiles?: number
}): Promise<Grant[]> {
  const identity = await getIdentity()
  return listGrants({ owner: identity.address, ...filter })
}
