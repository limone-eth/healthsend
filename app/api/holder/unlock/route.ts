/**
 * Hand back the holder's half — but only while Arkiv says the grant is live.
 *
 * The decision logic lives in `lib/unlock.ts`, including the two properties
 * that must survive any change here: no internal timer (Arkiv is asked, not
 * clocked) and a constant-time commitment compare. This route only parses
 * the request and translates the result to a response.
 */

import { NextResponse } from "next/server"
import { holderConfigured, getShare, serveShare, isRevoked, checkCode } from "@/lib/holder-store"
import { getGrant } from "@/lib/arkiv"
import { resolveUnlock } from "@/lib/unlock"

const CODE_PROOF_RE = /^[0-9a-f]{64}$/

export async function POST(request: Request) {
  if (!holderConfigured()) {
    return NextResponse.json({ error: "No key-share holder is configured." }, { status: 501 })
  }

  let body: { entityKey?: string; authKey?: string; codeProof?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Expected JSON" }, { status: 400 })
  }

  const { entityKey, authKey, codeProof } = body
  if (!entityKey || !/^0x[0-9a-fA-F]{64}$/.test(entityKey) || !authKey) {
    return NextResponse.json({ error: "Invalid unlock request" }, { status: 400 })
  }
  if (codeProof !== undefined && !CODE_PROOF_RE.test(codeProof)) {
    return NextResponse.json({ error: "Invalid unlock request" }, { status: 400 })
  }

  const result = await resolveUnlock(
    entityKey,
    authKey,
    { getGrant, getShare, serveShare, isRevoked, checkCode },
    codeProof ?? "",
  )
  if (!result.ok) {
    const payload: Record<string, unknown> = { error: result.error }
    if (result.retryable) payload.retryable = true
    // Exposed for a reader-facing distinction (H-35); not rendered here.
    if (result.revoked !== undefined) payload.revoked = result.revoked
    // H-7: exposed for the same reason — openSend turns these into their own
    // "needs-code" / "wrong-code" statuses, never the generic decrypt failure.
    if (result.codeRequired) payload.codeRequired = true
    if (result.wrongCode) payload.wrongCode = true
    if (result.locked) payload.locked = true
    return NextResponse.json(payload, { status: result.status })
  }

  return NextResponse.json({ share: result.share, expiresAt: result.expiresAt })
}
