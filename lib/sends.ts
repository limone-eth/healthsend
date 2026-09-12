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
  splitContentKey,
  joinContentKey,
  deriveAuthKey,
  unwrapContentKey,
  blindAttribute,
  toBase64Url,
  fromBase64Url,
  packEntityKey,
  unpackEntityKey,
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
  MalformedGrantError,
  type FileKind,
  type Grant,
} from "./arkiv"
import { getIdentity, ensureFunded } from "./identity"
import { revokeMessage } from "./revoke"
import { shareMessage } from "./share"
import { privateKeyToAccount } from "viem/accounts"

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

type CreateSendDependencies = {
  fetch: typeof fetch
  getIdentity: typeof getIdentity
  uploadEncryptedBlob: typeof uploadEncryptedBlob
  createGrant: typeof createGrant
}

const defaultCreateSendDependencies: CreateSendDependencies = {
  fetch,
  getIdentity,
  uploadEncryptedBlob,
  createGrant,
}

/**
 * Reach the holder route before any send work starts.
 *
 * The empty submission is intentionally invalid. A configured route rejects it
 * with 400 before it can read Arkiv or write Redis. A missing configuration is
 * reported by the route's earlier 501 guard, and a dead route rejects fetch.
 */
async function preflightHolder(request: typeof fetch): Promise<void> {
  let response: Response
  try {
    response = await request("/api/holder/share", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    })
  } catch (error) {
    throw new Error(`The key-share holder is unavailable: ${(error as Error).message}`)
  }

  if (response.status === 400) return

  const detail = await response.json().catch(() => ({}))
  throw new Error(
    `The key-share holder is unavailable: ${detail?.error ?? `HTTP ${response.status}`}`,
  )
}

/**
 * Encrypt → Swarm → grant → link.
 *
 * Note the order: the bytes are encrypted before they leave the browser, the
 * ciphertext goes straight to Swarm from the browser, and only then is a grant
 * written. Our own origin is never in the path of the plaintext, which is the
 * claim the README makes and the reason this app has no upload endpoint.
 */
export async function createSend(
  params: {
    files: File[]
    recipientLabel: string
    ttlSeconds: number
    onProgress?: SendProgress
  },
  dependencyOverrides: Partial<CreateSendDependencies> = {},
): Promise<CreateSendResult> {
  const progress = params.onProgress ?? (() => {})
  if (params.files.length === 0) throw new Error("Pick at least one document")

  const dependencies = { ...defaultCreateSendDependencies, ...dependencyOverrides }
  progress("Checking key-share holder")
  await preflightHolder(dependencies.fetch)

  const identity = await dependencies.getIdentity()

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
  const { reference } = await dependencies.uploadEncryptedBlob(blob)

  progress("Splitting key")
  // The content key is split, never wrapped-and-published. One half is derived
  // from the fragment; the other goes to a holder that can delete it. Nothing
  // secret is written to Arkiv, so there is nothing for calldata to preserve.
  const linkSecret = generateLinkSecret()
  const { heldShare, commitment } = await splitContentKey(contentKey, linkSecret)

  // Topping up the user's own key is bookkeeping, not a step they took. It is
  // deliberately not narrated: the previous stage label stays on screen.
  await ensureFunded(identity.address)

  progress("Writing grant to Arkiv")
  const fileKind = classifyBundle(params.files)
  const grant = await dependencies.createGrant({
    privateKey: identity.privateKey,
    payload: { v: 2, ref: reference, authCommitment: commitment },
    fileKind,
    recipientBlind: await blindAttribute(identity.blindKey, params.recipientLabel),
    labelBlind: await blindAttribute(identity.blindKey, params.files.map((f) => f.name).join("|")),
    fileCount: params.files.length,
    ttlSeconds: params.ttlSeconds,
  })

  // The share goes to the holder only once the grant exists, so the holder can
  // always resolve an entity key to a live grant. If this fails the send is
  // unreadable by anyone — including us — which is the correct failure.
  //
  // Proof of ownership is the same signed-entity-key scheme "End access now"
  // uses, with its own "share" action string — see lib/share.ts — so this
  // signature cannot be replayed against revoke or the access log, or vice
  // versa.
  progress("Handing the key share to the holder")
  const shareTimestamp = Math.floor(Date.now() / 1000)
  const sharePayload = {
    share: toBase64Url(heldShare),
    commitment,
    ttlSeconds: params.ttlSeconds,
  }
  const shareSignature = await privateKeyToAccount(identity.privateKey).signMessage({
    message: shareMessage(grant.entityKey, shareTimestamp, sharePayload),
  })
  const handoff = await dependencies.fetch("/api/holder/share", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      entityKey: grant.entityKey,
      ...sharePayload,
      signature: shareSignature,
      timestamp: shareTimestamp,
    }),
  })
  if (!handoff.ok) {
    const detail = await handoff.json().catch(() => ({}))
    throw new Error(
      `The grant was written but the key share was not stored, so this send cannot be opened: ${
        detail?.error ?? handoff.status
      }`,
    )
  }

  const url = `${window.location.origin}/s/${packEntityKey(grant.entityKey)}#${toBase64Url(
    linkSecret,
  )}`
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
  /** The sender ended this share early. Distinct from a lapsed grant — see H-29/H-35. */
  | { status: "revoked" }
  | { status: "no-key" }
  /** The holder is unreachable. Distinct from expiry, and must stay distinct. */
  | { status: "unavailable"; message: string }
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
  entityKeyOrShort: string,
  linkSecretB64: string,
): Promise<{ status: "ok"; send: OpenedSend } | OpenFailure> {
  if (!linkSecretB64) return { status: "no-key" }

  // Links carry the entity key in base64url; older ones carry hex. Both resolve
  // to the same 32 bytes.
  let entityKey: string
  try {
    entityKey = unpackEntityKey(entityKeyOrShort)
  } catch {
    return { status: "error", message: "This link does not contain a valid grant reference." }
  }

  let grant: Grant | null
  try {
    grant = await getGrant(entityKey)
  } catch (error) {
    if (error instanceof MalformedGrantError) {
      // The grant is live and we read it — the data itself is broken, which is a
      // concrete, nameable failure rather than an unknown one.
      return { status: "error", message: error.message }
    }
    // Anything else here — a wrong RPC URL, a proxy's error page, a timeout, a
    // query the node itself rejected — never confirmed the grant is gone. Saying
    // "expired" would tell the reader their access ended when in fact we cannot
    // tell, and the error screen's own copy ("the grant was found") would be a
    // claim we never verified either. Unavailable is the honest answer.
    return { status: "unavailable", message: (error as Error).message }
  }
  if (!grant) return { status: "expired" }

  try {
    // Check the boundary the engine enforces, not a wall clock.
    //
    // Honest-client hygiene, not enforcement: a reader who controls their own
    // browser can skip it, and anyone holding an archived copy of the grant
    // payload never asks us at all. It keeps the ordinary case truthful; the
    // cryptography does not depend on it.
    if (grant.expiresBlock > 0) {
      const head = await getCurrentBlock()
      if (Number(head) >= grant.expiresBlock) return { status: "expired" }
    }

    const linkSecret = fromBase64Url(linkSecretB64)

    let contentKey: Uint8Array
    if (grant.legacy) {
      // A v1 grant published its wrapped key on-chain. It still opens, and it
      // still cannot expire — which is exactly why the format changed.
      const wrap = (grant.payload as { wrap: { iv: string; ct: string } }).wrap
      contentKey = await unwrapContentKey(
        { iv: fromBase64Url(wrap.iv), ciphertext: fromBase64Url(wrap.ct) },
        linkSecret,
        grant.payload.ref,
      )
    } else {
      // Prove we hold the link, and ask the holder for the other half. Without
      // it there is no key to reconstruct — this is the expiry.
      const authKey = await deriveAuthKey(linkSecret)
      let response: Response
      try {
        response = await fetch("/api/holder/unlock", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ entityKey, authKey: toBase64Url(authKey) }),
        })
      } catch (error) {
        // The request never reached the holder, so there is no status and no body
        // to classify — the ordinary shape of an unreachable service, not of a
        // wrong link. Falling through to the generic catch below would report
        // this as a decryption failure, which is exactly the false claim this
        // story exists to remove.
        return { status: "unavailable", message: (error as Error).message }
      }

      if (response.status === 410) {
        // The holder tells the two apart (`lib/unlock.ts`); this is the one place
        // that flag is read back out, so the page can too.
        const detail = await response.json().catch(() => ({}))
        return detail?.revoked ? { status: "revoked" } : { status: "expired" }
      }
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}))
        // A holder we cannot reach is not an expiry. Saying so would tell the
        // reader their access ended when we simply do not know.
        if (detail?.retryable || response.status >= 500) {
          return { status: "unavailable", message: detail?.error ?? `HTTP ${response.status}` }
        }
        return { status: "error", message: detail?.error ?? `HTTP ${response.status}` }
      }

      const { share } = (await response.json()) as { share: string }
      contentKey = await joinContentKey(fromBase64Url(share), linkSecret)
    }

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

export type EndSendResult = { status: "ended" } | { status: "error"; message: string }

/**
 * End a share before its date.
 *
 * This deletes the holder's half of the content key, which is what makes the
 * link unjoinable — the Arkiv grant is left alone; this ends access, not
 * history. Proof of ownership is a signature from the sender's own derived
 * Arkiv key over the entity key, not a secret returned at create time: a
 * bearer secret would leak into logs and browser history, and anyone holding
 * it could end someone else's share.
 *
 * No UI calls this yet — the confirm sheet is separate work — but the send
 * primitives all live here, so this does too.
 */
export async function endSend(entityKey: string): Promise<EndSendResult> {
  const identity = await getIdentity()
  const timestamp = Math.floor(Date.now() / 1000)
  const account = privateKeyToAccount(identity.privateKey)
  const signature = await account.signMessage({ message: revokeMessage(entityKey, timestamp) })

  const response = await fetch("/api/holder/revoke", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ entityKey, signature, timestamp }),
  })

  if (!response.ok) {
    const detail = await response.json().catch(() => ({}))
    return { status: "error", message: detail?.error ?? `HTTP ${response.status}` }
  }
  return { status: "ended" }
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
