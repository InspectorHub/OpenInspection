import { useFetcher } from "react-router";
import { Modal } from "@core/shared-ui";
import type { action } from "~/routes/inspection-hub";
import type { ReinspectCandidate } from "~/lib/inspection-hub-helpers";
import { m } from "~/paraglide/messages";

/* ------------------------------------------------------------------ */
/*  Create-re-inspection modal (#119)                                 */
/* ------------------------------------------------------------------ */

const FORM_ID = "ih-create-reinspection-form";

export function CreateReinspectionModal({
  open,
  candidates,
  fetcher,
  submitting,
  error,
  onClose,
}: {
  open: boolean;
  candidates: ReinspectCandidate[];
  fetcher: ReturnType<typeof useFetcher<typeof action>>;
  submitting: boolean;
  error: string | undefined;
  onClose: () => void;
}) {
  const hasCandidates = candidates.length > 0;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={m.hub_reinspect_title()}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-md border border-ih-border text-[12px] font-bold text-ih-fg-2 hover:bg-ih-bg-muted"
          >
            {m.common_cancel()}
          </button>
          <button
            type="submit"
            form={FORM_ID}
            disabled={submitting || !hasCandidates}
            className="px-3 py-1.5 rounded-md bg-ih-primary text-ih-fg-inverse text-[12px] font-bold hover:bg-ih-primary-600 disabled:opacity-60"
          >
            {submitting ? m.hub_reinspect_pending() : m.hub_reinspect_submit()}
          </button>
        </>
      }
    >
      <fetcher.Form id={FORM_ID} method="post" className="space-y-3">
        <input type="hidden" name="intent" value="create-reinspection" />
        {hasCandidates ? (
          <>
            <p className="text-[12px] text-ih-fg-3">
              {m.hub_reinspect_help()}
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
            {m.hub_reinspect_empty()}
          </p>
        )}

        {error && <p className="text-[12px] font-medium text-ih-bad-fg">{error}</p>}
      </fetcher.Form>
    </Modal>
  );
}
