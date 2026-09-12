"use client"

/**
 * "Remove this from your archive" — pen id `i90sl` ("2.7p Remove a PDF ·
 * sheet"), read via the pencil MCP tool against `healthsend.pen`, not a
 * screenshot. One component, two placements (DESIGN.md § Removing data):
 * capped at 560 and centred on desktop, full-bleed and bottom-anchored on a
 * phone — the same responsive treatment `app/(sender)/shares/page.tsx`'s
 * `ConfirmEndSheet` already uses for "End access now".
 *
 * Presentational only. The caller (the archive list row, once H-66 lands —
 * see docs/stories/H-18.md "## Choices") owns state: which live shares
 * include this document (`sharesIncludingDocument`, lib/archive.ts), the
 * checkbox, the in-flight flag, and calling `performRemoveDocument`
 * (remove-document-sheet-logic.ts) on confirm.
 */

import { FilePdf, LinkSimple, PaperPlaneTilt, ShieldCheck, XCircle } from "@phosphor-icons/react"
import {
  endAllCheckboxLabel,
  endsLabel,
  openedNoteText,
  shareLabel,
  sharesHeadline,
  shouldShowSharesCard,
  UNKNOWN_SHARES_NOTE,
  type LiveShareView,
} from "./remove-document-sheet-logic"

export type RemoveDocumentSheetProps = {
  document: { name: string; size: number; addedLabel: string }
  /** Live shares that include this document, per `sharesIncludingDocument`. */
  shares: LiveShareView[]
  /** True when the archive's share index predates this story and cannot account for the sender's other live archive shares. */
  indexUnknown: boolean
  endOthers: boolean
  onToggleEndOthers: (value: boolean) => void
  removing: boolean
  error: string | null
  now: number
  onCancel: () => void
  onConfirm: () => void
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function RemoveDocumentSheet({
  document,
  shares,
  indexUnknown,
  endOthers,
  onToggleEndOthers,
  removing,
  error,
  now,
  onCancel,
  onConfirm,
}: RemoveDocumentSheetProps) {
  const showSharesCard = shouldShowSharesCard(shares, indexUnknown)
  const note = openedNoteText(shares)

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 md:items-center md:p-5"
      onClick={() => !removing && onCancel()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="remove-document-title"
        className="w-full rounded-sheet bg-surface shadow-card md:max-w-[560px] md:rounded-card"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex h-[26px] w-full items-center justify-center md:hidden">
          <div className="h-1 w-[38px] rounded-full bg-silver" />
        </div>

        <div className="flex w-full flex-col gap-[18px] px-[26px] pb-[26px] pt-1.5">
          <h2
            id="remove-document-title"
            className="text-[26px] font-bold leading-[1.2] tracking-[-0.6px] text-ink"
          >
            Remove this from your archive
          </h2>

          <div className="flex h-16 w-full items-center gap-3 rounded-inset bg-grouped px-4">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-glyph bg-silver">
              <FilePdf size={17} weight="light" className="text-secondary" />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-[15px] font-semibold text-ink">{document.name}</span>
              <span className="truncate text-[13px] text-muted">
                PDF · {formatBytes(document.size)} · added {document.addedLabel}
              </span>
            </div>
          </div>

          {showSharesCard && (
            <div className="flex w-full flex-col gap-3 rounded-inset bg-chalk p-[18px]">
              <div className="flex items-center gap-[9px]">
                <PaperPlaneTilt size={17} weight="light" className="text-umber" />
                <span className="text-[15px] font-semibold tracking-[-0.1px] text-umber">
                  {indexUnknown ? "Some shares can't be checked" : sharesHeadline(shares.length)}
                </span>
              </div>
              <p className="text-[13px] leading-[1.5] text-umber">
                {indexUnknown
                  ? UNKNOWN_SHARES_NOTE
                  : "Removing it here keeps it out of any new share. Each share below sealed its own copy when you made it, so that copy stays openable until the share ends — unless you end them now. Ending a share ends everything in it, not only this PDF."}
              </p>

              {!indexUnknown &&
                shares.map((share) => (
                  <div
                    key={share.entityKey}
                    className="flex min-h-12 w-full items-center gap-2.5 rounded-control bg-surface px-[13px] py-2.5"
                  >
                    <LinkSimple size={15} weight="light" className="shrink-0 text-secondary" />
                    {/* Side by side at the 560px width `i90sl` draws; stacked below that —
                        a real phone's usable width is well under 560 even full-bleed, and
                        the single-line layout truncated "Share of 2 documents" mid-word
                        once the ends-date shared the line with it. See `## Choices`. */}
                    <div className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-2.5 gap-y-0.5">
                      <span className="truncate text-[14px] font-medium text-ink">
                        {shareLabel(share.documentIds)}
                      </span>
                      <span className="shrink-0 text-[12.5px] text-muted">
                        {endsLabel(share.expiresAt, now)}
                      </span>
                    </div>
                  </div>
                ))}

              {!indexUnknown && shares.length > 0 && (
                <label className="flex items-center gap-[11px] pt-1">
                  <input
                    type="checkbox"
                    checked={endOthers}
                    onChange={(event) => onToggleEndOthers(event.target.checked)}
                    disabled={removing}
                    className="h-[22px] w-[22px] shrink-0 rounded-[7px] accent-ink"
                  />
                  <span className="text-[14px] font-medium leading-[1.4] text-ink">
                    {endAllCheckboxLabel(shares.length)}
                  </span>
                </label>
              )}
            </div>
          )}

          {note && (
            <div className="flex w-full items-start gap-[11px] rounded-inset bg-grouped p-4">
              <ShieldCheck size={17} weight="light" className="mt-0.5 shrink-0 text-secondary" />
              <p className="text-[13px] leading-[1.5] text-secondary">{note}</p>
            </div>
          )}

          {error && (
            <p role="alert" className="text-[13px] text-error">
              {error}
            </p>
          )}

          <div className="flex w-full gap-2.5">
            <button
              type="button"
              onClick={onConfirm}
              disabled={removing}
              className="flex h-[52px] flex-1 items-center justify-center gap-2 rounded-control border border-error bg-surface text-[17px] font-semibold tracking-[-0.25px] text-error disabled:cursor-not-allowed"
            >
              <XCircle size={17} weight="light" />
              {removing ? "Removing…" : "Remove it"}
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={removing}
              className="flex h-[52px] flex-1 items-center justify-center rounded-control bg-ink text-[17px] font-semibold tracking-[-0.25px] text-surface disabled:cursor-not-allowed"
            >
              Keep it
            </button>
          </div>

          <p className="text-center text-[12.5px] leading-[1.45] text-muted">
            There is no undo. Earlier encrypted copies stay in storage, sealed with a key only your
            passkey can make.
          </p>
        </div>
      </div>
    </div>
  )
}
