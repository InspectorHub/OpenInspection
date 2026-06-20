import { useFetcher } from "react-router";
import type { action } from "~/routes/inspection-hub";

/* ------------------------------------------------------------------ */
/*  Publish-report modal                                              */
/* ------------------------------------------------------------------ */

export function PublishReportModal({
  agreementRequired,
  paymentRequired,
  fetcher,
  submitting,
  error,
  onClose,
}: {
  agreementRequired: boolean;
  paymentRequired: boolean;
  fetcher: ReturnType<typeof useFetcher<typeof action>>;
  submitting: boolean;
  error: string | undefined;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(15,23,42,0.4)]">
      <div className="bg-ih-bg-card text-ih-fg-1 rounded-lg shadow-ih-popover w-full max-w-md flex flex-col">
        <div className="px-5 py-3 border-b border-ih-border flex items-center justify-between">
          <h2 className="text-[14px] font-bold">Publish report</h2>
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
          <input type="hidden" name="intent" value="publish" />
          {/* No theme picker — rides the editor's effective default (server
              'modern'); the action sends theme:"modern" explicitly. */}
          <div className="px-5 py-4 space-y-3">
            <ToggleRow
              name="notifyClient"
              label="Notify client by email"
              defaultChecked
            />
            <ToggleRow name="notifyAgent" label="Notify agent" defaultChecked={false} />
            <ToggleRow
              name="requireSignature"
              label="Require signature before viewing"
              defaultChecked={agreementRequired}
            />
            <ToggleRow
              name="requirePayment"
              label="Require payment before viewing"
              defaultChecked={paymentRequired}
            />

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
              disabled={submitting}
              className="px-3 py-1.5 rounded-md bg-ih-primary text-ih-fg-inverse text-[12px] font-bold hover:bg-ih-primary-600 disabled:opacity-60"
            >
              {submitting ? "Publishing…" : "Publish report"}
            </button>
          </div>
        </fetcher.Form>
      </div>
    </div>
  );
}

/** A labeled checkbox row for the publish modal toggles (DS tokens). */
function ToggleRow({
  name,
  label,
  defaultChecked,
}: {
  name: string;
  label: string;
  defaultChecked: boolean;
}) {
  return (
    <label className="flex items-center gap-2.5 text-[13px] text-ih-fg-1 cursor-pointer">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="rounded border-ih-border text-ih-primary focus:ring-ih-primary"
      />
      <span>{label}</span>
    </label>
  );
}
