export class McpHttpInputError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = "McpHttpInputError"
    this.status = status
  }
}

/** Read a JSON body without allowing an unbounded request into memory. */
export async function readBoundedJson(request: Request, maxBytes: number): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase()
  if (contentType !== "application/json") {
    throw new McpHttpInputError(415, "Expected application/json")
  }

  const declaredLength = Number(request.headers.get("content-length"))
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new McpHttpInputError(413, "Request body is too large")
  }

  if (!request.body) throw new McpHttpInputError(400, "Expected JSON")
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > maxBytes) {
        await reader.cancel().catch(() => {})
        throw new McpHttpInputError(413, "Request body is too large")
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    return JSON.parse(text) as unknown
  } catch (error) {
    if (error instanceof McpHttpInputError) throw error
    throw new McpHttpInputError(400, "Expected valid JSON")
  }
}

export function requestOriginAllowed(request: Request): boolean {
  const origin = request.headers.get("origin")
  if (!origin) return true

  try {
    const source = new URL(origin)
    const destination = new URL(request.url)
    return source.protocol === destination.protocol && source.host === destination.host
  } catch {
    return false
  }
}

export function requestNetworkSubject(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim()
  return (forwarded || request.headers.get("x-real-ip")?.trim() || "unknown").slice(0, 128)
}

export function noStoreJson(
  body: unknown,
  init: { status?: number; headers?: HeadersInit } = {},
): Response {
  const headers = new Headers(init.headers)
  headers.set("content-type", "application/json; charset=utf-8")
  headers.set("cache-control", "no-store")
  headers.set("x-content-type-options", "nosniff")
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers })
}
