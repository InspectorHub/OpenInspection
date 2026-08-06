/**
 * <ReportExportBar> — the fixed bottom-right cluster of "get this report out of
 * the browser" actions: the Commercial-PCA cost exports, Export to Word, and
 * the Download PDF button with the shared Browser-Rendering rate-limit hint.
 *
 * Grouped because they share one gate and one failure story. Cost export and
 * Word export are owner-preview + commercial only — a public token viewer never
 * has `ownerPreview`, a residential report has no `reportTier`, and a report
 * with no cost rows has no `costTables`, so all three conditions hide them.
 * <WordExportButton> calls useFetcher() and therefore needs a data-router
 * context, and <ReportView> is rendered standalone in plenty of router-less
 * unit tests, so it is only MOUNTED when the gate is satisfied rather than
 * always-mounted-but-internally-hidden.
 *
 * The PDF button is driven by the shared usePdfExport state, which the report
 * owns (the same hook instance also backs any other trigger on the page).
 *
 * lint:ds — only `ih-*` design tokens; raw Tailwind colors are forbidden.
 */
import { m } from "~/paraglide/messages";
import { pdfActionLabel, pdfBusyHint, type PdfExportState } from "~/hooks/usePdfExport";
import { CostExportButtons } from "~/components/CostExportButtons";
import { WordExportButton } from "./WordExportButton";

export interface ReportExportBarProps {
  inspectionId: string;
  ownerPreview: boolean;
  /** Resolved report tier; null on residential reports. */
  reportTier: string | null;
  /** Whether the report carries at least one cost-table row. */
  hasCostTables: boolean;
  pdf: PdfExportState;
  /** The report's own fetch→blob download handler. */
  onDownload: () => void;
}

export function ReportExportBar({
  inspectionId,
  ownerPreview,
  reportTier,
  hasCostTables,
  pdf,
  onDownload,
}: ReportExportBarProps) {
  const commercialOwner = Boolean(ownerPreview) && Boolean(reportTier);
  return (
    <div className="print:hidden fixed bottom-6 right-6 z-50 flex flex-wrap items-center justify-end gap-2 max-w-[calc(100vw-3rem)]">
      {commercialOwner && hasCostTables ? (
        <CostExportButtons inspectionId={inspectionId} variant="fab" />
      ) : null}
      {commercialOwner ? (
        <WordExportButton inspectionId={inspectionId} />
      ) : null}
      <div className="flex flex-col items-end gap-2">
        {pdf.error || pdf.generating ? (
          <div
            role="status"
            className="max-w-[15rem] rounded-lg bg-ih-bg-inverse px-3 py-2 text-[11px] font-medium leading-snug text-ih-fg-inverse shadow-ih-popover"
          >
            {pdf.error ?? pdfBusyHint()}
          </div>
        ) : null}
        <button
          type="button"
          onClick={onDownload}
          disabled={pdf.busy}
          className="px-5 py-3 rounded-full bg-ih-bg-inverse text-ih-fg-inverse text-xs font-bold uppercase tracking-widest shadow-ih-popover hover:bg-ih-primary transition-all flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
          </svg>
          {pdfActionLabel(pdf, m.report_view_download_pdf())}
        </button>
      </div>
    </div>
  );
}
