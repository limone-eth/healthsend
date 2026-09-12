"use client"

import { useState } from "react"
import { createSend, type CreateSendResult } from "@/lib/sends"
import { ARKIV_EXPLORER } from "@/lib/arkiv"
import { Button, Card, Field, inputClass, timeLeft } from "@/components/ui"
import { DemoNotice } from "@/components/demo-notice"
import { useSenderIdentity } from "@/components/use-sender-identity"

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

/** Compose. Redesigned by H-8. */
export default function NewSendPage() {
  const { info, identity } = useSenderIdentity()
  if (!(info.identity && identity.address)) return null
  return <ComposeSend canUpload={info.canUpload} />
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
            className="w-full text-sm file:mr-3 file:rounded-md file:border file:border-hairline file:bg-canvas file:px-3 file:py-1.5 file:text-sm"
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

        {error && <p className="text-sm text-red-600">{error}</p>}

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
    <div className="rounded-lg border border-hairline bg-canvas p-4">
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
