"use client"

import { getSwarmClient } from "./swarm"

/**
 * The manifest for one sender's archive is an identity-owned Swarm epoch feed.
 * Its latest update contains only the immutable Swarm reference of the current
 * encrypted archive chunk. The topic is derived from the same signed-in
 * identity, so another device can recover the reference without local state.
 */
export async function readArchiveReference(topic: Uint8Array): Promise<string | null> {
  const client = await getSwarmClient()
  const feed = client.makeEpochFeedWriter({ topic })
  const { reference } = await feed.downloadRawReference()
  if (!reference) return null
  return reference.replace(/^0x/, "")
}

/** Publish a new current chunk only after its encrypted bytes exist on Swarm. */
export async function writeArchiveReference(topic: Uint8Array, reference: string): Promise<void> {
  if (!/^[0-9a-f]{64}$/i.test(reference)) throw new Error("Invalid archive Swarm reference")
  const client = await getSwarmClient()
  const feed = client.makeEpochFeedWriter({ topic })
  await feed.uploadRawReference(reference)
}
