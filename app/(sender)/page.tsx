"use client"

import { useEffect, useRef, useState, type ChangeEvent } from "react"
import { ArrowDown, Eye, FileText, FileX } from "@phosphor-icons/react"
import { useSenderIdentity } from "@/components/use-sender-identity"
import { recordsFromPdfFiles } from "@/lib/archive-input"
import { addRecordsToMyArchive, loadMyArchive } from "@/lib/archive-store"
import type { ArchiveRecord, DocumentRecord, ShareIndexEntry } from "@/lib/archive"
import { RemoveDocumentSheet } from "@/components/remove-document-sheet"
import { performRemoveDocument, type LiveShareView } from "@/components/remove-document-sheet-logic"
import { loadLiveSharesForDocument } from "./live-shares-for-document"

/**
 * 2.1 "Your archive" — pen ids `M2g5J2` (desktop) / `W1yi5` (mobile), read via
 * the pencil MCP tool against `healthsend.pen`, not a screenshot.
 *
 * H-66 narrows this screen to the operator's stated focus: PDFs only, shared
 * as issued. The five-group grid and the "Right now" focus surface that used
 * to live here are gone — `ACUf3`/`zsDfc`, the frames they came from, are kept
 * unchanged beside `M2g5J2`/`W1yi5` for a later story to pick back up.
 *
 * The share-status pill the frames show ("In 1 share") has no data source in
 * this build: nothing yet records which archive record went into which send
 * (that is H-64's call), so it is omitted rather than guessed at — see
 * `docs/stories/H-66.md`, "Share-status pill".
 */

const fullDateFormatter = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: "UTC" })
const shortDateFormatter = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })

function formatFullDate(iso: string): string {
  return fullDateFormatter.format(new Date(`${iso}T00:00:00.000Z`))
}

function formatShortDate(iso: string): string {
  return shortDateFormatter.format(new Date(`${iso}T00:00:00.000Z`))
}

/** "240 KB" — mirrors `formatBytes` in `app/s/[key]/page.tsx`, kept local
 * rather than imported since that directory belongs to another story. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function eyebrowLabel(count: number): string {
  const noun = count === 1 ? "BLOOD TEST" : "BLOOD TESTS"
  return `${count} ${noun} · PDF`
}

type ArchiveLoadState =
  | { status: "loading" }
  | { status: "ready"; records: ArchiveRecord[]; shareIndex: ShareIndexEntry[] | undefined }
  | { status: "error"; message: string }

const ARCHIVE_LOAD_TIMEOUT_MS = 15_000

export default function ArchivePage() {
  const { info, identity } = useSenderIdentity()
  if (!(info.identity && identity.address)) return null
  return <ArchiveScreen senderAddress={identity.address} />
}

/** State for the remove-document sheet (`i90sl`) — see docs/stories/H-18.md. */
type RemoveSheetState =
  | { status: "closed" }
  | { status: "checking-shares"; document: DocumentRecord }
  | {
      status: "open"
      document: DocumentRecord
      shares: LiveShareView[]
      indexUnknown: boolean
      endOthers: boolean
      removing: boolean
      error: string | null
    }

/**
 * Adding PDFs straight from this screen: the click opens the file picker, with no
 * "What are you adding?" chooser in between — this archive only takes PDFs.
 */
type AddState = { status: "idle" } | { status: "adding"; count: number } | { status: "error"; message: string }

function ArchiveScreen({ senderAddress }: { senderAddress: string }) {
  const [archive, setArchive] = useState<ArchiveLoadState>({ status: "loading" })
  const [removeSheet, setRemoveSheet] = useState<RemoveSheetState>({ status: "closed" })
  const [removeSheetNow, setRemoveSheetNow] = useState(() => Math.floor(Date.now() / 1000))
  const pdfInput = useRef<HTMLInputElement>(null)
  const [adding, setAdding] = useState<AddState>({ status: "idle" })
  const isAdding = adding.status === "adding"

  function pickPdfs() {
    if (isAdding) return
    pdfInput.current?.click()
  }

  async function addPickedPdfs(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    // Cleared so picking the same file again still fires `change`.
    event.target.value = ""
    if (files.length === 0) return
    setAdding({ status: "adding", count: files.length })
    try {
      // The same path as Add's "A letter or report" card: every PDF in the pick
      // is resealed and uploaded once, together — see lib/archive-store.ts.
      await addRecordsToMyArchive(await recordsFromPdfFiles(files))
      setAdding({ status: "idle" })
      await refreshArchive()
    } catch (cause) {
      setAdding({ status: "error", message: (cause as Error).message })
    }
  }

  const refreshArchive = () => {
    let timeout: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<never>((_, reject) => {
      timeout = setTimeout(
        () => reject(new Error("The archive request took too long. Try again.")),
        ARCHIVE_LOAD_TIMEOUT_MS,
      )
    })

    return Promise.race([loadMyArchive(), deadline])
      .then((loaded) => {
        setArchive({ status: "ready", records: loaded.records, shareIndex: loaded.shareIndex })
      })
      .catch((cause) => {
        setArchive({ status: "error", message: (cause as Error).message })
      })
      .finally(() => {
        if (timeout) clearTimeout(timeout)
      })
  }

  useEffect(() => {
    void refreshArchive()
  }, [])

  const documents =
    archive.status === "ready"
      ? archive.records.filter((record): record is DocumentRecord => record.kind === "document")
      : []

  async function openRemoveSheet(document: DocumentRecord) {
    setRemoveSheetNow(Math.floor(Date.now() / 1000))
    setRemoveSheet({ status: "checking-shares", document })
    const shareIndex = archive.status === "ready" ? archive.shareIndex : undefined
    try {
      const { shares, indexUnknown } = await loadLiveSharesForDocument(document.id, shareIndex, senderAddress)
      setRemoveSheet({
        status: "open",
        document,
        shares,
        indexUnknown,
        endOthers: true,
        removing: false,
        error: null,
      })
    } catch (cause) {
      setRemoveSheet({
        status: "open",
        document,
        shares: [],
        indexUnknown: true,
        endOthers: false,
        removing: false,
        error: (cause as Error).message,
      })
    }
  }

  function closeRemoveSheet() {
    setRemoveSheet({ status: "closed" })
  }

  async function confirmRemove() {
    if (removeSheet.status !== "open") return
    const { document, shares, endOthers } = removeSheet
    setRemoveSheet({ ...removeSheet, removing: true, error: null })
    const outcome = await performRemoveDocument(document.id, endOthers ? shares : [], senderAddress)
    if (outcome.outcome === "refused") {
      setRemoveSheet({ ...removeSheet, removing: false, error: outcome.message })
      return
    }
    closeRemoveSheet()
    void refreshArchive()
  }

  return (
    <div className="flex w-full flex-col gap-7 md:gap-[30px]">
      <ArchiveHeader onAdd={pickPdfs} adding={isAdding} />
      <input
        ref={pdfInput}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        hidden
        aria-label="Blood test PDFs"
        onChange={addPickedPdfs}
      />

      {adding.status === "adding" && (
        <div role="status" className="rounded-inset bg-grouped p-[18px] text-[15px] text-secondary">
          {adding.count === 1 ? "Encrypting and adding your PDF…" : `Encrypting and adding ${adding.count} PDFs…`}
        </div>
      )}
      {adding.status === "error" && (
        <div role="alert" className="rounded-inset border border-error/20 bg-grouped p-[18px] text-[15px] text-error">
          Could not add these PDFs: {adding.message}
        </div>
      )}

      {archive.status === "loading" ? (
        <div role="status" className="rounded-inset bg-grouped p-[18px] text-[15px] text-secondary">
          Opening your archive…
        </div>
      ) : archive.status === "error" ? (
        <div role="alert" className="rounded-inset border border-error/20 bg-grouped p-[18px] text-[15px] text-error">
          Could not load your archive: {archive.message}
        </div>
      ) : documents.length === 0 ? (
        <EmptyArchive onAdd={pickPdfs} adding={isAdding} />
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <span className="text-eyebrow text-muted">{eyebrowLabel(documents.length)}</span>
            <div className="h-px w-full bg-hairline" />
          </div>

          <BloodTestListMobile documents={documents} onRemove={openRemoveSheet} />
          <BloodTestListDesktop documents={documents} onRemove={openRemoveSheet} onAdd={pickPdfs} adding={isAdding} />

          <SharedAsIssuedNote />
        </>
      )}

      {removeSheet.status === "checking-shares" && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 md:items-center md:p-5">
          <div
            role="status"
            className="w-full rounded-sheet bg-surface p-6 text-center text-[15px] text-secondary shadow-card md:max-w-[560px] md:rounded-card"
          >
            Checking open shares…
          </div>
        </div>
      )}

      {removeSheet.status === "open" && (
        <RemoveDocumentSheet
          document={{
            name: removeSheet.document.name,
            size: removeSheet.document.size,
            addedLabel: formatFullDate(removeSheet.document.provenance.importedAt.slice(0, 10)),
          }}
          shares={removeSheet.shares}
          indexUnknown={removeSheet.indexUnknown}
          endOthers={removeSheet.endOthers}
          onToggleEndOthers={(value) =>
            setRemoveSheet((current) => (current.status === "open" ? { ...current, endOthers: value } : current))
          }
          removing={removeSheet.removing}
          error={removeSheet.error}
          now={removeSheetNow}
          onCancel={closeRemoveSheet}
          onConfirm={confirmRemove}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Header — pen ids `exdHM`/`R4z03`/`xnf3z` (desktop) and `B41Wp`/`h9xIRp`
// (mobile, stacked with the Add action full-width below rather than beside
// the title). Desktop and mobile copy differ, read from each frame's own
// `content` fields rather than assumed to match — see `docs/stories/H-17.md`.
// ---------------------------------------------------------------------------

function ArchiveHeader({ onAdd, adding }: { onAdd: () => void; adding: boolean }) {
  return (
    <>
      <div className="flex flex-col gap-3.5 md:hidden">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-display-mobile text-ink">Your archive</h1>
          <p className="text-[15px] leading-[1.45] text-secondary">Your blood test PDFs, as the lab sent them.</p>
        </div>
        <AddBloodTestsButton className="w-full" onAdd={onAdd} adding={adding} />
      </div>

      <div className="hidden items-end justify-between gap-6 md:flex">
        <div className="flex flex-col gap-2">
          <h1 className="text-display text-ink">Your archive</h1>
          <p className="max-w-[760px] text-[17px] leading-[1.45] tracking-[-0.25px] text-secondary">
            Your blood test PDFs, exactly as the lab sent them. Nothing leaves this page unless you
            share it.
          </p>
        </div>
        <AddBloodTestsButton onAdd={onAdd} adding={adding} />
      </div>
    </>
  )
}

function AddBloodTestsButton({
  className = "",
  onAdd,
  adding,
}: {
  className?: string
  onAdd: () => void
  adding: boolean
}) {
  return (
    <button
      type="button"
      onClick={onAdd}
      disabled={adding}
      className={`inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-control bg-ink px-5 text-[15px] font-semibold tracking-[-0.15px] text-surface disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
    >
      <ArrowDown size={17} weight="regular" />
      Add blood tests
    </button>
  )
}

// ---------------------------------------------------------------------------
// Empty state — no pen frame covers this; both `M2g5J2`/`W1yi5` show three
// PDFs. Authored to match the story's instruction directly: say there is
// nothing yet, offer the one action, not five empty cards.
// ---------------------------------------------------------------------------

function EmptyArchive({ onAdd, adding }: { onAdd: () => void; adding: boolean }) {
  return (
    <div className="flex w-full flex-col items-center gap-3 rounded-card border border-black/[0.05] bg-surface px-6 py-12 text-center">
      <div className="flex h-[34px] w-[34px] items-center justify-center rounded-glyph bg-haze">
        <FileText size={18} weight="light" className="text-navy" />
      </div>
      <p className="text-[17px] font-semibold text-ink">No blood test PDFs yet</p>
      <p className="max-w-[380px] text-[13px] leading-[1.45] text-muted">
        Add one from your lab and it will show up here, exactly as they sent it.
      </p>
      <button
        type="button"
        onClick={onAdd}
        disabled={adding}
        className="mt-1 inline-flex h-11 items-center justify-center gap-2 rounded-control bg-ink px-5 text-[14px] font-semibold text-surface disabled:cursor-not-allowed disabled:opacity-60"
      >
        <ArrowDown size={16} weight="regular" />
        Add blood tests
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// The list — pen id `v5ORj` and children (desktop): one card, rows divided by
// a hairline, a final "Add blood tests" row inside the same card. Pen id
// `J1The0` and children (mobile): stacked 62px rows, the Add action lives in
// the header instead. Read via the pencil MCP tool against `healthsend.pen`.
// ---------------------------------------------------------------------------

function BloodTestListDesktop({
  documents,
  onRemove,
  onAdd,
  adding,
}: {
  documents: DocumentRecord[]
  onRemove: (document: DocumentRecord) => void
  onAdd: () => void
  adding: boolean
}) {
  return (
    <div className="hidden w-full flex-col overflow-hidden rounded-card border border-black/[0.05] bg-surface md:flex">
      {documents.map((document) => (
        <DocumentRow key={document.id} document={document} onRemove={() => onRemove(document)} />
      ))}
      <button
        type="button"
        onClick={onAdd}
        disabled={adding}
        className="flex w-full items-center gap-2 px-5 py-4 text-left disabled:cursor-not-allowed disabled:opacity-60"
      >
        <ArrowDown size={15} weight="regular" className="text-navy" />
        <span className="text-[13px] font-semibold text-navy">Add blood tests — pick one or several PDFs</span>
      </button>
    </div>
  )
}

function DocumentRow({ document, onRemove }: { document: DocumentRecord; onRemove: () => void }) {
  const added = formatFullDate(document.provenance.importedAt.slice(0, 10))
  return (
    <div className="flex items-center gap-3.5 border-b border-hairline px-5 py-4">
      <div className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-glyph bg-haze">
        <FileText size={18} weight="light" className="text-navy" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[16px] font-semibold text-ink">{document.name}</span>
        <span className="truncate text-[13px] text-muted">
          PDF · {formatBytes(document.size)} · added {added}
        </span>
      </div>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${document.name} from your archive`}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-glyph text-muted hover:bg-grouped hover:text-error"
      >
        <FileX size={17} weight="light" />
      </button>
    </div>
  )
}

function BloodTestListMobile({
  documents,
  onRemove,
}: {
  documents: DocumentRecord[]
  onRemove: (document: DocumentRecord) => void
}) {
  return (
    <div className="flex flex-col gap-[9px] md:hidden">
      {documents.map((document) => (
        <DocumentRowMobile key={document.id} document={document} onRemove={() => onRemove(document)} />
      ))}
    </div>
  )
}

function DocumentRowMobile({ document, onRemove }: { document: DocumentRecord; onRemove: () => void }) {
  const added = formatShortDate(document.provenance.importedAt.slice(0, 10))
  return (
    <div className="flex h-[62px] w-full items-center gap-[11px] rounded-control border border-black/[0.05] bg-surface px-3.5">
      <div className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-glyph bg-haze">
        <FileText size={16} weight="light" className="text-navy" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="truncate text-[15px] font-semibold text-ink">{document.name}</span>
        <span className="truncate text-[12.5px] text-muted">
          {formatBytes(document.size)} · added {added}
        </span>
      </div>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${document.name} from your archive`}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-glyph text-muted"
      >
        <FileX size={16} weight="light" />
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Identity note — pen id `fwMJY` (desktop, an inset note below the list) and
// `eR7yJ` (mobile, the same position). Replaces the old "Identity" copy: for
// PDFs, shared as issued, a name or date of birth printed on the file goes
// with it — see `docs/stories/H-66.md`, "The identity note is replaced by an
// honest one."
// ---------------------------------------------------------------------------

function SharedAsIssuedNote() {
  return (
    <>
      <div className="hidden w-full items-center gap-3.5 rounded-inset bg-grouped px-[18px] py-3.5 md:flex">
        <div className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-glyph bg-disabled">
          <FileText size={17} weight="light" className="text-muted" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[15px] font-semibold text-secondary">Shared as issued</span>
          <span className="text-[13px] leading-[1.45] text-secondary">
            Each PDF is shared exactly as your lab sent it — including your name and date of birth,
            if they are printed on it.
          </span>
        </div>
        <span className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-capsule border border-silver bg-surface px-3 text-[12.5px] font-semibold text-muted">
          <Eye size={13} weight="light" />
          As issued
        </span>
      </div>

      <div className="flex w-full items-center gap-[11px] rounded-control bg-grouped px-3.5 py-3 md:hidden">
        <div className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-glyph bg-disabled">
          <Eye size={16} weight="light" className="text-muted" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-px">
          <span className="text-[15px] font-semibold text-secondary">Shared as issued</span>
          <span className="text-[12.5px] leading-[1.4] text-muted">
            Any name or date of birth on the PDF goes with it.
          </span>
        </div>
      </div>
    </>
  )
}
