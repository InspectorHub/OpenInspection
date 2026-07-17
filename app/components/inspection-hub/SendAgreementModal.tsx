import { useFetcher } from "react-router";
import { Modal } from "@core/shared-ui";
import type { action } from "~/routes/inspection-hub";
import { m } from "~/paraglide/messages";

/* ------------------------------------------------------------------ */
/*  Send-agreement modal                                              */
/* ------------------------------------------------------------------ */

const FORM_ID = "ih-send-agreement-form";

export function SendAgreementModal({
  open,
  agreements,
  defaultEmail,
  fetcher,
  submitting,
  error,
  onClose,
}: {
  open: boolean;
  agreements: Array<{ id: string; name: string }>;
  defaultEmail: string;
  fetcher: ReturnType<typeof useFetcher<typeof action>>;
  submitting: boolean;
  error: string | undefined;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={m.hub_agreement_title()}
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
            disabled={submitting || agreements.length === 0}
            className="px-3 py-1.5 rounded-md bg-ih-primary text-ih-fg-inverse text-[12px] font-bold hover:bg-ih-primary-600 disabled:opacity-60"
          >
            {submitting ? m.hub_agreement_pending() : m.hub_agreement_submit()}
          </button>
        </>
      }
    >
      <fetcher.Form id={FORM_ID} method="post" className="space-y-4">
        <input type="hidden" name="intent" value="send-agreement" />
        <div>
          <label htmlFor="agreement-email" className="block text-[12px] font-bold text-ih-fg-2 mb-1">
            {m.hub_agreement_email_label()}
          </label>
          <input
            id="agreement-email"
            name="email"
            type="email"
            required
            defaultValue={defaultEmail}
            placeholder={m.hub_agreement_email_ph()}
            className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:outline-none focus:ring-2 focus:ring-ih-primary"
          />
        </div>

        <div>
          <label htmlFor="agreement-template" className="block text-[12px] font-bold text-ih-fg-2 mb-1">
            {m.hub_agreement_template_label()}
          </label>
          <select
            id="agreement-template"
            name="agreementId"
            defaultValue={agreements[0]?.id ?? ""}
            disabled={agreements.length === 0}
            className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:outline-none focus:ring-2 focus:ring-ih-primary disabled:opacity-60"
          >
            {agreements.length === 0 ? (
              <option value="">{m.hub_agreement_no_template()}</option>
            ) : (
              agreements.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))
            )}
          </select>
        </div>

        {error && <p className="text-[12px] font-medium text-ih-bad-fg">{error}</p>}
      </fetcher.Form>
    </Modal>
  );
}
