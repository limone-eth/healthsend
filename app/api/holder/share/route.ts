/**
 * Accept the holder's half of a content key, once.
 *
 * The sender calls this immediately after writing the grant. It stores 32
 * random-looking bytes against a public entity key and nothing else — no
 * identity, no filename, no document, no way to know what it guards.
 *
 * Authorisation and the write itself live in `lib/share.ts`, which reuses
 * the signature scheme `lib/revoke.ts` established for "End access now".
 * This route only parses the request and translates the result to a
 * response.
 */

import { NextResponse } from "next/server"
import { holderConfigured, putShare } from "@/lib/holder-store"
import { getGrant } from "@/lib/arkiv"
import { performShare, validateShareRequest } from "@/lib/share"

export async function POST(request: Request) {
  if (!holderConfigured()) {
    return NextResponse.json(
      { error: "No key-share holder is configured. See README, 'Why Swarm and Arkiv'." },
      { status: 501 },
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Expected JSON" }, { status: 400 })
  }

  const parsed = validateShareRequest(body)
  if (!parsed) {
    return NextResponse.json({ error: "Invalid share submission" }, { status: 400 })
  }

  const result = await performShare(parsed, { getGrant, putShare })
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  return NextResponse.json({ stored: true })
}
