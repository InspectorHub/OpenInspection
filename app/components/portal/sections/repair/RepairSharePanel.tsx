/**
 * <RepairSharePanel> — the share / email / PDF panel for the Repair Request
 * Builder. Presentational: the parent owns the email fetcher + offline-queue
 * (persistence logic stays in the parent); this component receives the derived
 * values and callbacks via props.
 *
 * lint:ds — only `ih-*` design tokens; raw Tailwind colors are forbidden.
 */
import { usePdfExport, pdfActionLabel, pdfBusyHint } from "~/hooks/usePdfExport";
import { m } from "~/paraglide/messages";

interface RepairSharePanelProps {
  shareToken: string | null;
  shareUrl: string | null;
  copyLabel: string;
  emailTo: string;
  emailMsg: string;
  emailSent: boolean;
  emailSubmitting: boolean;
  emailError: string | undefined;
  onCopyShareLink: () => void;
  onEmailToChange: (value: string) => void;
  onEmailMsgChange: (value: string) => void;
  onSendEmail: () => void;
}

export function RepairSharePanel({
  shareToken,
  shareUrl,
  copyLabel,
  emailTo,
  emailMsg,
  emailSent,
  emailSubmitting,
  emailError,
  onCopyShareLink,
  onEmailToChange,
  onEmailMsgChange,
  onSendEmail,
}: RepairSharePanelProps) {
  // Shared Browser Rendering rate-limit UX for the repair-request PDF preview.
  const pdf = usePdfExport();
  return (
    <div className="bg-ih-bg-card border border-ih-border rounded-xl p-5 space-y-4">
      <p className="text-[12px] font-bold text-ih-fg-4 uppercase tracking-widest">{m.repair_share_heading()}</p>
      <div className="flex flex-wrap gap-3">
        {shareUrl && (
          <>
            <button
              type="button"
              onClick={onCopyShareLink}
              className="h-9 px-4 rounded-lg border border-ih-border text-[13px] font-semibold text-ih-fg-3 hover:bg-ih-bg-muted transition-colors"
            >
              {copyLabel}
            </button>
            <button
              type="button"
              onClick={() => pdf.exportPdf(`/api/public/repair-request/share/${shareToken}/pdf`, { mode: "view", filename: `repair-request-${shareToken}.pdf` })}
              disabled={pdf.busy}
              className="inline-flex items-center h-9 px-4 rounded-lg border border-ih-border text-[13px] font-semibold text-ih-fg-3 hover:bg-ih-bg-muted transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {pdfActionLabel(pdf, m.repair_share_view_pdf())}
            </button>
          </>
        )}
      </div>
      {pdf.error || pdf.generating ? (
        <p role="status" className="text-[12px] leading-snug text-ih-fg-3">
          {pdf.error ?? pdfBusyHint()}
        </p>
      ) : null}

      {/* Email form */}
      {shareToken && !emailSent && (
        <div className="space-y-2 pt-2 border-t border-ih-border">
          <p className="text-[12px] font-bold text-ih-fg-4 uppercase tracking-widest">
            {m.repair_share_email_heading()}
          </p>
          <input
            type="email"
            placeholder={m.repair_share_email_placeholder()}
            value={emailTo}
            onChange={(e) => onEmailToChange(e.target.value)}
            className="w-full h-8 px-3 rounded-md border border-ih-border bg-ih-bg-app text-[13px] text-ih-fg-1 placeholder:text-ih-fg-4 focus:outline-none focus:border-ih-primary"
          />
          <textarea
            placeholder={m.repair_share_email_msg_placeholder()}
            rows={2}
            value={emailMsg}
            onChange={(e) => onEmailMsgChange(e.target.value)}
            className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-app text-[13px] text-ih-fg-1 placeholder:text-ih-fg-4 resize-none focus:outline-none focus:border-ih-primary"
          />
          <button
            type="button"
            disabled={!emailTo || emailSubmitting}
            onClick={onSendEmail}
            className="h-9 px-4 rounded-lg bg-ih-primary text-ih-primary-fg text-[13px] font-bold hover:bg-ih-primary-600 transition-colors disabled:opacity-50"
          >
            {emailSubmitting ? m.portal_landing_submit_pending() : m.repair_share_email_submit()}
          </button>
          {emailError && (
            <p className="text-[12px] text-ih-bad-fg">{emailError}</p>
          )}
        </div>
      )}

      {emailSent && (
        <p className="text-[13px] text-ih-ok-fg font-semibold">{m.repair_share_email_sent()}</p>
      )}
    </div>
  );
}
