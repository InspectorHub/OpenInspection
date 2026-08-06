import { Pill, type PillTone } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

/**
 * The Status column of the invoices table.
 *
 * The pill states the lifecycle status, and for a PAID invoice it also states
 * HOW — "PAID · Cheque". That second half is not decoration: on a page whose
 * job is chasing money, "we have it" and "we have it as a cheque somebody still
 * has to bank" are different facts, and the method is the only place the
 * distinction shows without opening the ledger.
 */

/** Only the invoice fields this cell reads; the page passes its own row. */
type StatusInvoice = {
  status: "draft" | "sent" | "paid" | "partial" | "void";
  paymentMethod: "card" | "check" | "cash" | "offline" | "other" | null;
};

const STATUS_TONE: Record<StatusInvoice["status"], PillTone> = {
  paid: "sat",
  partial: "monitor",
  sent: "info",
  draft: "neutral",
  void: "neutral",
};

function methodLabel(method: string): string {
  const labels: Record<string, string> = {
    card: m.invoices_method_label_card(),
    check: m.invoices_method_label_check(),
    cash: m.invoices_method_label_cash(),
    offline: m.invoices_method_label_offline(),
    other: m.invoices_method_label_other(),
  };
  return labels[method];
}

export function InvoiceStatusCell({ invoice }: { invoice: StatusInvoice }) {
  const isPaid = invoice.status === "paid";
  return (
    <Pill tone={STATUS_TONE[invoice.status] ?? "neutral"} className="uppercase tracking-wide">
      {invoice.status}
      {isPaid && invoice.paymentMethod && (
        <span className="font-medium normal-case tracking-normal opacity-80">· {methodLabel(invoice.paymentMethod)}</span>
      )}
    </Pill>
  );
}
