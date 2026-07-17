import { useFetcher } from "react-router";
import { Modal } from "@core/shared-ui";
import type { action } from "~/routes/inspection-hub";
import { m } from "~/paraglide/messages";

/* ------------------------------------------------------------------ */
/*  Request-payment modal                                             */
/* ------------------------------------------------------------------ */

const FORM_ID = "ih-request-payment-form";

export function RequestPaymentModal({
  open,
  recipientEmail,
  amountLabel,
  resend,
  fetcher,
  submitting,
  error,
  onClose,
}: {
  open: boolean;
  recipientEmail: string;
  amountLabel: string;
  resend: boolean;
  fetcher: ReturnType<typeof useFetcher<typeof action>>;
  submitting: boolean;
  error: string | undefined;
  onClose: () => void;
}) {
  const title = resend ? m.hub_payment_title_resend() : m.hub_payment_title();
  const submitLabel = resend ? m.hub_payment_submit_resend() : m.hub_payment_submit();
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
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
            disabled={submitting || !recipientEmail}
            className="px-3 py-1.5 rounded-md bg-ih-primary text-ih-fg-inverse text-[12px] font-bold hover:bg-ih-primary-600 disabled:opacity-60"
          >
            {submitting ? m.hub_payment_pending() : submitLabel}
          </button>
        </>
      }
    >
      <fetcher.Form id={FORM_ID} method="post" className="space-y-4">
        <input type="hidden" name="intent" value="request-payment" />
        <div>
          <p className="text-[12px] font-bold text-ih-fg-2 mb-1">{m.hub_payment_recipient_label()}</p>
          <p className="text-[13px] text-ih-fg-1">
            {recipientEmail || (
              <span className="text-ih-fg-4">{m.hub_payment_no_email()}</span>
            )}
          </p>
        </div>

        <div>
          <p className="text-[12px] font-bold text-ih-fg-2 mb-1">{m.hub_payment_amount_label()}</p>
          <p className="text-[18px] font-bold text-ih-fg-1 tabular-nums">{amountLabel}</p>
        </div>

        {error && <p className="text-[12px] font-medium text-ih-bad-fg">{error}</p>}
      </fetcher.Form>
    </Modal>
  );
}
