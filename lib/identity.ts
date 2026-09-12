"use client"

/**
 * Keys, all of them derived from the Swarm ID the user signed in with.
 *
 * There is no user database in this app, so anything per-user has to be
 * reproducible from the identity alone. Swarm ID gives us `deriveAppSecret`,
 * an app-scoped secret derived inside its iframe, and every key below hangs off
 * it under a distinct label:
 *
 *   arkiv/v1  → the signing key that owns the user's grant entities
 *   blind/v1  → the HMAC key that makes queryable attributes opaque
 *
 * Sign in on a second device and the same keys come back, which is what makes
 * "my sends are waiting for me" work without a server remembering anything.
 */

import { keccak256, type Hex } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { deriveAppSecret } from "./swarm"

export type Identity = {
  /** Arkiv signing key. Owns every grant this user writes. */
  privateKey: Hex
  /** Its address — the `ownedBy` filter for the dashboard query. */
  address: Hex
  /** HMAC key for blinding attribute values. */
  blindKey: Uint8Array
}

let cached: Identity | null = null

export async function getIdentity(): Promise<Identity> {
  if (cached) return cached

  const arkivSeed = await deriveAppSecret("healthsend/arkiv/v1")
  const blindKey = await deriveAppSecret("healthsend/blind/v1")

  // keccak of the derived secret gives a well-formed 32-byte scalar without
  // handing the raw app secret to a library that might log or persist it.
  const privateKey = keccak256(arkivSeed as Uint8Array)
  const address = privateKeyToAccount(privateKey).address

  cached = { privateKey, address, blindKey }
  return cached
}

export function forgetIdentity(): void {
  cached = null
}

/**
 * Arkiv writes are chain transactions, so the derived key needs gas.
 *
 * The key is the user's, not ours — we only ask the faucet route to top it up
 * when it is empty. Keeping the key user-owned is what lets grants be genuinely
 * `ownedBy` the sender rather than by a shared app wallet, which in turn is what
 * makes the dashboard's ownership filter mean anything.
 */
export async function ensureFunded(address: Hex): Promise<{ funded: boolean; reason?: string }> {
  const response = await fetch("/api/fund", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address }),
  })
  const body = await response.json()
  if (!response.ok) return { funded: false, reason: body?.error ?? `HTTP ${response.status}` }
  return { funded: true, ...body }
}
