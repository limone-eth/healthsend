"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { CheckCircle, LockSimple, UserCircle, XCircle } from "@phosphor-icons/react"
import { listMySends } from "@/lib/sends"
import type { FileKind } from "@/lib/arkiv"
import { Action, Chip, Countdown, InsetNote, ScreenHeader, type ChipState } from "@/components/ui"
import { useSenderIdentity } from "@/components/use-sender-identity"
import { fetchAccessLog, type AccessLogFetch } from "./access-log-client"
import { performConfirmEnd } from "./confirm-end"
import { markEndedByYou, reconcileKnownShares, type KnownShare } from "./local-history"

/** Re-polled on the same tick as the grant list, never a client timer against a stored date. */
const POLL_INTERVAL_MS = 15_000

const FILE_KIND_LABEL: Record<FileKind, string> = {
  pdf: "PDF",
  csv: "CSV",
  text: "Text",
  mixed: "Mixed",
}

const dayMonth = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long" })
const weekdayTime = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  hour: "2-digit",
  minute: "2-digit",
})

/** The sender's live view. Redesigned by H-10 from frames hCcwO (desktop) and aOxXo (mobile). */
export default function SharesPage() {
  const { info, identity } = useSenderIdentity()
  if (!(info.identity && identity.address)) return null
  return <SharesList address={identity.address} />
}

type LogByKey = Record<string, "loading" | AccessLogFetch | undefined>

function SharesList({ address }: { address: string }) {
  const [known, setKnown] = useState<KnownShare[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [logs, setLogs] = useState<LogByKey>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  const [confirmTarget, setConfirmTarget] = useState<string | null>(null)
  const [ending, setEnding] = useState(false)
  const [endError, setEndError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setNow(Math.floor(Date.now() / 1000))
    let live
    try {
      live = await listMySends()
    } catch (caught) {
      // A failed poll must not be folded into local history — see local-history.ts —
      // so the existing view is left standing rather than replaced with nothing.
      setError((caught as Error).message)
      return
    }
    setError(null)
    const merged = reconcileKnownShares(address, live)
    setKnown(merged)

    const stillLive = new Set(live.map((g) => g.entityKey))
    await Promise.all(
      merged
        .filter((entry) => stillLive.has(entry.entityKey))
        .map(async (entry) => {
          setLogs((prev) => (prev[entry.entityKey] ? prev : { ...prev, [entry.entityKey]: "loading" }))
          const result = await fetchAccessLog(entry.entityKey)
          setLogs((prev) => ({ ...prev, [entry.entityKey]: result }))
        }),
    )
  }, [address])

  useEffect(() => {
    let cancelled = false
    const tick = () => {
      if (!cancelled) void refresh()
    }
    const initial = setTimeout(tick, 0)
    const timer = setInterval(tick, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearTimeout(initial)
      clearInterval(timer)
    }
  }, [refresh])

  const { active, ended } = useMemo(() => {
    const list = known ?? []
    const isEnded = (entry: KnownShare) => entry.endedByYou || entry.naturallyGoneAt !== null
    return {
      active: list.filter((e) => !isEnded(e)).sort((a, b) => b.createdAt - a.createdAt),
      ended: list
        .filter(isEnded)
        .sort((a, b) => (b.endedByYouAt ?? b.naturallyGoneAt ?? 0) - (a.endedByYouAt ?? a.naturallyGoneAt ?? 0)),
    }
  }, [known])

  const toggle = (entityKey: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(entityKey)) next.delete(entityKey)
      else next.add(entityKey)
      return next
    })
  }

  const confirmEnd = async () => {
    if (!confirmTarget) return
    setEnding(true)
    setEndError(null)
    // performConfirmEnd always resolves — a refused connection reports the
    // same way as an explicit error, rather than leaving `ending` stuck and
    // every control on the sheet disabled. See confirm-end.ts.
    const outcome = await performConfirmEnd(confirmTarget)
    setEnding(false)
    if (outcome.outcome === "refused") {
      setEndError(outcome.message)
      return
    }
    markEndedByYou(address, confirmTarget)
    setConfirmTarget(null)
    void refresh()
  }

  return (
    <div className="flex w-full flex-col gap-5">
      <ScreenHeader
        title="Your shares"
        lede="Every document you've shared, and how long is left. Each one ends on its own — you don't have to do anything."
      />

      {error && (
        <InsetNote>Could not reach Arkiv just now: {error}. Showing the last list we had.</InsetNote>
      )}

      {known === null && !error && <InsetNote>Querying Arkiv…</InsetNote>}

      {known !== null && active.length === 0 && ended.length === 0 && (
        <InsetNote>
          Nothing shared yet. Sends disappear from this list on their own once their grant expires —
          no revocation step, and no delete call.
        </InsetNote>
      )}

      {active.map((entry) => (
        <ShareCard
          key={entry.entityKey}
          entry={entry}
          now={now}
          log={logs[entry.entityKey]}
          expanded={expanded.has(entry.entityKey)}
          onToggleLog={() => toggle(entry.entityKey)}
          onEnd={() => setConfirmTarget(entry.entityKey)}
        />
      ))}

      {ended.length > 0 && (
        <div className="flex flex-col gap-3 pt-1.5">
          <div className="flex flex-col gap-2">
            <span className="text-eyebrow uppercase text-muted">Already ended</span>
            <div className="h-px w-full bg-hairline" />
          </div>
          {ended.map((entry) => (
            <EndedRow key={entry.entityKey} entry={entry} log={logs[entry.entityKey]} />
          ))}
        </div>
      )}

      {confirmTarget && (
        <ConfirmEndSheet
          ending={ending}
          error={endError}
          onCancel={() => {
            setConfirmTarget(null)
            setEndError(null)
          }}
          onConfirm={confirmEnd}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Chip state — the fixed vocabulary from DESIGN.md § Share state chip, plus
// the seventh state that is deliberately not one of the six. "On their device"
// has no data source here: the access log is a list of timestamps with no
// device binding, so it is never produced — see `## Choices`.
// ---------------------------------------------------------------------------

function chipStateFor(entry: KnownShare, log: AccessLogFetch, now: number): ChipState {
  if (entry.endedByYou) return "ended-by-you"
  if (entry.naturallyGoneAt !== null) return "ended"
  if (log.status === "unavailable") return "unavailable"
  if (log.opened.length === 0) return log.reliable ? "not-opened" : "unavailable"
  const remaining = entry.expiresAt - now
  if (remaining > 0 && remaining <= 7 * 86400) return "ending-soon"
  return "active"
}

function logSummary(entry: KnownShare, log: LogByKey[string]): string {
  if (entry.endedByYou) {
    return entry.endedByYouAt
      ? `You ended this on ${dayMonth.format(new Date(entry.endedByYouAt * 1000))}.`
      : "You ended this."
  }
  if (!log || log === "loading") return "Checking when she looked…"
  if (log.status === "unavailable") return "We could not reach the access log just now."
  if (!log.reliable && log.opened.length === 0) {
    return "A record may have been dropped. We can't confirm whether this has been opened."
  }
  if (log.opened.length === 0) return "Not opened yet. You can end it before it is ever seen."
  const last = log.opened[log.opened.length - 1]
  const times = log.opened.length === 1 ? "once" : `${log.opened.length} times`
  return `Opened ${times}. Last on ${weekdayTime.format(new Date(last * 1000))}.`
}

function ShareCard({
  entry,
  now,
  log,
  expanded,
  onToggleLog,
  onEnd,
}: {
  entry: KnownShare
  now: number
  log: LogByKey[string]
  expanded: boolean
  onToggleLog: () => void
  onEnd: () => void
}) {
  const resolvedLog = log && log !== "loading" ? log : null
  const title = `${FILE_KIND_LABEL[entry.fileKind]} share`
  const meta = `${entry.fileCount} ${entry.fileCount === 1 ? "document" : "documents"} · Sent ${dayMonth.format(
    new Date(entry.createdAt * 1000),
  )}`
  const canExpand = Boolean(log && log !== "loading" && log.status === "ok")

  return (
    <div className="w-full overflow-hidden rounded-card border border-black/[0.05] bg-surface shadow-card">
      <div className="flex flex-col gap-3 p-4 md:p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-glyph bg-grouped md:h-9 md:w-9">
            <UserCircle size={19} weight="light" className="text-secondary" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[17px] font-semibold tracking-[-0.25px] text-ink">{title}</span>
              {resolvedLog ? (
                <Chip state={chipStateFor(entry, resolvedLog, now)} />
              ) : (
                // Genuinely don't know yet — no chip claims otherwise while we wait.
                <span className="h-[34px] w-[110px] animate-pulse rounded-capsule bg-grouped" />
              )}
            </div>
            <p className="mt-0.5 text-[13px] text-muted">{meta}</p>
          </div>
          <div className="hidden shrink-0 md:block md:w-[260px]">
            <Countdown expiresAt={entry.expiresAt} now={now} />
          </div>
        </div>
        <div className="md:hidden">
          <Countdown expiresAt={entry.expiresAt} now={now} />
        </div>
      </div>

      <div className="h-px w-full bg-hairline" />

      <div className="flex flex-col gap-2 bg-canvas px-4 py-3 md:flex-row md:items-center md:gap-2.5 md:px-5">
        <CheckCircle size={15} weight="light" className="hidden shrink-0 text-muted md:block" />
        <p className="min-w-0 flex-1 text-[13px] text-secondary">{logSummary(entry, log)}</p>
        <div className="flex shrink-0 gap-2">
          <CapsuleButton onClick={onToggleLog} disabled={!canExpand}>
            {expanded ? "Hide" : "When she looked"}
          </CapsuleButton>
          <CapsuleButton tone="destructive" icon={XCircle} onClick={onEnd}>
            End access now
          </CapsuleButton>
        </div>
      </div>

      {expanded && log && log !== "loading" && log.status === "ok" && (
        <div className="flex flex-col bg-canvas">
          <div className="h-px w-full bg-hairline" />
          {log.opened.length === 0 ? (
            <p className="px-5 py-3 text-[13px] text-muted">No opens recorded yet.</p>
          ) : (
            [...log.opened]
              .reverse()
              .map((at, i) => (
                <div key={at}>
                  {i > 0 && <div className="h-px w-full bg-hairline" />}
                  <div className="flex items-center gap-3 px-5 py-2.5">
                    <span className="text-[13px] font-medium text-ink">{weekdayTime.format(new Date(at * 1000))}</span>
                    <span className="text-[13px] text-secondary">Opened</span>
                  </div>
                </div>
              ))
          )}
        </div>
      )}
    </div>
  )
}

function EndedRow({ entry, log }: { entry: KnownShare; log: LogByKey[string] }) {
  const title = `${FILE_KIND_LABEL[entry.fileKind]} share`
  const openCount = log && log !== "loading" && log.status === "ok" ? log.opened.length : null
  const meta =
    openCount === null
      ? `${entry.fileCount} ${entry.fileCount === 1 ? "document" : "documents"}`
      : `${entry.fileCount} ${entry.fileCount === 1 ? "document" : "documents"} · opened ${
          openCount === 1 ? "once" : `${openCount} times`
        }`
  const endedAt = entry.endedByYouAt ?? entry.naturallyGoneAt
  const chipState: ChipState = entry.endedByYou ? "ended-by-you" : "ended"

  return (
    <div className="flex h-auto min-h-[62px] w-full items-center gap-3 rounded-control bg-grouped px-4 py-2.5 md:px-[18px]">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-glyph bg-silver">
        <LockSimple size={16} weight="light" className="text-muted" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-medium text-secondary">{title}</p>
        <p className="mt-0.5 truncate text-[13px] text-muted">{meta}</p>
      </div>
      <Chip state={chipState} />
      {endedAt !== null && (
        <span className="hidden shrink-0 text-[13px] font-medium text-muted md:block">
          Ended {dayMonth.format(new Date(endedAt * 1000))}
        </span>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// The card-footer mini button — pen ids Dl7Z7/dko6A: capsule, 30px, hairline
// border, icon+label coloured for tone. Distinct from `Action`'s
// `destructive` variant, whose border is `error` — the frame keeps this
// button's border neutral and lets only the icon and label carry the
// colour. See `## Choices`.
// ---------------------------------------------------------------------------

function CapsuleButton({
  children,
  onClick,
  disabled = false,
  tone = "neutral",
  icon: IconComponent,
}: {
  children: string
  onClick?: () => void
  disabled?: boolean
  tone?: "neutral" | "destructive"
  icon?: typeof XCircle
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-[30px] shrink-0 items-center gap-1.5 rounded-capsule border border-hairline bg-surface px-3 text-[12.5px] font-medium disabled:cursor-not-allowed disabled:opacity-50 ${
        tone === "destructive" ? "text-error" : "text-ink"
      }`}
    >
      {IconComponent && <IconComponent size={13} weight="light" />}
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------
// End access now — the confirm sheet. The one destructive, irreversible
// control in the product: `$error` appears here and on the card's own End
// button, and nowhere else on this screen.
// ---------------------------------------------------------------------------

function ConfirmEndSheet({
  ending,
  error,
  onCancel,
  onConfirm,
}: {
  ending: boolean
  error: string | null
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 md:items-center md:p-5"
      onClick={() => !ending && onCancel()}
    >
      <div
        className="w-full rounded-sheet bg-surface p-6 shadow-card md:max-w-md md:rounded-card"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="text-[17px] font-semibold tracking-[-0.25px] text-ink">End access now?</h2>
        <p className="mt-2 text-[15px] leading-[1.47] text-secondary">
          This deletes our half of the key. The link stops working right away, and there is no undo
          — ending access stops anything further, but it cannot un-read what has already been seen.
        </p>

        {error && <p className="mt-3 text-[13px] text-error">{error}</p>}

        <div className="mt-6 flex flex-col gap-2.5">
          <Action variant="primary" fullWidth onClick={onCancel} disabled={ending}>
            Keep it
          </Action>
          <Action variant="destructive" fullWidth onClick={onConfirm} disabled={ending}>
            {ending ? "Ending…" : "End access now"}
          </Action>
        </div>
      </div>
    </div>
  )
}
