import { useFetcher } from "react-router";
import type { action } from "~/routes/inspection-hub";

/* ------------------------------------------------------------------ */
/*  Request-payment modal                                             */
/* ------------------------------------------------------------------ */

export function RequestPaymentModal({
  recipientEmail,
  amountLabel,
  resend,
  fetcher,
  submitting,
  error,
  onClose,
}: {
  recipientEmail: string;
  amountLabel: string;
  resend: boolean;
  fetcher: ReturnType<typeof useFetcher<typeof action>>;
  submitting: boolean;
  error: string | undefined;
  onClose: () => void;
}) {
  const title = resend ? "Resend payment request" : "Request payment";
  const submitLabel = resend ? "Resend request" : "Send request";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(15,23,42,0.4)]">
      <div className="bg-ih-bg-card text-ih-fg-1 rounded-lg shadow-ih-popover w-full max-w-md flex flex-col">
        <div className="px-5 py-3 border-b border-ih-border flex items-center justify-between">
          <h2 className="text-[14px] font-bold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-ih-fg-4 hover:text-ih-fg-2 w-6 h-6 flex items-center justify-center"
            aria-label="Close"
          >
            &#x2715;
          </button>
        </div>

        <fetcher.Form method="post" className="flex flex-col">
          <input type="hidden" name="intent" value="request-payment" />
          <div className="px-5 py-4 space-y-4">
            <div>
              <p className="text-[12px] font-bold text-ih-fg-2 mb-1">Recipient</p>
              <p className="text-[13px] text-ih-fg-1">
                {recipientEmail || (
                  <span className="text-ih-fg-4">No client email on this inspection</span>
                )}
              </p>
            </div>

            <div>
              <p className="text-[12px] font-bold text-ih-fg-2 mb-1">Amount</p>
              <p className="text-[18px] font-bold text-ih-fg-1 tabular-nums">{amountLabel}</p>
            </div>

            {error && (
              <p className="text-[12px] font-medium text-ih-bad-fg">{error}</p>
            )}
          </div>

          <div className="px-5 py-3 border-t border-ih-border flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-md border border-ih-border text-[12px] font-bold text-ih-fg-2 hover:bg-ih-bg-muted"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !recipientEmail}
              className="px-3 py-1.5 rounded-md bg-ih-primary text-ih-fg-inverse text-[12px] font-bold hover:bg-ih-primary-600 disabled:opacity-60"
            >
              {submitting ? "Sending…" : submitLabel}
            </button>
          </div>
        </fetcher.Form>
      </div>
    </div>
  );
}
