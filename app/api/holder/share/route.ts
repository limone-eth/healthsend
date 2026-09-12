/**
 * Accept the holder's half of a content key, once.
 *
 * The sender calls this immediately after writing the grant. It stores 32
 * random-looking bytes against a public entity key and nothing else — no
 * identity, no filename, no document, no way to know what it guards.
 */

import { NextResponse } from "next/server"
import { holderConfigured, putShare } from "@/lib/holder-store"

export async function POST(request: Request) {
  if (!holderConfigured()) {
    return NextResponse.json(
      { error: "No key-share holder is configured. See README, 'Why Swarm and Arkiv'." },
      { status: 501 },
    )
  }

  let body: { entityKey?: string; share?: string; commitment?: string; ttlSeconds?: number }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Expected JSON" }, { status: 400 })
  }

  const { entityKey, share, commitment, ttlSeconds } = body
  if (
    !entityKey ||
    !/^0x[0-9a-fA-F]{64}$/.test(entityKey) ||
    !share ||
    !commitment ||
    !/^[0-9a-f]{64}$/.test(commitment) ||
    typeof ttlSeconds !== "number" ||
    ttlSeconds <= 0
  ) {
    return NextResponse.json({ error: "Invalid share submission" }, { status: 400 })
  }

  // Refuse a second write for the same entity. Otherwise anyone could replace a
  // live share and lock the real recipient out — or substitute one of their own.
  const stored = await putShare(entityKey, { share, commitment }, ttlSeconds)
  if (!stored) {
    return NextResponse.json({ error: "A share already exists for this grant" }, { status: 409 })
  }

  return NextResponse.json({ stored: true })
}
