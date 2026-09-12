import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { getGrant } from "@/lib/arkiv"
import { isRevoked } from "@/lib/holder-store"
import {
  McpHttpInputError,
  noStoreJson,
  readBoundedJson,
  requestNetworkSubject,
  requestOriginAllowed,
} from "@/lib/mcp-http"
import { mcpCapabilityId, sha256Hex } from "@/lib/mcp-crypto"
import { authoriseMcpCapability } from "@/lib/mcp"
import { createHealthSendMcpServer, parseMcpBearer } from "@/lib/mcp-protocol"
import {
  consumeMcpRateLimit,
  getMcpCiphertext,
  mcpStoreConfigured,
  putMcpCiphertext,
} from "@/lib/mcp-store"

export const runtime = "nodejs"

const MAX_MCP_BODY_BYTES = 256 * 1024
const TOOL_RATE_POLICY = { windowSeconds: 60, blockSeconds: 60 }

export async function POST(request: Request): Promise<Response> {
  if (!requestOriginAllowed(request)) {
    return protocolError(403, -32001, "Cross-origin MCP requests are refused")
  }
  if (!mcpStoreConfigured()) {
    return protocolError(501, -32000, "No MCP ciphertext store is configured")
  }

  const bearerToken = parseMcpBearer(request)
  if (!bearerToken) return unauthorised()

  let capabilitySubject: string
  try {
    capabilitySubject = await mcpCapabilityId(bearerToken)
  } catch {
    return unauthorised()
  }
  const networkSubject = await sha256Hex(
    `healthsend:mcp:network:${requestNetworkSubject(request)}`,
  )

  try {
    // Both buckets are checked and incremented in one Lua operation. Rotating
    // fake tokens cannot bypass the network bucket, while a shared network
    // cannot let one real capability monopolise the route.
    const rate = await consumeMcpRateLimit(
      [
        { scope: "rpc-ip", subject: networkSubject, limit: 120 },
        { scope: "rpc-cap", subject: capabilitySubject, limit: 60 },
      ],
      TOOL_RATE_POLICY,
    )
    if (!rate.allowed) return tooManyRequests(rate.retryAfterSeconds)
  } catch {
    return protocolError(503, -32000, "The MCP abuse guard is unavailable")
  }

  const authorisation = await authoriseMcpCapability(bearerToken, {
    getGrant,
    isRevoked,
    putCiphertext: putMcpCiphertext,
    getCiphertext: getMcpCiphertext,
  })
  if (!authorisation.ok) {
    const code = [401, 403, 410].includes(authorisation.status) ? -32001 : -32000
    return protocolError(authorisation.status, code, authorisation.error)
  }

  let parsedBody: unknown
  try {
    parsedBody = await readBoundedJson(request, MAX_MCP_BODY_BYTES)
  } catch (error) {
    if (error instanceof McpHttpInputError) {
      return protocolError(error.status, error.status === 400 ? -32700 : -32000, error.message)
    }
    return protocolError(400, -32700, "Parse error")
  }

  const server = createHealthSendMcpServer(bearerToken, {
    getGrant,
    isRevoked,
    putCiphertext: putMcpCiphertext,
    getCiphertext: getMcpCiphertext,
  })
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })

  try {
    await server.connect(transport)
    const response = await transport.handleRequest(request, { parsedBody })
    const headers = new Headers(response.headers)
    headers.set("cache-control", "no-store")
    headers.set("x-content-type-options", "nosniff")
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  } catch {
    return protocolError(500, -32603, "The MCP request could not complete")
  } finally {
    await server.close().catch(() => {})
  }
}

function unauthorised(): Response {
  return protocolError(401, -32001, "A bearer capability is required", {
    "www-authenticate": 'Bearer realm="HealthSend MCP"',
  })
}

function tooManyRequests(retryAfterSeconds: number): Response {
  return protocolError(429, -32002, "MCP rate limit exceeded", {
    "retry-after": String(retryAfterSeconds),
  })
}

function protocolError(
  status: number,
  code: number,
  message: string,
  headers?: HeadersInit,
): Response {
  return noStoreJson(
    { jsonrpc: "2.0", id: null, error: { code, message } },
    { status, headers },
  )
}
