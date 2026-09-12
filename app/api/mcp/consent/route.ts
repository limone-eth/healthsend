import { getGrant } from "@/lib/arkiv"
import { isRevoked } from "@/lib/holder-store"
import { noStoreJson, McpHttpInputError, readBoundedJson, requestNetworkSubject, requestOriginAllowed } from "@/lib/mcp-http"
import { mintMcpCapability, validateMcpConsentRequest } from "@/lib/mcp"
import { sha256Hex } from "@/lib/mcp-crypto"
import {
  consumeMcpRateLimit,
  getMcpCiphertext,
  mcpStoreConfigured,
  putMcpCiphertext,
} from "@/lib/mcp-store"

const MAX_CONSENT_BODY_BYTES = 2 * 1024 * 1024
const CONSENT_RATE_POLICY = { windowSeconds: 60, blockSeconds: 5 * 60 }

export async function POST(request: Request): Promise<Response> {
  if (!requestOriginAllowed(request)) {
    return noStoreJson({ error: "Cross-origin MCP consent is not allowed" }, { status: 403 })
  }
  if (!mcpStoreConfigured()) {
    return noStoreJson({ error: "No MCP ciphertext store is configured." }, { status: 501 })
  }

  const networkSubject = await sha256Hex(
    `healthsend:mcp:network:${requestNetworkSubject(request)}`,
  )
  try {
    const rate = await consumeMcpRateLimit(
      [{ scope: "consent-ip", subject: networkSubject, limit: 10 }],
      CONSENT_RATE_POLICY,
    )
    if (!rate.allowed) {
      return noStoreJson(
        { error: "Too many consent attempts. Try again later." },
        { status: 429, headers: { "retry-after": String(rate.retryAfterSeconds) } },
      )
    }
  } catch {
    return noStoreJson(
      { error: "The MCP abuse guard is unavailable", retryable: true },
      { status: 503 },
    )
  }

  let body: unknown
  try {
    body = await readBoundedJson(request, MAX_CONSENT_BODY_BYTES)
  } catch (error) {
    if (error instanceof McpHttpInputError) {
      return noStoreJson({ error: error.message }, { status: error.status })
    }
    return noStoreJson({ error: "Expected valid JSON" }, { status: 400 })
  }

  const consent = validateMcpConsentRequest(body)
  if (!consent) {
    return noStoreJson({ error: "Invalid MCP consent request" }, { status: 400 })
  }

  const result = await mintMcpCapability(consent, {
    getGrant,
    isRevoked,
    putCiphertext: putMcpCiphertext,
    getCiphertext: getMcpCiphertext,
  })
  if (!result.ok) {
    return noStoreJson(
      {
        error: result.error,
        code: result.code,
        ...(result.retryable ? { retryable: true } : {}),
      },
      { status: result.status },
    )
  }

  return noStoreJson(
    {
      capabilityToken: result.capabilityToken,
      pseudonym: result.pseudonym,
      expiresAt: result.expiresAt,
      mcpEndpoint: new URL("/api/mcp", request.url).toString(),
    },
    { status: 201 },
  )
}
