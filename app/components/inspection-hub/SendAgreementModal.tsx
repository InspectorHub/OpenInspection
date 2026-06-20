import { useFetcher } from "react-router";
import type { action } from "~/routes/inspection-hub";

/* ------------------------------------------------------------------ */
/*  Send-agreement modal                                              */
/* ------------------------------------------------------------------ */

export function SendAgreementModal({
  agreements,
  defaultEmail,
  fetcher,
  submitting,
  error,
  onClose,
}: {
  agreements: Array<{ id: string; name: string }>;
  defaultEmail: string;
  fetcher: ReturnType<typeof useFetcher<typeof action>>;
  submitting: boolean;
  error: string | undefined;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(15,23,42,0.4)]">
      <div className="bg-ih-bg-card text-ih-fg-1 rounded-lg shadow-ih-popover w-full max-w-md flex flex-col">
        <div className="px-5 py-3 border-b border-ih-border flex items-center justify-between">
          <h2 className="text-[14px] font-bold">Send agreement</h2>
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
          <input type="hidden" name="intent" value="send-agreement" />
          <div className="px-5 py-4 space-y-4">
            <div>
              <label htmlFor="agreement-email" className="block text-[12px] font-bold text-ih-fg-2 mb-1">
                Client email
              </label>
              <input
                id="agreement-email"
                name="email"
                type="email"
                required
                defaultValue={defaultEmail}
                placeholder="client@example.com"
                className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:outline-none focus:ring-2 focus:ring-ih-primary"
              />
            </div>

            <div>
              <label htmlFor="agreement-template" className="block text-[12px] font-bold text-ih-fg-2 mb-1">
                Agreement
              </label>
              <select
                id="agreement-template"
                name="agreementId"
                defaultValue={agreements[0]?.id ?? ""}
                disabled={agreements.length === 0}
                className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:outline-none focus:ring-2 focus:ring-ih-primary disabled:opacity-60"
              >
                {agreements.length === 0 ? (
                  <option value="">No agreement template available</option>
                ) : (
                  agreements.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))
                )}
              </select>
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
              disabled={submitting || agreements.length === 0}
              className="px-3 py-1.5 rounded-md bg-ih-primary text-ih-fg-inverse text-[12px] font-bold hover:bg-ih-primary-600 disabled:opacity-60"
            >
              {submitting ? "Sending…" : "Send agreement"}
            </button>
          </div>
        </fetcher.Form>
      </div>
    </div>
  );
}
