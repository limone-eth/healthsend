"use client"

/**
 * Swarm ID + Swarm storage.
 *
 * Two distinct paths on purpose:
 *
 *   Sender   — signed in with Swarm ID. Uploads go through SwarmIdClient, which
 *              runs in a cross-origin iframe holding the user's keys and signs
 *              postage stamps in the browser. No Bee node of ours, no server of
 *              ours, and our origin never sees key material.
 *
 *   Recipient — has no Swarm ID and no wallet. Reads go over a plain public
 *              gateway by content hash. This is what keeps the recipient
 *              experience "open a link", and it is safe because the bytes on
 *              Swarm are ciphertext.
 */

import type { SwarmIdClient, ConnectionInfo, UploadResult } from "@snaha/swarm-id"

export const SWARM_ID_ORIGIN =
  process.env.NEXT_PUBLIC_SWARM_ID_ORIGIN ?? "https://swarm-id.snaha.net"

export const SWARM_GATEWAY =
  process.env.NEXT_PUBLIC_SWARM_GATEWAY ?? "https://download.gateway.ethswarm.org"

/** Optional gateway that stamps server-side for users who hold no postage batch. */
const SUBSIDISED_GATEWAY = process.env.NEXT_PUBLIC_SWARM_SUBSIDISED_GATEWAY

let clientPromise: Promise<SwarmIdClient> | null = null
const listeners = new Set<(info: ConnectionInfo) => void>()
let lastInfo: ConnectionInfo = { canUpload: false }

export function onConnectionChange(listener: (info: ConnectionInfo) => void): () => void {
  listeners.add(listener)
  listener(lastInfo)

  // Subscribing has to *start* the client, not just wait for it.
  //
  // The iframe is what holds the session and reports it back, so until it is
  // mounted nothing can tell us the user is already signed in — the page would
  // render "Sign in" forever and only recover when some other call happened to
  // construct the client. An existing session is restored by mounting the
  // iframe, so a returning user lands signed in rather than being asked again.
  void getSwarmClient().catch(() => {
    /* Surfaced through connectionInfo staying signed-out; nothing to do here. */
  })

  return () => listeners.delete(listener)
}

/**
 * The SDK is browser-only (it builds an iframe on construction), so it is
 * imported dynamically and memoised rather than instantiated at module scope.
 */
export function getSwarmClient(): Promise<SwarmIdClient> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Swarm ID is browser-only"))
  }
  if (!clientPromise) {
    clientPromise = (async () => {
      const { SwarmIdClient: Client } = await import("@snaha/swarm-id")
      const client = new Client({
        iframeOrigin: SWARM_ID_ORIGIN,
        metadata: {
          name: "HealthSend",
          description: "Share health data that expires on its own.",
        },
        ...(SUBSIDISED_GATEWAY ? { subsidisedGatewayUrl: SUBSIDISED_GATEWAY } : {}),
        onConnectionChange: (info) => {
          lastInfo = info
          for (const listener of listeners) listener(info)
        },
      })
      await client.initialize()
      return client
    })()
  }
  return clientPromise
}

export async function connect(): Promise<void> {
  const client = await getSwarmClient()
  await client.connect()
}

export async function disconnect(): Promise<void> {
  const client = await getSwarmClient()
  await client.disconnect()
}

/**
 * A secret derived from the user's Swarm ID, scoped to this app.
 *
 * This is the root of every other key the app holds: the Arkiv signing key and
 * the HMAC key that blinds queryable attributes. Deriving rather than storing is
 * what lets a user sign in on a second device and find their sends waiting,
 * with no user database anywhere.
 */
export async function deriveAppSecret(label: string): Promise<Uint8Array> {
  const client = await getSwarmClient()
  return client.deriveAppSecret(label)
}

export async function uploadEncryptedBlob(ciphertext: Uint8Array): Promise<UploadResult> {
  const client = await getSwarmClient()
  return client.uploadData(ciphertext)
}

/** Recipient-side read: public gateway, content hash, no identity required. */
export async function fetchBlobFromGateway(reference: string): Promise<Uint8Array> {
  const response = await fetch(`${SWARM_GATEWAY}/bytes/${reference}`)
  if (!response.ok) {
    throw new Error(`Swarm gateway returned ${response.status} for ${reference}`)
  }
  return new Uint8Array(await response.arrayBuffer())
}

export type { ConnectionInfo }
