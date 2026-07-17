import { useFetcher } from "react-router";
import { Modal } from "@core/shared-ui";
import type { action } from "~/routes/inspection-hub";
import { m } from "~/paraglide/messages";

/* ------------------------------------------------------------------ */
/*  Publish-report modal                                              */
/* ------------------------------------------------------------------ */

const FORM_ID = "ih-publish-report-form";

export function PublishReportModal({
  open,
  agreementRequired,
  paymentRequired,
  fetcher,
  submitting,
  error,
  onClose,
}: {
  open: boolean;
  agreementRequired: boolean;
  paymentRequired: boolean;
  fetcher: ReturnType<typeof useFetcher<typeof action>>;
  submitting: boolean;
  error: string | undefined;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={m.hub_publish_title()}
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
            disabled={submitting}
            className="px-3 py-1.5 rounded-md bg-ih-primary text-ih-fg-inverse text-[12px] font-bold hover:bg-ih-primary-600 disabled:opacity-60"
          >
            {submitting ? m.hub_publish_pending() : m.hub_publish_submit()}
          </button>
        </>
      }
    >
      <fetcher.Form id={FORM_ID} method="post" className="space-y-3">
        <input type="hidden" name="intent" value="publish" />
        {/* No theme picker — rides the editor's effective default (server
            'modern'); the action sends theme:"modern" explicitly. */}
        <ToggleRow name="notifyClient" label={m.hub_publish_notify_client()} defaultChecked />
        <ToggleRow name="notifyAgent" label={m.hub_publish_notify_agent()} defaultChecked={false} />
        <ToggleRow
          name="requireSignature"
          label={m.hub_publish_require_signature()}
          defaultChecked={agreementRequired}
        />
        <ToggleRow
          name="requirePayment"
          label={m.hub_publish_require_payment()}
          defaultChecked={paymentRequired}
        />

        {error && <p className="text-[12px] font-medium text-ih-bad-fg">{error}</p>}
      </fetcher.Form>
    </Modal>
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
