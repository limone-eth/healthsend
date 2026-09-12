"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import type { Icon as PhosphorIcon } from "@phosphor-icons/react"
import {
  ArrowsClockwise,
  CalendarBlank,
  Check,
  CheckCircle,
  Copy,
  FirstAidKit,
  Heartbeat,
  LockSimple,
  ShieldCheck,
  Sparkle,
  X,
  XCircle,
} from "@phosphor-icons/react"
import { privateKeyToAccount } from "viem/accounts"
import { SenderChrome } from "@/components/chrome"
import { Action, Card, Countdown, InsetNote, ScreenHeader } from "@/components/ui"
import { useSenderIdentity } from "@/components/use-sender-identity"
import { createGrant } from "@/lib/arkiv"
import { authCommitment, blindAttribute, generateContentKey } from "@/lib/crypto"
import { ensureFunded, getIdentity, type Identity } from "@/lib/identity"
import { signedMessage } from "@/lib/revoke"
import { disconnect, CONNECT_CONTAINER_ID } from "@/lib/swarm"
import type { ArchiveRecord, BloodPanelRecord, ScopedShare, SharedRecord, WearableSeriesRecord } from "@/lib/archive"

const DAY_SECONDS = 86_400

// Documents (H-63) have no scoped-share shape yet and are not offered here —
// the assistant connector stays limited to the two kinds it already knew.
type ScopeKind = "blood-panel" | "wearable-series"

type MintInput = {
  share: ScopedShare
  ttlSeconds: number
}

type AssistantConnection = {
  entityKey: string
  capability: string
  endpoint: string
  createdAt: number
  expiresAt: number
  scope: ScopeKind[]
}

type Stage =
  | { name: "consent" }
  | { name: "pairing"; connection: AssistantConnection }
  | { name: "connected"; connection: AssistantConnection }

const SCOPE_DETAILS: Record<
  ScopeKind,
  { title: string; description: string; icon: PhosphorIcon }
> = {
  "wearable-series": {
    title: "Wearables",
    description: "Dated values, units, ranges and targets",
    icon: Heartbeat,
  },
  "blood-panel": {
    title: "Blood panels",
    description: "Markers, units and reference ranges",
    icon: FirstAidKit,
  },
}

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
})

function formatDate(seconds: number): string {
  return dateFormatter.format(new Date(seconds * 1000))
}

function isoDate(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(0, 10)
}

function scopeLabels(scope: ScopeKind[]): string[] {
  return scope.map((kind) => SCOPE_DETAILS[kind].title)
}

/**
 * Build the exact object sent to the endpoint in this browser. Archive-only
 * provenance is copied nowhere, and the server receives no archive key or
 * reference it could use to widen the selection.
 */
function makeScopedShare(records: ArchiveRecord[], selected: Set<ScopeKind>): ScopedShare {
  const shared: SharedRecord[] = records
    .filter((record): record is BloodPanelRecord | WearableSeriesRecord => record.kind !== "document")
    .filter((record) => selected.has(record.kind))
    .map((record) => {
      if (record.kind === "blood-panel") {
        return {
          id: record.id,
          kind: record.kind,
          takenOn: record.takenOn,
          markers: record.markers.map((marker) => ({
            id: marker.id,
            name: marker.name,
            value: marker.value,
            unit: marker.unit,
            referenceRange: {
              ...(marker.referenceRange.min === undefined
                ? {}
                : { min: marker.referenceRange.min }),
              ...(marker.referenceRange.max === undefined
                ? {}
                : { max: marker.referenceRange.max }),
            },
            flaggedAtImport: marker.flaggedAtImport,
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
        values: record.values.map((value) => ({ ...value })),
      }
    })

  if (shared.length === 0) throw new Error("Choose at least one record group")
  return { v: 1, kind: "healthsend-scoped-share", records: shared }
}

async function mintAssistantConnection(
  input: MintInput,
  identity: Identity,
): Promise<AssistantConnection> {
  const funding = await ensureFunded(identity.address)
  if (!funding.funded) {
    throw new Error(funding.reason ?? "The Arkiv grant could not be funded")
  }

  // This random public commitment gives createGrant the same v2 shape as every
  // other Arkiv grant without linking the MCP bearer to the public entity.
  const commitment = await authCommitment(generateContentKey())
  const [recipientBlind, labelBlind] = await Promise.all([
    blindAttribute(identity.blindKey, `assistant-grant:${commitment}`),
    blindAttribute(identity.blindKey, `assistant-slice:${commitment}`),
  ])
  const grant = await createGrant({
    privateKey: identity.privateKey,
    payload: { v: 2, ref: "healthsend-mcp", authCommitment: commitment },
    fileKind: "mixed",
    recipientBlind,
    labelBlind,
    fileCount: input.share.records.length,
    ttlSeconds: input.ttlSeconds,
  })

  const timestamp = Math.floor(Date.now() / 1000)
  const signature = await privateKeyToAccount(identity.privateKey).signMessage({
    message: signedMessage("mcp", grant.entityKey, timestamp),
  })
  const response = await fetch("/api/mcp/consent", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      entityKey: grant.entityKey,
      signature,
      timestamp,
      scopedShare: input.share,
    }),
  })
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null
  if (!response.ok) {
    throw new Error(
      typeof body?.error === "string"
        ? body.error
        : `The assistant grant could not be created (HTTP ${response.status})`,
    )
  }
  if (
    typeof body?.capabilityToken !== "string" ||
    !/^hsmcp1_[A-Za-z0-9_-]{43}$/.test(body.capabilityToken) ||
    typeof body.mcpEndpoint !== "string" ||
    typeof body.expiresAt !== "number" ||
    !Number.isFinite(body.expiresAt)
  ) {
    throw new Error("The endpoint returned an invalid pairing capability")
  }

  return {
    entityKey: grant.entityKey,
    capability: body.capabilityToken,
    endpoint: body.mcpEndpoint,
    createdAt: timestamp,
    expiresAt: body.expiresAt,
    scope: Array.from(new Set(input.share.records.map((record) => record.kind))),
  }
}

async function revokeAssistantConnection(identity: Identity, entityKey: string): Promise<void> {
  const timestamp = Math.floor(Date.now() / 1000)
  const signature = await privateKeyToAccount(identity.privateKey).signMessage({
    message: signedMessage("revoke", entityKey, timestamp),
  })
  const response = await fetch("/api/holder/revoke", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ entityKey, signature, timestamp }),
  })
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null
  if (!response.ok) {
    throw new Error(
      typeof body?.error === "string"
        ? body.error
        : `Access could not be ended (HTTP ${response.status})`,
    )
  }
}

export default function AssistantPage() {
  const router = useRouter()
  const { info, identity } = useSenderIdentity()
  const signedIn = Boolean(info.identity && identity.address)

  return (
    <SenderChrome
      active="assistant"
      onNavigate={(destination) => {
        if (destination === "archive") router.push("/")
        if (destination === "shares") router.push("/shares")
      }}
      onNewShare={() => router.push("/new")}
      onSignOut={() => void disconnect()}
    >
      <div
        id={CONNECT_CONTAINER_ID}
        className={
          signedIn
            ? "fixed -left-[10000px] top-0 h-9 w-[110px] overflow-hidden"
            : "mb-6 h-11 w-[260px] overflow-hidden"
        }
      />

      {signedIn && identity.address ? (
        <AssistantFlow key={identity.address} />
      ) : (
        <SignedOut />
      )}
    </SenderChrome>
  )
}

function AssistantFlow() {
  const [stage, setStage] = useState<Stage>({ name: "consent" })

  // H-44 records the missing production loader. Never replace this with the
  // demo archive: doing so would present fixture health data as the user's.
  const records: ArchiveRecord[] = []

  if (stage.name === "consent") {
    return (
      <ConsentScreen
        records={records}
        onMint={async (input) => {
          const derived = await getIdentity()
          const connection = await mintAssistantConnection(input, derived)
          setStage({ name: "pairing", connection })
        }}
      />
    )
  }

  if (stage.name === "pairing") {
    return (
      <PairingScreen
        connection={stage.connection}
        onPaired={() => setStage({ name: "connected", connection: stage.connection })}
      />
    )
  }

  return (
    <ConnectedScreen
      connection={stage.connection}
      onChange={async () => {
        const derived = await getIdentity()
        await revokeAssistantConnection(derived, stage.connection.entityKey)
        setStage({ name: "consent" })
      }}
      onDisconnect={async () => {
        const derived = await getIdentity()
        await revokeAssistantConnection(derived, stage.connection.entityKey)
        setStage({ name: "consent" })
      }}
    />
  )
}

function SignedOut() {
  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col gap-7">
      <ScreenHeader
        title="Your assistant"
        lede="Sign in before you choose what an assistant may read. The same passkey owns the grant and signs the consent."
      />
      <Card className="flex flex-col gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-glyph bg-haze">
          <Sparkle size={20} weight="light" className="text-navy" />
        </div>
        <h2 className="text-[18px] font-semibold tracking-[-0.25px] text-ink">
          Continue with Swarm ID
        </h2>
        <p className="max-w-[540px] text-body text-secondary">
          Your passkey derives the key that owns the Arkiv grant. HealthSend has no account database
          to look it up in.
        </p>
      </Card>
    </div>
  )
}

function ConsentScreen({
  records,
  onMint,
}: {
  records: ArchiveRecord[]
  onMint: (input: MintInput) => Promise<void>
}) {
  // Documents (H-63) have no scoped-share shape yet, so this screen offers
  // only the two kinds it already knew how to share.
  const shareableRecords = useMemo(
    () =>
      records.filter(
        (record): record is BloodPanelRecord | WearableSeriesRecord => record.kind !== "document",
      ),
    [records],
  )
  const initialKinds = useMemo(
    () => new Set(shareableRecords.map((record) => record.kind)),
    [shareableRecords],
  )
  const [selected, setSelected] = useState<Set<ScopeKind>>(initialKinds)
  const [durationDays, setDurationDays] = useState(14)
  const [customEnd, setCustomEnd] = useState("")
  const [permissionOpen, setPermissionOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [now] = useState(() => Math.floor(Date.now() / 1000))

  const counts = useMemo(() => {
    return {
      "blood-panel": shareableRecords.filter((record) => record.kind === "blood-panel").length,
      "wearable-series": shareableRecords.filter((record) => record.kind === "wearable-series").length,
    } satisfies Record<ScopeKind, number>
  }, [shareableRecords])

  const expiresAt = customEnd
    ? Math.floor(new Date(`${customEnd}T23:59:59.000Z`).getTime() / 1000)
    : now + durationDays * DAY_SECONDS
  const ttlSeconds = Math.max(0, expiresAt - now)
  const canConnect = shareableRecords.length > 0 && selected.size > 0 && ttlSeconds > 0 && !submitting

  function toggle(kind: ScopeKind) {
    if (counts[kind] === 0) return
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(kind)) next.delete(kind)
      else next.add(kind)
      return next
    })
  }

  async function allow() {
    if (!canConnect) return
    setSubmitting(true)
    setError(null)
    try {
      const share = makeScopedShare(records, selected)
      const remainingSeconds = expiresAt - Math.floor(Date.now() / 1000)
      if (remainingSeconds <= 0) throw new Error("Choose an end date in the future")
      await onMint({ share, ttlSeconds: remainingSeconds })
      setPermissionOpen(false)
    } catch (caught) {
      setError((caught as Error).message)
      setPermissionOpen(false)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex w-full flex-col gap-7">
      <ScreenHeader
        title="Your assistant"
        lede="Let the assistant you already use read a slice of your archive for a set time. It answers from real records; the assistant is never told whose numbers these are."
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,640px)_minmax(300px,400px)] xl:justify-center xl:gap-10">
        <Card className="flex flex-col gap-5">
          <section className="flex flex-col gap-2" aria-labelledby="assistant-scope-title">
            <h2 id="assistant-scope-title" className="text-[15px] font-semibold text-ink">
              What it may read
            </h2>
            {(Object.keys(SCOPE_DETAILS) as ScopeKind[]).map((kind) => (
              <ScopeChoice
                key={kind}
                kind={kind}
                count={counts[kind]}
                selected={selected.has(kind)}
                onClick={() => toggle(kind)}
              />
            ))}
          </section>

          <section className="flex flex-col gap-2" aria-labelledby="assistant-duration-title">
            <h2 id="assistant-duration-title" className="text-[15px] font-semibold text-ink">
              For how long
            </h2>
            <div className="grid h-[42px] grid-cols-3 rounded-capsule bg-grouped p-[3px]">
              {[7, 14, 30].map((days) => {
                const active = !customEnd && durationDays === days
                return (
                  <button
                    key={days}
                    type="button"
                    onClick={() => {
                      setDurationDays(days)
                      setCustomEnd("")
                    }}
                    className={`rounded-capsule text-xs font-medium ${
                      active ? "border border-hairline bg-surface font-semibold text-ink shadow-control" : "text-secondary"
                    }`}
                  >
                    {days === 7 ? "1 week" : days === 14 ? "2 weeks" : "1 month"}
                  </button>
                )
              })}
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="flex h-11 items-center gap-2 rounded-control border border-hairline bg-surface px-3">
                <span className="text-xs font-medium text-muted">From</span>
                <span className="flex-1 text-sm font-medium text-ink">{formatDate(now)}</span>
                <CalendarBlank size={15} weight="light" className="text-muted" />
              </label>
              <label className="flex h-11 items-center gap-2 rounded-control border border-hairline bg-surface px-3">
                <span className="text-xs font-medium text-muted">To</span>
                <input
                  type="date"
                  min={isoDate(now + DAY_SECONDS)}
                  value={customEnd || isoDate(expiresAt)}
                  onChange={(event) => setCustomEnd(event.target.value)}
                  aria-label="Grant end date"
                  className="min-w-0 flex-1 bg-transparent text-sm font-medium text-ink outline-none"
                />
                <CalendarBlank size={15} weight="light" className="text-muted" />
              </label>
            </div>
          </section>

          <InsetNote icon={LockSimple}>
            A running endpoint can see one active grant’s scoped slice while answering. The exposure
            is bounded by that grant’s scope and Arkiv expiry.
          </InsetNote>

          {records.length === 0 && (
            <div className="rounded-inset border border-hairline bg-canvas p-4">
              <p className="text-sm font-semibold text-ink">No archive records are loaded</p>
              <p className="mt-1 text-[13px] leading-[1.45] text-secondary">
                Archive loading is not available yet. HealthSend will not substitute sample records
                or send an empty grant.
              </p>
            </div>
          )}

          {error && <p role="alert" className="text-sm text-error">{error}</p>}

          <Action
            fullWidth
            icon={Sparkle}
            disabled={!canConnect}
            onClick={() => setPermissionOpen(true)}
          >
            {submitting ? "Creating the grant…" : "Connect your assistant"}
          </Action>
          <button
            type="button"
            onClick={() => setPermissionOpen(true)}
            className="text-center text-[13px] font-semibold text-navy"
          >
            Read what this permission means
          </button>
        </Card>

        <div className="flex flex-col gap-5">
          <div className="overflow-hidden rounded-card border border-hairline bg-surface shadow-card">
            <PromiseRow
              icon={ShieldCheck}
              title="It answers from real records"
              detail="Markers, ranges and dated values — not a prewritten summary."
            />
            <div className="h-px bg-hairline" />
            <PromiseRow
              icon={CheckCircle}
              title="Only what you tick"
              detail="Nothing else is reachable. Every tool call is checked."
              tone="sage"
            />
            <div className="h-px bg-hairline" />
            <PromiseRow
              icon={CalendarBlank}
              title="It stops on the date you set"
              detail="Arkiv is checked before every answer."
              tone="chalk"
            />
          </div>
          <p className="text-[13px] leading-[1.45] text-muted">
            You can change the selection later by ending this grant and making another. Shares you
            send to people are not affected.
          </p>
        </div>
      </div>

      {permissionOpen && (
        <PermissionSheet
          expiresAt={expiresAt}
          scope={Array.from(selected)}
          canAllow={canConnect}
          submitting={submitting}
          onAllow={() => void allow()}
          onClose={() => setPermissionOpen(false)}
        />
      )}
    </div>
  )
}

function ScopeChoice({
  kind,
  count,
  selected,
  onClick,
}: {
  kind: ScopeKind
  count: number
  selected: boolean
  onClick: () => void
}) {
  const detail = SCOPE_DETAILS[kind]
  const Icon = detail.icon
  const unavailable = count === 0
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={unavailable}
      onClick={onClick}
      className={`flex min-h-[54px] w-full items-center gap-3 rounded-control border px-3.5 text-left ${
        selected ? "border-ink bg-surface" : "border-hairline bg-surface"
      } disabled:cursor-not-allowed disabled:bg-grouped`}
    >
      <span
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-[7px] border-[1.5px] ${
          selected ? "border-ink bg-ink" : "border-silver bg-surface"
        }`}
      >
        {selected && <Check size={12} weight="bold" className="text-surface" />}
      </span>
      <Icon size={17} weight="light" className={unavailable ? "text-muted" : "text-navy"} />
      <span className="min-w-0 flex-1">
        <span className={`block text-sm font-semibold ${unavailable ? "text-muted" : "text-ink"}`}>
          {detail.title}
        </span>
        <span className="block truncate text-xs text-muted">{detail.description}</span>
      </span>
      <span className="shrink-0 text-xs text-muted">
        {count === 0 ? "No records" : `${count} ${count === 1 ? "record" : "records"}`}
      </span>
    </button>
  )
}

function PromiseRow({
  icon: Icon,
  title,
  detail,
  tone = "haze",
}: {
  icon: PhosphorIcon
  title: string
  detail: string
  tone?: "haze" | "sage" | "chalk"
}) {
  const tones = {
    haze: "bg-haze text-navy",
    sage: "bg-sage text-moss",
    chalk: "bg-chalk text-umber",
  }
  return (
    <div className="flex items-start gap-3 px-5 py-4">
      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-glyph ${tones[tone]}`}>
        <Icon size={16} weight="light" />
      </div>
      <div>
        <p className="text-sm font-semibold text-ink">{title}</p>
        <p className="mt-0.5 text-[12.5px] leading-[1.4] text-secondary">{detail}</p>
      </div>
    </div>
  )
}

function PermissionSheet({
  expiresAt,
  scope,
  canAllow,
  submitting,
  onAllow,
  onClose,
}: {
  expiresAt: number
  scope: ScopeKind[]
  canAllow: boolean
  submitting: boolean
  onAllow: () => void
  onClose: () => void
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="permission-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/30 p-0 backdrop-blur-[2px] md:items-center md:p-6"
    >
      <div className="max-h-[92vh] w-full overflow-y-auto rounded-t-[28px] border border-hairline bg-surface shadow-focus md:max-w-[560px] md:rounded-[28px]">
        <div className="flex h-[26px] items-center justify-center md:hidden">
          <div className="h-1 w-[38px] rounded-capsule bg-silver" />
        </div>
        <div className="flex flex-col gap-[18px] px-[26px] pb-[26px] pt-2 md:pt-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 id="permission-title" className="text-[26px] font-bold leading-[1.2] tracking-[-0.6px] text-ink">
                What your assistant can see
              </h2>
              <p className="mt-2 text-[15px] leading-[1.5] text-secondary">
                You are about to let the assistant you already use read {scopeLabels(scope).join(" and ") || "the selected records"}.
                Four things follow.
              </p>
            </div>
            <button type="button" aria-label="Close" onClick={onClose} className="p-1 text-muted">
              <X size={20} weight="light" />
            </button>
          </div>

          <div className="overflow-hidden rounded-inset bg-grouped">
            <PermissionPoint
              icon={ShieldCheck}
              title="The selected records, not the whole archive"
              body="The tools may return individual markers and dated values when a question is in scope. No archive key, provenance or unselected record is sent."
              tone="sage"
            />
            <div className="h-px bg-silver" />
            <PermissionPoint
              icon={CalendarBlank}
              title={`It stops on ${formatDate(expiresAt)}`}
              body="The endpoint asks Arkiv before every answer. After the grant expires, it serves nothing and says that access ended."
            />
            <div className="h-px bg-silver" />
            <PermissionPoint
              icon={XCircle}
              title="What it works out stays with the assistant"
              body="Anything already written in the conversation can remain on that assistant company's systems. Ending the grant cannot remove an answer already returned."
              tone="chalk"
            />
            <div className="h-px bg-silver" />
            <PermissionPoint
              icon={Sparkle}
              title="You cannot supervise each read"
              body="The assistant bears the capability after pairing. You choose the records and end date now; HealthSend checks those limits on every call."
            />
          </div>

          <InsetNote icon={LockSimple}>
            A running endpoint sees this grant’s scoped slice while it answers. Its store keeps only
            ciphertext, but the running service must decrypt one request to answer it.
          </InsetNote>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <Action fullWidth disabled={!canAllow} onClick={onAllow}>
              {submitting ? "Creating the grant…" : "Allow it"}
            </Action>
            <Action fullWidth variant="secondary" onClick={onClose}>
              Not this time
            </Action>
          </div>
        </div>
      </div>
    </div>
  )
}

function PermissionPoint({
  icon: Icon,
  title,
  body,
  tone = "haze",
}: {
  icon: PhosphorIcon
  title: string
  body: string
  tone?: "haze" | "sage" | "chalk"
}) {
  const tones = {
    haze: "bg-haze text-navy",
    sage: "bg-sage text-moss",
    chalk: "bg-chalk text-umber",
  }
  return (
    <div className="flex gap-3 p-4">
      <div className={`flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-glyph ${tones[tone]}`}>
        <Icon size={16} weight="light" />
      </div>
      <div>
        <p className="text-[14.5px] font-semibold tracking-[-0.1px] text-ink">{title}</p>
        <p className="mt-1 text-[13px] leading-[1.5] text-secondary">{body}</p>
      </div>
    </div>
  )
}

function PairingScreen({
  connection,
  onPaired,
}: {
  connection: AssistantConnection
  onPaired: () => void
}) {
  const [copied, setCopied] = useState<"endpoint" | "code" | null>(null)

  async function copy(value: string, field: "endpoint" | "code") {
    await navigator.clipboard.writeText(value)
    setCopied(field)
    window.setTimeout(() => setCopied(null), 1800)
  }

  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-6">
      <ScreenHeader
        title="Connect your assistant"
        lede="The browser has made one grant. Hand its remote endpoint and pairing code to the assistant you already use."
      />

      <Card className="flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-glyph bg-haze">
            <Sparkle size={20} weight="light" className="text-navy" />
          </div>
          <div>
            <h2 className="text-[17px] font-semibold text-ink">Pair this grant</h2>
            <p className="text-[13px] text-muted">Ends {formatDate(connection.expiresAt)}</p>
          </div>
        </div>

        <CopyField
          label="REMOTE MCP ENDPOINT"
          value={connection.endpoint}
          copied={copied === "endpoint"}
          onCopy={() => void copy(connection.endpoint, "endpoint")}
        />
        <CopyField
          label="PAIRING CODE"
          value={connection.capability}
          copied={copied === "code"}
          onCopy={() => void copy(connection.capability, "code")}
          secret
        />

        <InsetNote icon={LockSimple}>
          The pairing code contains the bearer capability and the key for this encrypted slice. Treat
          it like a secret. HealthSend does not store the code and cannot show it again.
        </InsetNote>

        <div className="flex flex-wrap gap-2">
          {scopeLabels(connection.scope).map((label) => (
            <span key={label} className="rounded-capsule bg-grouped px-3 py-1.5 text-xs font-medium text-secondary">
              {label}
            </span>
          ))}
        </div>

        <Action fullWidth icon={CheckCircle} onClick={onPaired}>
          I have paired it
        </Action>
      </Card>
      <p className="text-center text-[13px] leading-[1.45] text-muted">
        The pairing code is the complete handoff. It appears only once.
      </p>
    </div>
  )
}

function CopyField({
  label,
  value,
  copied,
  onCopy,
  secret = false,
}: {
  label: string
  value: string
  copied: boolean
  onCopy: () => void
  secret?: boolean
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-eyebrow text-navy">{label}</span>
      <div className="flex items-stretch gap-2 rounded-inset bg-grouped p-2">
        <code className={`min-w-0 flex-1 break-all px-2 py-2 text-[13px] leading-[1.5] text-ink ${secret ? "font-mono" : ""}`}>
          {value}
        </code>
        <button
          type="button"
          onClick={onCopy}
          className="flex min-w-[92px] items-center justify-center gap-2 rounded-control border border-hairline bg-surface px-3 text-xs font-semibold text-ink"
        >
          {copied ? <Check size={15} weight="bold" /> : <Copy size={15} weight="light" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  )
}

function ConnectedScreen({
  connection,
  onChange,
  onDisconnect,
}: {
  connection: AssistantConnection
  onChange: () => Promise<void>
  onDisconnect: () => Promise<void>
}) {
  const [now] = useState(() => Math.floor(Date.now() / 1000))
  const [ending, setEnding] = useState<"change" | "disconnect" | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function endAccess(action: "change" | "disconnect") {
    setEnding(action)
    setError(null)
    try {
      await (action === "change" ? onChange() : onDisconnect())
    } catch (caught) {
      setError((caught as Error).message)
      setEnding(null)
    }
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <ScreenHeader
        title="Your assistant"
        lede={`Connected since ${formatDate(connection.createdAt)}. It reads one scoped slice and nothing else; the assistant is never told whose numbers these are.`}
      />

      <div className="overflow-hidden rounded-card border border-hairline bg-surface shadow-card">
        <div className="flex flex-col gap-4 p-5">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-glyph bg-haze">
              <Sparkle size={19} weight="light" className="text-navy" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-[17px] font-semibold text-ink">Remote MCP</h2>
              <p className="text-[12.5px] text-muted">Arkiv is checked before every answer</p>
            </div>
            <span className="flex h-[30px] items-center gap-1.5 rounded-capsule bg-sage px-3 text-xs font-medium text-moss">
              <CheckCircle size={13} weight="light" />
              Connected
            </span>
          </div>

          <Countdown expiresAt={connection.expiresAt} now={now} />

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] text-secondary">It can read</span>
            {scopeLabels(connection.scope).map((label) => (
              <span key={label} className="rounded-capsule bg-grouped px-3 py-1.5 text-xs font-medium text-secondary">
                {label}
              </span>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t border-hairline bg-canvas px-5 py-3 sm:flex-row sm:items-center">
          <div className="flex flex-1 items-center gap-2 text-[13px] text-secondary">
            <ShieldCheck size={15} weight="light" className="text-muted" />
            Out-of-scope calls are refused, not returned empty.
          </div>
          <button
            type="button"
            disabled={ending !== null}
            onClick={() => void endAccess("change")}
            className="h-9 rounded-capsule border border-hairline bg-surface px-3 text-xs font-semibold text-ink disabled:opacity-50"
          >
            {ending === "change" ? "Ending current grant…" : "Change what it reads"}
          </button>
          <button
            type="button"
            disabled={ending !== null}
            onClick={() => void endAccess("disconnect")}
            className="flex h-9 items-center justify-center gap-1.5 rounded-capsule border border-hairline bg-surface px-3 text-xs font-semibold text-error disabled:opacity-50"
          >
            <XCircle size={14} weight="light" />
            {ending === "disconnect" ? "Ending…" : "Disconnect"}
          </button>
        </div>
      </div>

      {error && <p role="alert" className="text-sm text-error">{error}</p>}

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <Card className="flex flex-col gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-glyph bg-sage">
              <ArrowsClockwise size={16} weight="light" className="text-moss" />
            </div>
            <h2 className="text-base font-semibold text-ink">Changes need a new grant</h2>
          </div>
          <p className="text-sm leading-[1.5] text-secondary">
            This slice does not silently widen when the archive changes. End it, choose the new
            records and hand over a fresh pairing code.
          </p>
        </Card>
        <Card className="flex flex-col gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-glyph bg-chalk">
              <LockSimple size={16} weight="light" className="text-umber" />
            </div>
            <h2 className="text-base font-semibold text-ink">Expiry ends new reads</h2>
          </div>
          <p className="text-sm leading-[1.5] text-secondary">
            After {formatDate(connection.expiresAt)}, Arkiv removes the grant and the endpoint serves
            nothing. Answers already in assistant history do not expire.
          </p>
        </Card>
      </div>
    </div>
  )
}
