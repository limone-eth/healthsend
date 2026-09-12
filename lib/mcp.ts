import type { Grant } from "./arkiv.ts"
import {
  openScopedShare,
  type ScopedShare,
  type SharedBloodPanelRecord,
  type SharedRecord,
  type SharedWearableSeriesRecord,
} from "./archive.ts"
import {
  capabilityKeyFromToken,
  createMcpCapabilityToken,
  decryptMcpEnvelope,
  deriveMcpPseudonym,
  encryptMcpEnvelope,
  equalMcpPseudonym,
  mcpCapabilityId,
  mcpMintId,
} from "./mcp-crypto.ts"
import type { StoredMcpCiphertext } from "./mcp-store.ts"
import {
  recoverSigner,
  REVOKE_SIGNATURE_WINDOW_SECONDS,
  validateSignedEntityRequest,
  type SignedEntityRequest,
} from "./revoke.ts"

const ENTITY_KEY_RE = /^0x[0-9a-f]{64}$/
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MAX_SCOPED_RECORDS = 100
const MAX_SCOPED_MARKERS = 2_000
const MAX_SCOPED_WEARABLE_VALUES = 20_000
const MAX_WEARABLE_QUERY_DAYS = 366
const MAX_MINT_ATTEMPTS = 3

export type McpGrant = Pick<Grant, "sender" | "expiresAt">

export type McpPutResult = "stored" | "replayed" | "collision"

export type McpCoreDeps = {
  getGrant: (entityKey: string) => Promise<McpGrant | null>
  isRevoked?: (entityKey: string) => Promise<boolean>
  putCiphertext: (
    capabilityId: string,
    mintId: string,
    value: StoredMcpCiphertext,
    ttlSeconds: number,
    consentTtlSeconds: number,
  ) => Promise<McpPutResult>
  getCiphertext: (capabilityId: string) => Promise<StoredMcpCiphertext | null>
  now?: () => number
  randomBytes?: (length: number) => Uint8Array
}

export type McpFailure = {
  ok: false
  status: number
  code: string
  error: string
  retryable?: boolean
}

export type MintMcpResult =
  | {
      ok: true
      capabilityToken: string
      pseudonym: string
      expiresAt: number
    }
  | McpFailure

export type CallMcpToolResult =
  | { ok: true; data: Record<string, unknown> }
  | McpFailure

export type McpConsentRequest = SignedEntityRequest & { scopedShare: ScopedShare }

export function validateMcpConsentRequest(value: unknown): McpConsentRequest | null {
  if (!isObject(value)) return null
  const allowed = new Set(["entityKey", "signature", "timestamp", "scopedShare"])
  if (Object.keys(value).some((key) => !allowed.has(key))) return null

  const signed = validateSignedEntityRequest(value)
  if (!signed || !("scopedShare" in value)) return null

  let scopedShare: ScopedShare
  try {
    scopedShare = openScopedShare(new TextEncoder().encode(JSON.stringify(value.scopedShare)))
    assertShareSize(scopedShare)
  } catch {
    return null
  }
  return { ...signed, scopedShare }
}

/** Mint once from a browser-held sender signature; never persist the returned AES bearer key. */
export async function mintMcpCapability(
  request: McpConsentRequest,
  deps: McpCoreDeps,
): Promise<MintMcpResult> {
  const now = deps.now?.() ?? Math.floor(Date.now() / 1000)
  let firstGrant: McpGrant | null
  try {
    firstGrant = await deps.getGrant(request.entityKey)
  } catch (error) {
    return arkivUnavailable(error)
  }
  if (!firstGrant) return expiredFailure()

  const recovered = await recoverSigner("mcp", request)
  if (!recovered.ok) {
    return { ok: false, status: recovered.status, code: "invalid_signature", error: recovered.error }
  }
  if (!sameAddress(recovered.signer, firstGrant.sender)) {
    return {
      ok: false,
      status: 403,
      code: "not_authorised",
      error: "Not authorised to create an MCP capability for this grant",
    }
  }

  // Re-read after signature recovery. An entity can lapse while the signature is
  // being checked; only a still-live Arkiv result may reach protected storage.
  let grant: McpGrant | null
  try {
    grant = await deps.getGrant(request.entityKey)
  } catch (error) {
    return arkivUnavailable(error)
  }
  if (!grant) return expiredFailure()
  try {
    if (deps.isRevoked && (await deps.isRevoked(request.entityKey))) {
      return expiredFailure()
    }
  } catch (error) {
    return storageUnavailable(error)
  }
  if (!sameAddress(recovered.signer, grant.sender)) {
    return {
      ok: false,
      status: 403,
      code: "not_authorised",
      error: "Not authorised to create an MCP capability for this grant",
    }
  }

  const ttlSeconds = Math.max(1, grant.expiresAt - now)
  // Freshness is symmetric, so a timestamp five minutes in the future can stay
  // valid for ten minutes from now. Claim the signature until its exact latest
  // valid instant, not merely for one nominal window.
  const consentTtlSeconds = Math.max(
    1,
    request.timestamp + REVOKE_SIGNATURE_WINDOW_SECONDS - now,
  )
  const mintId = await mcpMintId(request.signature)

  for (let attempt = 0; attempt < MAX_MINT_ATTEMPTS; attempt++) {
    const capabilityToken = createMcpCapabilityToken(deps.randomBytes)
    const capabilityId = await mcpCapabilityId(capabilityToken)
    const capabilityKey = capabilityKeyFromToken(capabilityToken)
    const pseudonym = await deriveMcpPseudonym(
      capabilityKey,
      request.entityKey,
      grant.sender,
    )
    const encrypted = await encryptMcpEnvelope(
      {
        v: 1,
        kind: "healthsend-mcp-capability",
        entityKey: request.entityKey,
        pseudonym,
        scopedShare: request.scopedShare,
      },
      capabilityToken,
      capabilityId,
    )

    let stored: McpPutResult
    try {
      stored = await deps.putCiphertext(
        capabilityId,
        mintId,
        encrypted,
        ttlSeconds,
        consentTtlSeconds,
      )
    } catch (error) {
      return storageUnavailable(error)
    }
    if (stored === "replayed") {
      return {
        ok: false,
        status: 409,
        code: "signature_already_used",
        error: "This signed consent has already minted an MCP capability",
      }
    }
    if (stored === "stored") {
      return { ok: true, capabilityToken, pseudonym, expiresAt: grant.expiresAt }
    }
  }

  return {
    ok: false,
    status: 503,
    code: "capability_collision",
    error: "Could not allocate an MCP capability",
    retryable: true,
  }
}

/**
 * Gate protocol responses that do not execute a tool (initialize, discovery and
 * notifications) as well as tool calls. The public entity key is the only
 * routing metadata read before Arkiv; no scoped plaintext is decrypted here.
 */
export async function authoriseMcpCapability(
  token: string,
  deps: McpCoreDeps,
): Promise<{ ok: true } | McpFailure> {
  let capabilityId: string
  try {
    capabilityId = await mcpCapabilityId(token)
  } catch {
    return invalidCapabilityFailure()
  }

  let stored: StoredMcpCiphertext | null
  try {
    stored = await deps.getCiphertext(capabilityId)
  } catch (error) {
    return storageUnavailable(error)
  }
  if (
    !stored ||
    stored.v !== 1 ||
    typeof stored.entityKey !== "string" ||
    !isMcpEntityKey(stored.entityKey)
  ) {
    return invalidCapabilityFailure()
  }

  let grant: McpGrant | null
  try {
    grant = await deps.getGrant(stored.entityKey)
  } catch (error) {
    return arkivUnavailable(error)
  }
  if (!grant) return expiredFailure()

  try {
    if (deps.isRevoked && (await deps.isRevoked(stored.entityKey))) {
      return expiredFailure()
    }
  } catch (error) {
    return storageUnavailable(error)
  }

  return { ok: true }
}

/**
 * Open one encrypted scoped slice and ask Arkiv again before dispatching one
 * tool. No caller can reuse an earlier live-grant decision for a later call.
 */
export async function callMcpTool(
  token: string,
  toolName: string,
  args: unknown,
  deps: McpCoreDeps,
): Promise<CallMcpToolResult> {
  let capabilityId: string
  try {
    capabilityId = await mcpCapabilityId(token)
  } catch {
    return invalidCapabilityFailure()
  }

  let stored: StoredMcpCiphertext | null
  try {
    stored = await deps.getCiphertext(capabilityId)
  } catch (error) {
    return storageUnavailable(error)
  }
  if (
    !stored ||
    stored.v !== 1 ||
    typeof stored.entityKey !== "string" ||
    !isMcpEntityKey(stored.entityKey)
  ) {
    return invalidCapabilityFailure()
  }

  // The only plaintext routing field is the public Arkiv entity key. Ask Arkiv
  // and the revoke tombstone before decrypting any health record.
  let grant: McpGrant | null
  try {
    grant = await deps.getGrant(stored.entityKey)
  } catch (error) {
    return arkivUnavailable(error)
  }
  if (!grant) return expiredFailure()

  try {
    if (deps.isRevoked && (await deps.isRevoked(stored.entityKey))) {
      return expiredFailure()
    }
  } catch (error) {
    return storageUnavailable(error)
  }

  let envelope
  try {
    envelope = await decryptMcpEnvelope(stored, token, capabilityId)
  } catch {
    return invalidCapabilityFailure()
  }

  // Match unlock's revoke-race discipline, and tighten it for an at-rest copy
  // that is not itself deleted on revoke: ask both authorities again after
  // decryption, immediately before any scoped value is returned.
  try {
    grant = await deps.getGrant(stored.entityKey)
  } catch (error) {
    return arkivUnavailable(error)
  }
  if (!grant) return expiredFailure()
  try {
    if (deps.isRevoked && (await deps.isRevoked(stored.entityKey))) {
      return expiredFailure()
    }
  } catch (error) {
    return storageUnavailable(error)
  }

  const expectedPseudonym = await deriveMcpPseudonym(
    capabilityKeyFromToken(token),
    envelope.entityKey,
    grant.sender,
  )
  if (!equalMcpPseudonym(expectedPseudonym, envelope.pseudonym)) {
    return {
      ok: false,
      status: 403,
      code: "grant_owner_mismatch",
      error: "The capability no longer matches the live grant owner",
    }
  }

  try {
    return {
      ok: true,
      data: executeScopedTool(
        toolName,
        args,
        envelope.scopedShare.records,
        envelope.pseudonym,
        grant.expiresAt,
      ),
    }
  } catch (error) {
    if (error instanceof ToolFailure) {
      return { ok: false, status: error.status, code: error.code, error: error.message }
    }
    return {
      ok: false,
      status: 500,
      code: "tool_failed",
      error: "The MCP tool could not complete",
    }
  }
}

function executeScopedTool(
  toolName: string,
  args: unknown,
  records: SharedRecord[],
  pseudonym: string,
  expiresAt: number,
): Record<string, unknown> {
  if (toolName === "get_grant_scope") {
    assertArguments(args, [])
    return {
      subject: pseudonym,
      expiresAt,
      records: records.map(scopeDescription),
    }
  }

  if (toolName === "get_blood_panels") {
    const input = assertArguments(args, ["recordId", "markerIds"])
    const recordId = optionalText(input.recordId, "recordId")
    const markerIds = optionalTextArray(input.markerIds, "markerIds")
    if (markerIds && !recordId) {
      throw new ToolFailure(400, "invalid_arguments", "markerIds requires recordId")
    }

    let panels = records.filter(isBloodPanel)
    if (panels.length === 0) {
      refuseScope("Blood panels are outside this grant's scope")
    }
    if (recordId) {
      const panel = panels.find((record) => record.id === recordId)
      if (!panel) refuseScope(`Blood panel ${recordId} is outside this grant's scope`)
      panels = [panel]
    }

    const output = panels.map((panel) => {
      let markers = panel.markers
      if (markerIds) {
        const available = new Set(markers.map((marker) => marker.id))
        const missing = markerIds.find((markerId) => !available.has(markerId))
        if (missing) refuseScope(`Marker ${missing} is outside this grant's scope`)
        const requested = new Set(markerIds)
        markers = markers.filter((marker) => requested.has(marker.id))
      }
      return {
        id: panel.id,
        kind: panel.kind,
        takenOn: panel.takenOn,
        markers: markers.map((marker) => ({
          id: marker.id,
          name: marker.name,
          value: marker.value,
          unit: marker.unit,
          referenceRange: { ...marker.referenceRange },
          flaggedAtImport: marker.flaggedAtImport,
        })),
      }
    })

    return { subject: pseudonym, panels: output }
  }

  if (toolName === "query_wearable_range") {
    const input = assertArguments(args, ["recordId", "from", "through"])
    const recordId = requiredText(input.recordId, "recordId")
    const from = requiredIsoDate(input.from, "from")
    const through = requiredIsoDate(input.through, "through")
    if (from > through) {
      throw new ToolFailure(400, "invalid_arguments", "The requested date range is reversed")
    }
    const spanDays =
      Math.floor(
        (Date.parse(`${through}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) /
          86_400_000,
      ) + 1
    if (spanDays > MAX_WEARABLE_QUERY_DAYS) {
      throw new ToolFailure(
        400,
        "request_too_large",
        `Refused: A wearable query may span at most ${MAX_WEARABLE_QUERY_DAYS} days`,
      )
    }

    const series = records.filter(isWearableSeries).find((record) => record.id === recordId)
    if (!series) refuseScope(`Wearable series ${recordId} is outside this grant's scope`)
    if (from < series.range.from || through > series.range.through) {
      refuseScope(
        `Requested range ${from} through ${through} is outside this grant's scoped range`,
      )
    }

    return {
      subject: pseudonym,
      series: {
        id: series.id,
        kind: series.kind,
        metric: series.metric,
        unit: series.unit,
        range: { from, through },
        ...(series.target === undefined ? {} : { target: series.target }),
        values: series.values
          .filter((point) => point.date >= from && point.date <= through)
          .map((point) => ({ date: point.date, value: point.value })),
      },
    }
  }

  throw new ToolFailure(404, "unknown_tool", `Unknown MCP tool: ${toolName}`)
}

function scopeDescription(record: SharedRecord): Record<string, unknown> {
  if (record.kind === "blood-panel") {
    return {
      id: record.id,
      kind: record.kind,
      takenOn: record.takenOn,
      markers: record.markers.map((marker) => ({
        id: marker.id,
        name: marker.name,
        unit: marker.unit,
        referenceRange: { ...marker.referenceRange },
      })),
    }
  }
  return {
    id: record.id,
    kind: record.kind,
    metric: record.metric,
    unit: record.unit,
    range: { ...record.range },
    ...(record.target === undefined ? {} : { target: record.target }),
  }
}

function assertShareSize(share: ScopedShare): void {
  if (share.records.length > MAX_SCOPED_RECORDS) throw new Error("Too many scoped records")
  let markers = 0
  let wearableValues = 0
  for (const record of share.records) {
    if (record.kind === "blood-panel") markers += record.markers.length
    else wearableValues += record.values.length
  }
  if (markers > MAX_SCOPED_MARKERS) throw new Error("Too many scoped markers")
  if (wearableValues > MAX_SCOPED_WEARABLE_VALUES) {
    throw new Error("Too many scoped wearable values")
  }
}

function assertArguments(value: unknown, allowed: string[]): Record<string, unknown> {
  if (value === undefined) return {}
  if (!isObject(value)) {
    throw new ToolFailure(400, "invalid_arguments", "Tool arguments must be an object")
  }
  const allowedKeys = new Set(allowed)
  const extra = Object.keys(value).find((key) => !allowedKeys.has(key))
  if (extra) throw new ToolFailure(400, "invalid_arguments", `Unknown tool argument: ${extra}`)
  return value
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 256) {
    throw new ToolFailure(400, "invalid_arguments", `Invalid ${label}`)
  }
  return value
}

function optionalText(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : requiredText(value, label)
}

function optionalTextArray(value: unknown, label: string): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length === 0 || value.length > 2_000) {
    throw new ToolFailure(400, "invalid_arguments", `Invalid ${label}`)
  }
  const output = value.map((item) => requiredText(item, label))
  if (new Set(output).size !== output.length) {
    throw new ToolFailure(400, "invalid_arguments", `${label} contains duplicates`)
  }
  return output
}

function requiredIsoDate(value: unknown, label: string): string {
  const text = requiredText(value, label)
  if (!ISO_DATE_RE.test(text)) {
    throw new ToolFailure(400, "invalid_arguments", `Invalid ${label}`)
  }
  const parsed = new Date(`${text}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    throw new ToolFailure(400, "invalid_arguments", `Invalid ${label}`)
  }
  return text
}

function refuseScope(message: string): never {
  throw new ToolFailure(403, "out_of_scope", `Refused: ${message}`)
}

class ToolFailure extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = "ToolFailure"
    this.status = status
    this.code = code
  }
}

function isBloodPanel(record: SharedRecord): record is SharedBloodPanelRecord {
  return record.kind === "blood-panel"
}

function isWearableSeries(record: SharedRecord): record is SharedWearableSeriesRecord {
  return record.kind === "wearable-series"
}

function sameAddress(left: string, right: string): boolean {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase())
}

function invalidCapabilityFailure(): McpFailure {
  return {
    ok: false,
    status: 401,
    code: "invalid_capability",
    error: "The MCP capability is invalid or no longer available",
  }
}

function expiredFailure(): McpFailure {
  return { ok: false, status: 410, code: "grant_expired", error: "This grant has expired" }
}

function arkivUnavailable(error: unknown): McpFailure {
  return {
    ok: false,
    status: 503,
    code: "arkiv_unavailable",
    error: `Could not reach Arkiv: ${(error as Error).message}`,
    retryable: true,
  }
}

function storageUnavailable(error: unknown): McpFailure {
  return {
    ok: false,
    status: 503,
    code: "mcp_store_unavailable",
    error: `Could not reach the MCP store: ${(error as Error).message}`,
    retryable: true,
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function isMcpEntityKey(value: string): boolean {
  return ENTITY_KEY_RE.test(value.toLowerCase())
}
