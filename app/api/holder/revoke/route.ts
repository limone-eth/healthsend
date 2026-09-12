/**
 * End a share before its date, by deleting the holder's half of the key.
 *
 * The authorisation and deletion logic lives in `lib/revoke.ts`, including
 * the signature check that proves the caller owns the grant. This route
 * only parses the request and translates the result to a response.
 */

import { NextResponse } from "next/server"
import { holderConfigured, tombstoneShare } from "@/lib/holder-store"
import { getGrant } from "@/lib/arkiv"
import { performRevoke, validateRevokeRequest } from "@/lib/revoke"

export async function POST(request: Request) {
  if (!holderConfigured()) {
    return NextResponse.json({ error: "No key-share holder is configured." }, { status: 501 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Expected JSON" }, { status: 400 })
  }

  const parsed = validateRevokeRequest(body)
  if (!parsed) {
    return NextResponse.json({ error: "Invalid revoke request" }, { status: 400 })
  }

  const result = await performRevoke(parsed, { getGrant, tombstoneShare })
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  return NextResponse.json({ ended: true })
}
