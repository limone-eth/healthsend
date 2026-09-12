"use client"

import { useCallback, useEffect, useState } from "react"
import { listMySends } from "@/lib/sends"
import type { FileKind, Grant } from "@/lib/arkiv"
import { Card, Mono, timeLeft } from "@/components/ui"
import { useSenderIdentity } from "@/components/use-sender-identity"

/** The send list. Redesigned by H-10. */
export default function SharesPage() {
  const { info, identity } = useSenderIdentity()
  if (!(info.identity && identity.address)) return null
  return <SendList address={identity.address} />
}

function SendList({ address }: { address: string }) {
  const [grants, setGrants] = useState<Grant[] | null>(null)
  const [filter, setFilter] = useState<FileKind | "all">("all")
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const rows = await listMySends(filter === "all" ? undefined : { fileKind: filter })
      setError(null)
      setGrants(rows)
    } catch (caught) {
      setError((caught as Error).message)
      setGrants([])
    }
  }, [filter])

  // Re-running the same query on an interval is what makes expiry visible: no
  // delete call happens, rows simply stop coming back.
  useEffect(() => {
    let cancelled = false
    const tick = () => {
      if (!cancelled) void refresh()
    }
    // Deferred rather than called inline so the first query, like every later
    // one, lands outside the render pass.
    const initial = setTimeout(tick, 0)
    const timer = setInterval(tick, 15_000)
    return () => {
      cancelled = true
      clearTimeout(initial)
      clearInterval(timer)
    }
  }, [refresh, address])

  return (
    <Card>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-medium">Active sends</h2>
        <select
          value={filter}
          onChange={(event) => setFilter(event.target.value as FileKind | "all")}
          className="rounded-md border border-line bg-background px-2 py-1 text-xs"
        >
          <option value="all">All types</option>
          <option value="pdf">PDF</option>
          <option value="csv">CSV</option>
          <option value="text">Text</option>
          <option value="mixed">Mixed</option>
        </select>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {grants === null && <p className="text-sm text-muted">Querying Arkiv…</p>}

      {grants?.length === 0 && (
        <p className="text-sm text-muted">
          Nothing active. Sends disappear from this list when their grant expires — no revocation
          step, and no delete call.
        </p>
      )}

      <ul className="divide-y divide-line">
        {grants?.map((grant) => (
          <li key={grant.entityKey} className="flex items-center justify-between gap-4 py-3">
            <div className="min-w-0">
              <p className="text-sm">
                <span className="uppercase text-muted">{grant.fileKind}</span>
                <span className="text-muted"> · </span>
                <Mono>{grant.entityKey.slice(0, 18)}…</Mono>
              </p>
              <p className="mt-0.5 text-xs text-muted">
                {grant.fileCount} {grant.fileCount === 1 ? "document" : "documents"} · Swarm{" "}
                {grant.payload.ref.slice(0, 12)}…
              </p>
            </div>
            <span className="shrink-0 text-xs text-muted">{timeLeft(grant.expiresAt)}</span>
          </li>
        ))}
      </ul>
    </Card>
  )
}
