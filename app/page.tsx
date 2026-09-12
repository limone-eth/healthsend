"use client"

/**
 * The sender's screen: sign in, upload, share, watch it expire.
 *
 * Everything here runs in the browser. The only network calls are to Swarm (via
 * the Swarm ID iframe), to Arkiv, and to our own /api/fund for gas.
 */

import { useCallback, useEffect, useState } from "react"
import { CONNECT_CONTAINER_ID, onConnectionChange, type ConnectionInfo } from "@/lib/swarm"
import { getIdentity, forgetIdentity } from "@/lib/identity"
import { createSend, listMySends, type CreateSendResult } from "@/lib/sends"
import type { FileKind, Grant } from "@/lib/arkiv"
import { ARKIV_EXPLORER } from "@/lib/arkiv"
import { Button, Card, Field, Mono, inputClass, timeLeft } from "@/components/ui"
import { DemoNotice } from "@/components/demo-notice"

/**
 * Windows are deliberately short by default. The Arkiv mission is judged on the
 * same query answering differently before and after a boundary, and nobody can
 * wait out twelve weeks during a demo — so minutes are first-class here.
 */
const WINDOWS: { label: string; seconds: number }[] = [
  { label: "2 minutes", seconds: 120 },
  { label: "10 minutes", seconds: 600 },
  { label: "1 hour", seconds: 3600 },
  { label: "7 days", seconds: 7 * 86400 },
  { label: "12 weeks", seconds: 84 * 86400 },
]

export default function Home() {
  const [info, setInfo] = useState<ConnectionInfo>({ canUpload: false })
  const [identity, setIdentity] = useState<{
    address: string | null
    booting: boolean
    error: string | null
  }>({ address: null, booting: true, error: null })
  const { address, booting } = identity

  useEffect(() => onConnectionChange(setInfo), [])

  // The Swarm ID iframe reports a connection before the app secret is derivable,
  // so the Arkiv identity is resolved as a follow-on step rather than inline.
  useEffect(() => {
    let cancelled = false
    const resolve = async () => {
      if (!info.identity) {
        forgetIdentity()
        if (!cancelled) setIdentity({ address: null, booting: false, error: null })
        return
      }
      try {
        const derived = await getIdentity()
        if (!cancelled) setIdentity({ address: derived.address, booting: false, error: null })
      } catch (caught) {
        // Swallowing this left the app signed in with no send form and no
        // explanation — the worst of both states. Say what broke.
        if (!cancelled) {
          setIdentity({ address: null, booting: false, error: (caught as Error).message })
        }
      }
    }
    resolve()
    return () => {
      cancelled = true
    }
  }, [info.identity])

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-16">
      <header className="mb-10">
        <h1 className="text-2xl font-semibold tracking-tight">HealthSend</h1>
        <p className="mt-1 text-sm text-muted">
          Share a document with someone for exactly as long as you mean to. Then the key is gone.
        </p>
      </header>

      <ConnectionPanel
        info={info}
        address={address}
        booting={booting}
        error={identity.error}
      />

      {info.identity && address && (
        <>
          <ComposeSend canUpload={info.canUpload} />
          <SendList address={address} />
        </>
      )}

      <footer className="mt-16 border-t border-line pt-6 text-xs text-muted">
        Documents are encrypted in this browser and stored on Swarm. The key that opens them is
        split between the link and an Arkiv grant that expires on its own.
      </footer>
    </main>
  )
}

function ConnectionPanel({
  info,
  address,
  booting,
  error,
}: {
  info: ConnectionInfo
  address: string | null
  booting: boolean
  error: string | null
}) {
  const signedIn = Boolean(info.identity)

  return (
    <Card className="mb-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          {signedIn ? (
            <>
              <h2 className="text-sm font-medium">{info.identity!.name}</h2>
              <p className="mt-0.5 text-xs text-muted">Swarm ID · {info.identity!.address}</p>
            </>
          ) : (
            <>
              <h2 className="text-sm font-medium">Sign in</h2>
              <p className="mt-1 text-sm text-muted">
                Swarm ID is the whole account: a passkey, no wallet and no seed phrase. There is no
                user database here to sign in to.
              </p>
            </>
          )}

          {signedIn && booting && <p className="mt-2 text-xs text-muted">Deriving your keys…</p>}

          {signedIn && error && (
            <p className="mt-2 text-xs text-red-600 dark:text-red-400">
              Could not derive your grant key: {error}
            </p>
          )}

          {signedIn && !info.canUpload && (
            <p className="mt-2 text-xs text-muted">
              No postage batch on this identity yet, so uploads are unavailable. Get one at the
              Swarm desk, or point NEXT_PUBLIC_SWARM_SUBSIDISED_GATEWAY at a stamping gateway.
            </p>
          )}

          {/* Keys are derived silently from the passkey. They are shown only on
              request: a user who never opens this never learns a key exists,
              which is the point — the ownership is real whether or not they
              look at it. */}
          {signedIn && !booting && address && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-muted">Advanced</summary>
              <p className="mt-1.5 text-xs">
                <span className="text-muted">Arkiv grant key </span>
                <Mono>{address}</Mono>
              </p>
              <p className="mt-1 text-xs text-muted">
                Derived from your passkey, held by nobody else. Sign in on another device and the
                same key comes back.
              </p>
            </details>
          )}
        </div>

        {/*
          The Swarm ID iframe lives in this container and paints its own button —
          "Continue with Swarm ID" when signed out, "Sign out" when signed in.

          It must stay mounted across that transition. Rendering it only in the
          signed-out branch tore the iframe out of the DOM the moment a user
          signed in, and every later call failed with "Iframe not initialized" —
          the app sat there signed in with no send form and no way back.
        */}
        <div
          id={CONNECT_CONTAINER_ID}
          className={
            signedIn
              ? "h-9 w-[110px] shrink-0 overflow-hidden"
              : "h-11 w-[260px] shrink-0 overflow-hidden"
          }
        />
      </div>
    </Card>
  )
}

function ComposeSend({ canUpload }: { canUpload: boolean }) {
  const [files, setFiles] = useState<File[]>([])
  const [recipient, setRecipient] = useState("")
  const [window_, setWindow] = useState(WINDOWS[1].seconds)
  const [stage, setStage] = useState<string | null>(null)
  const [result, setResult] = useState<CreateSendResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (files.length === 0) return
    setError(null)
    setResult(null)
    try {
      const send = await createSend({
        files,
        recipientLabel: recipient || "unnamed",
        ttlSeconds: window_,
        onProgress: setStage,
      })
      setResult(send)
      setFiles([])
      setRecipient("")
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setStage(null)
    }
  }

  return (
    <Card className="mb-6">
      <h2 className="mb-4 text-sm font-medium">New send</h2>

      <DemoNotice />

      <div className="space-y-4">
        <Field label="Documents">
          <input
            type="file"
            multiple
            accept=".pdf,.csv,.txt,.json,text/plain,text/csv,application/pdf"
            onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
            className="w-full text-sm file:mr-3 file:rounded-md file:border file:border-line file:bg-background file:px-3 file:py-1.5 file:text-sm"
          />
          {files.length > 0 && (
            <ul className="mt-2 space-y-1">
              {files.map((f) => (
                <li key={f.name} className="flex justify-between gap-4 text-xs text-muted">
                  <span className="truncate">{f.name}</span>
                  <span className="shrink-0">{formatBytes(f.size)}</span>
                </li>
              ))}
            </ul>
          )}
          {files.length > 1 && (
            <p className="mt-2 text-xs text-muted">
              {files.length} documents, one link, one expiry. They travel together because they
              expire together.
            </p>
          )}
        </Field>

        <Field label="Recipient">
          <input
            value={recipient}
            onChange={(event) => setRecipient(event.target.value)}
            placeholder="Who is this for?"
            className={inputClass}
          />
        </Field>

        <Field label="Access ends after">
          <select
            value={window_}
            onChange={(event) => setWindow(Number(event.target.value))}
            className={inputClass}
          >
            {WINDOWS.map((option) => (
              <option key={option.seconds} value={option.seconds}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>

        <Button onClick={submit} disabled={files.length === 0 || !canUpload || stage !== null}>
          {stage ?? "Create link"}
        </Button>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        {result && <ShareResult result={result} />}
      </div>
    </Card>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function ShareResult({ result }: { result: CreateSendResult }) {
  const [copied, setCopied] = useState(false)

  return (
    <div className="rounded-lg border border-line bg-background p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">Share this link</p>
      <p className="mt-2 break-all font-mono text-xs">{result.url}</p>
      <div className="mt-3 flex items-center gap-2">
        <Button
          variant="ghost"
          onClick={() => {
            navigator.clipboard.writeText(result.url)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          }}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
        <a
          href={`${ARKIV_EXPLORER}/tx/${result.txHash}`}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-muted underline underline-offset-2"
        >
          Grant transaction
        </a>
      </div>
      <p className="mt-3 text-xs text-muted">
        The part after <code className="font-mono">#</code> is half the key and never reaches a
        server. The other half is the Arkiv grant — {timeLeft(result.expiresAt)}.
      </p>
    </div>
  )
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
