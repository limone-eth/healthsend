/**
 * Hand back the holder's half — but only while Arkiv says the grant is live.
 *
 * This route is the point of the whole architecture, so it is worth being
 * explicit about what it does and does not decide.
 *
 * It does **not** keep its own timer. It asks Arkiv whether the grant entity
 * still exists, and Arkiv's answer is not ours to give: grants are `ownedBy` the
 * sender's key, so we cannot forge one, backdate one, or quietly un-expire one,
 * and the recipient can verify the same fact from the same public chain. The
 * holder has the *means* to complete a key and no *authority* over whether it
 * should; Arkiv has the authority and holds no secret. A gatekeeper needs both.
 *
 * The caller proves it holds the link by sending an auth key derived from the
 * URL fragment. We compare its hash against the commitment written into the
 * grant. Learning that value gains us nothing: the decryption half is derived
 * separately and never leaves the recipient's browser.
 */

import { NextResponse } from "next/server"
import { holderConfigured, getShare } from "@/lib/holder-store"
import { getGrant } from "@/lib/arkiv"

function sha256Hex(input: Uint8Array): Promise<string> {
  return crypto.subtle
    .digest("SHA-256", input as BufferSource)
    .then((d) =>
      Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join(""),
    )
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/")
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="))
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}

/** Constant-time compare, so a wrong guess leaks nothing through timing. */
function equal(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export async function POST(request: Request) {
  if (!holderConfigured()) {
    return NextResponse.json({ error: "No key-share holder is configured." }, { status: 501 })
  }

  let body: { entityKey?: string; authKey?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Expected JSON" }, { status: 400 })
  }

  const { entityKey, authKey } = body
  if (!entityKey || !/^0x[0-9a-fA-F]{64}$/.test(entityKey) || !authKey) {
    return NextResponse.json({ error: "Invalid unlock request" }, { status: 400 })
  }

  // 1. Ask Arkiv. A missing grant is expiry, and it is the end of the matter.
  let grant
  try {
    grant = await getGrant(entityKey)
  } catch (error) {
    // We could not reach the chain, so we cannot tell. Saying "expired" here
    // would assert something we do not know.
    return NextResponse.json(
      { error: `Could not reach Arkiv: ${(error as Error).message}`, retryable: true },
      { status: 503 },
    )
  }
  if (!grant) {
    return NextResponse.json({ error: "expired" }, { status: 410 })
  }

  // 2. The share may outlive the grant by its grace period. Arkiv decides.
  const stored = await getShare(entityKey)
  if (!stored) {
    return NextResponse.json({ error: "expired" }, { status: 410 })
  }

  // 3. Prove the caller holds the link.
  let presented: string
  try {
    presented = await sha256Hex(fromBase64Url(authKey))
  } catch {
    return NextResponse.json({ error: "Invalid auth key" }, { status: 400 })
  }
  if (!equal(presented, stored.commitment) || !equal(stored.commitment, grant.authCommitment)) {
    return NextResponse.json({ error: "Not authorised for this grant" }, { status: 403 })
  }

  return NextResponse.json({ share: stored.share, expiresAt: grant.expiresAt })
}
