import { Link } from "react-router";
import { m } from "~/paraglide/messages";

/**
 * The Action column of the invoices table — every verb one invoice offers.
 *
 * It is a component rather than an inline cell because it holds a small state
 * machine of its own: the row is either showing its verbs or showing the
 * payment-method picker, and which verbs exist depends on whether the invoice
 * is paid and whether it has an inspection behind it. The page owns the state
 * (one picker open at a time across the table); this owns what each branch
 * renders.
 *
 * IA-122/IA-123 are the reason the branches look the way they do:
 * - "View inspection" appears on EVERY row that has one, paid or not.
 *   Previously only paid rows got a button, so the invoice actually needing
 *   chasing was the one you could not click through from. It is one control
 *   for one destination — the client's name is not a link, because a name
 *   reads as a name and announced as "View inspection" to a screen reader.
 * - "Payments" appears on every row including paid ones. "Mark paid" answers
 *   "is it settled?"; this answers the question a dispute turns on — which
 *   payments arrived, when, by what means, and who wrote them down.
 * - "Void" exists at all because a standalone invoice used to end its life as
 *   a bare "—": nothing to open, nothing to correct. DELETE /api/invoices/{id}
 *   voids rather than deletes and the row survives for the audit trail, so the
 *   verb is "Void" and the confirm copy says the same.
 */

/** Only the invoice fields this surface reads; the page passes its own row. */
type ActionInvoice = {
  id: string;
  status: "draft" | "sent" | "paid" | "partial" | "void";
  inspectionId: string | null;
};

// Built as a thunk (not a module-level const) so the Paraglide `m.*()` labels
// resolve inside the per-request locale scope instead of freezing at import.
function getPayMethods() {
  return [
    { value: "check", label: m.invoices_pay_method_check() },
    { value: "cash", label: m.invoices_pay_method_cash() },
    { value: "offline", label: m.invoices_pay_method_offline() },
    { value: "other", label: m.invoices_pay_method_other() },
  ] as const;
}

interface Props {
  invoice: ActionInvoice;
  /** This row has a submission in flight; its destructive verbs are disabled. */
  busy: boolean;
  /** This row is the one showing the payment-method picker. */
  pickerOpen: boolean;
  onOpenPicker: () => void;
  onCancelPicker: () => void;
  onOpenPayments: () => void;
  onMarkPaid: (method: string) => void;
  onVoid: () => void;
}

export function InvoiceRowActions({
  invoice,
  busy,
  pickerOpen,
  onOpenPicker,
  onCancelPicker,
  onOpenPayments,
  onMarkPaid,
  onVoid,
}: Props) {
  const isPaid = invoice.status === "paid";

  const payments = (
    <button
      onClick={onOpenPayments}
      className="px-3 h-7 rounded-md border border-ih-border bg-ih-bg-card text-[12px] font-bold text-ih-fg-2 hover:bg-ih-bg-muted transition-colors"
    >
      {m.invoices_payments_button()}
    </button>
  );

  const viewInspection = invoice.inspectionId ? (
    <Link
      to={`/inspections/${invoice.inspectionId}`}
      className="px-3 h-7 inline-flex items-center rounded-md border border-ih-border bg-ih-bg-card text-[12px] font-bold text-ih-fg-2 hover:bg-ih-bg-muted transition-colors"
    >
      {m.invoices_row_view_inspection()}
    </Link>
  ) : null;

  const voidAction = (
    <button
      onClick={onVoid}
      disabled={busy}
      className="px-3 h-7 rounded-md text-[12px] font-bold text-ih-bad-fg hover:underline disabled:opacity-50"
    >
      {m.invoices_action_void()}
    </button>
  );

  if (isPaid) {
    return (
      <div className="inline-flex items-center justify-end gap-1.5">
        {viewInspection}
        {payments}
        {voidAction}
      </div>
    );
  }
  if (pickerOpen) {
    return (
      <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
        <span className="text-[11px] text-ih-fg-3 mr-1">{m.invoices_paid_by()}</span>
        {getPayMethods().map((method) => (
          <button
            key={method.value}
            onClick={() => onMarkPaid(method.value)}
            disabled={busy}
            className="px-2 h-7 rounded-md border border-ih-border bg-ih-bg-card text-[12px] font-semibold text-ih-fg-2 hover:border-ih-ok-fg hover:text-ih-ok-fg transition-colors disabled:opacity-50"
          >
            {method.label}
          </button>
        ))}
        <button
          onClick={onCancelPicker}
          disabled={busy}
          className="px-2 h-7 rounded-md text-[12px] font-semibold text-ih-fg-4 hover:text-ih-fg-2 disabled:opacity-50"
        >
          {m.common_cancel()}
        </button>
      </div>
    );
  }
  return (
    <div className="inline-flex items-center justify-end gap-1.5">
      {viewInspection}
      {payments}
      <button
        onClick={onOpenPicker}
        className="px-3 h-7 rounded-md border border-ih-border bg-ih-bg-card text-[12px] font-bold text-ih-fg-2 hover:bg-ih-bg-muted transition-colors"
      >
        {m.invoices_mark_paid()}
      </button>
      {voidAction}
    </div>
  );
}
