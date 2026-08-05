import { formatCurrency } from "~/lib/format";
import { remainingCents } from "~/lib/hub-blocks";
import { m } from "~/paraglide/messages";

/**
 * The Amount column of the invoices table.
 *
 * The column states what was BILLED. On a partially paid invoice that is not
 * what is owed, and the status pill beside it can only say "partial" — so the
 * outstanding figure goes here, under the total.
 *
 * Both figures render in the invoice's OWN snapshot currency, never the viewer's
 * live default: a historical record must not get re-labelled when the tenant
 * switches currency, and two amounts in one cell disagreeing about their unit
 * would be worse than showing one.
 *
 * The balance is omitted — not zeroed — whenever it is unknowable: money
 * redacted for this viewer, or a partial with no recorded amount. See
 * `remainingCents`.
 */
export function InvoiceAmountCell({
    invoice,
    currency: fallbackCurrency,
    locale,
}: {
    /** Structural — any row carrying these four fields, so the table's own
     *  `InvoiceRow` type stays private to the route. */
    invoice: { amountCents: number; amountPaidCents: number | null; status: string; currency: string };
    /** Used only when the row carries no snapshot currency of its own. */
    currency: string;
    locale: string;
}) {
    const { amountCents, status } = invoice;
    const currency = invoice.currency || fallbackCurrency;
    const remaining = status === "partial" ? remainingCents(invoice) : null;
    return (
        <div>
            <span className="font-mono text-ih-fg-1">{formatCurrency(amountCents, { locale, currency })}</span>
            {remaining !== null && (
                <span className="block font-mono text-[11px] text-ih-watch-fg">
                    {m.label_hub_invoice_remaining({ amount: formatCurrency(remaining, { locale, currency }) })}
                </span>
            )}
        </div>
    );
}
