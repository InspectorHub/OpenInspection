import { useRef, useState } from "react";
import { Button, MenuItem, Popover } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

export interface PreviewMenuProps {
  /** Open the full web report in a new tab. Null when the tenant slug is unknown. */
  onPreviewReport: (() => void) | null;
  /** Render and open the server-side PDF — the exact client deliverable. */
  onPreviewPdf: () => void;
  /** A PDF render is in flight. */
  pdfBusy: boolean;
  /** Last PDF render error, surfaced on the trigger's tooltip. */
  pdfError: string | null;
  /** PDF item label, already decorated with the hook's busy/error state. */
  pdfLabel: string;
}

/**
 * "Preview" — the report's two fidelities behind one header control.
 *
 * These were two side-by-side buttons hidden at `2xl` (web report) and `xl`
 * (PDF), which put the whole 768-1279px band — iPad landscape included — in a
 * state where Publish was reachable but neither preview was. A header is a
 * commit bar, and the rehearsal must never be less reachable than the
 * performance, so the fix is not to widen the breakpoints but to spend one
 * control where two were spent: web report and PDF are one intent at two
 * fidelities, never two decisions.
 */
export function PreviewMenu({
  onPreviewReport,
  onPreviewPdf,
  pdfBusy,
  pdfError,
  pdfLabel,
}: PreviewMenuProps) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);

  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  return (
    <>
      <Button
        ref={anchorRef}
        variant="secondary"
        size="md"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={pdfError ?? m.editor_header_preview_title()}
        icon={
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        }
      >
        <span className="hidden lg:inline">{m.editor_header_preview()}</span>
        <svg className="w-3 h-3 text-ih-fg-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </Button>

      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} align="right">
        <ul role="menu" aria-label={m.editor_header_preview_actions_aria()} className="py-1 min-w-[240px]">
          {onPreviewReport && (
            <li role="none">
              <MenuItem
                data-testid="preview-report-btn"
                onClick={() => run(onPreviewReport)}
                title={m.editor_header_preview_full_title()}
              >
                {m.editor_header_preview_report()}
              </MenuItem>
            </li>
          )}
          <li role="none">
            <MenuItem
              data-testid="preview-pdf-btn"
              onClick={() => run(onPreviewPdf)}
              disabled={pdfBusy}
              title={pdfError ?? m.editor_header_preview_pdf_title()}
            >
              {pdfLabel}
            </MenuItem>
          </li>
        </ul>
      </Popover>
    </>
  );
}
