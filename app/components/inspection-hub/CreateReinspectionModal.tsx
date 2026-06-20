import { useFetcher } from "react-router";
import type { action } from "~/routes/inspection-hub";
import type { ReinspectCandidate } from "~/lib/inspection-hub-helpers";

/* ------------------------------------------------------------------ */
/*  Create-re-inspection modal (#119)                                 */
/* ------------------------------------------------------------------ */

export function CreateReinspectionModal({
  candidates,
  fetcher,
  submitting,
  error,
  onClose,
}: {
  candidates: ReinspectCandidate[];
  fetcher: ReturnType<typeof useFetcher<typeof action>>;
  submitting: boolean;
  error: string | undefined;
  onClose: () => void;
}) {
  const hasCandidates = candidates.length > 0;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(15,23,42,0.4)]">
      <div className="bg-ih-bg-card text-ih-fg-1 rounded-lg shadow-ih-popover w-full max-w-md flex flex-col max-h-[85vh]">
        <div className="px-5 py-3 border-b border-ih-border flex items-center justify-between">
          <h2 className="text-[14px] font-bold">Create re-inspection</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-ih-fg-4 hover:text-ih-fg-2 w-6 h-6 flex items-center justify-center"
            aria-label="Close"
          >
            &#x2715;
          </button>
        </div>

        <fetcher.Form method="post" className="flex flex-col min-h-0">
          <input type="hidden" name="intent" value="create-reinspection" />
          <div className="px-5 py-4 space-y-3 overflow-y-auto">
            {hasCandidates ? (
              <>
                <p className="text-[12px] text-ih-fg-3">
                  Choose which items to carry forward. Still-open flagged items are
                  pre-selected.
                </p>
                <div className="divide-y divide-ih-border">
                  {candidates.map((c) => (
                    <label
                      key={c.itemId}
                      className="flex items-start gap-2.5 py-2 text-[13px] text-ih-fg-1 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        name="selectedItemIds"
                        value={c.itemId}
                        defaultChecked={c.open}
                        className="mt-0.5 rounded border-ih-border text-ih-primary focus:ring-ih-primary"
                      />
                      <span className="min-w-0">
                        <span className="font-medium block">{c.label}</span>
                        {c.originalNotes && (
                          <span className="text-[12px] text-ih-fg-3 block truncate">
                            {c.originalNotes}
                          </span>
                        )}
                      </span>
                    </label>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-[13px] text-ih-fg-4">
                This report has no items available to carry forward.
              </p>
            )}

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
              disabled={submitting || !hasCandidates}
              className="px-3 py-1.5 rounded-md bg-ih-primary text-ih-fg-inverse text-[12px] font-bold hover:bg-ih-primary-600 disabled:opacity-60"
            >
              {submitting ? "Creating…" : "Create re-inspection"}
            </button>
          </div>
        </fetcher.Form>
      </div>
    </div>
  );
}
