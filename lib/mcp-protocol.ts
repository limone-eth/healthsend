import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import * as z from "zod/v4"
import { callMcpTool, type CallMcpToolResult, type McpCoreDeps } from "./mcp.ts"

const annotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const

const recordId = z.string().min(1).max(256)
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

/** A fresh request-local MCP server for the stateless HTTP transport. */
export function createHealthSendMcpServer(
  bearerToken: string,
  deps: McpCoreDeps,
): McpServer {
  const server = new McpServer(
    { name: "healthsend", title: "HealthSend", version: "1.0.0" },
    {
      instructions:
        "Read only the records named by get_grant_scope. A request beyond that scope is refused, and every tool call is re-authorised against Arkiv.",
    },
  )

  server.registerTool(
    "get_grant_scope",
    {
      title: "Get grant scope",
      description:
        "Describe exactly which pseudonymous health records this grant permits, without returning measurements.",
      inputSchema: z.object({}).strict(),
      annotations,
    },
    async () => toolResult(await callMcpTool(bearerToken, "get_grant_scope", {}, deps)),
  )

  server.registerTool(
    "get_blood_panels",
    {
      title: "Get blood panels",
      description:
        "Read blood-panel measurements, units, reference ranges, and import flags from this grant's scoped records.",
      inputSchema: z
        .object({
          recordId: recordId
            .describe("Optional scoped blood-panel record id. Omit to return every permitted panel.")
            .optional(),
          markerIds: z
            .array(z.string().min(1).max(256))
            .min(1)
            .max(2_000)
            .describe("Optional marker ids within recordId. Requires recordId.")
            .optional(),
        })
        .strict()
        .refine((input) => !input.markerIds || Boolean(input.recordId), {
          message: "markerIds requires recordId",
          path: ["markerIds"],
        }),
      annotations,
    },
    async (args) => toolResult(await callMcpTool(bearerToken, "get_blood_panels", args, deps)),
  )

  server.registerTool(
    "query_wearable_range",
    {
      title: "Query wearable range",
      description:
        "Read one scoped wearable series over an inclusive range of at most 366 days. Requests beyond the granted range are refused.",
      inputSchema: z
        .object({
          recordId: recordId.describe("A wearable-series record id from get_grant_scope."),
          from: isoDate.describe("Inclusive ISO date (YYYY-MM-DD)."),
          through: isoDate.describe("Inclusive ISO date (YYYY-MM-DD)."),
        })
        .strict(),
      annotations,
    },
    async (args) =>
      toolResult(await callMcpTool(bearerToken, "query_wearable_range", args, deps)),
  )

  return server
}

export function parseMcpBearer(request: Request): string | null {
  const authorization = request.headers.get("authorization")
  if (!authorization) return null
  const match = /^Bearer ([A-Za-z0-9_-]+)$/.exec(authorization)
  return match?.[1] ?? null
}

function toolResult(result: CallMcpToolResult): CallToolResult {
  if (!result.ok) {
    return {
      content: [{ type: "text", text: result.error }],
      structuredContent: {
        error: {
          code: result.code,
          message: result.error,
          ...(result.retryable ? { retryable: true } : {}),
        },
      },
      isError: true,
    }
  }

  return {
    content: [{ type: "text", text: JSON.stringify(result.data) }],
    structuredContent: result.data,
  }
}
