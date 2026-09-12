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
 *
 * `GET` is the preflight `createSend` calls before any of that — H-58/R3-003.
 * A `POST` with an invalid body is rejected by `validateShareRequest` before
 * `putShare` is ever reached, so it cannot prove the store itself is up. `GET`
 * pings the store directly and reports what actually happened: configured and
 * reachable, configured and down, or not configured at all.
 */

import { NextResponse } from "next/server"
import { holderConfigured, pingHolder, putShare } from "@/lib/holder-store"
import { getGrant } from "@/lib/arkiv"
import { performShare, validateShareRequest } from "@/lib/share"

export async function GET() {
  if (!holderConfigured()) {
    return NextResponse.json(
      { error: "No key-share holder is configured. See README, 'Why Swarm and Arkiv'." },
      { status: 501 },
    )
  }

  try {
    await pingHolder()
  } catch (error) {
    return NextResponse.json(
      { error: `Could not reach the key-share holder: ${(error as Error).message}` },
      { status: 503 },
    )
  }

  return NextResponse.json({ ok: true })
}

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
