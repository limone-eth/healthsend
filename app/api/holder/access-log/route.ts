/**
 * "When they looked" — return the record of served unlocks to the grant's
 * sender only.
 *
 * Authorisation and the read itself live in `lib/access-log.ts`, which reuses
 * the signature scheme from `lib/revoke.ts`. This route only parses the
 * request and translates the result to a response.
 */

import { NextResponse } from "next/server"
import { holderConfigured, getAccessLog } from "@/lib/holder-store"
import { getGrant } from "@/lib/arkiv"
import { readAccessLog, validateAccessLogRequest } from "@/lib/access-log"

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

  const parsed = validateAccessLogRequest(body)
  if (!parsed) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const result = await readAccessLog(parsed, { getGrant, getAccessLog })
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  return NextResponse.json({ opened: result.opened, reliable: result.reliable })
}
