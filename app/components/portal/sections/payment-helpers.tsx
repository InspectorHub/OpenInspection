/**
 * Pure helpers + the unit-testable display-state adapter for <PaymentSection>.
 * No router / window — safe to import from tests and from the section's
 * sub-components (InvoiceDisplay / StripePayPanel).
 */

export interface InvoiceData {
  number: string;
  date: string;
  dueDate: string | null;
  status: "draft" | "sent" | "paid" | "overdue" | "void";
  clientName: string;
  inspectorName: string;
  lineItems: { description: string; amount: number }[];
  total: number;
}

/**
 * Map invoice/payment data → a display mode. Pure: no React / router / window.
 *   - 'paid'          : paymentStatus 'paid' OR invoice status 'paid'.
 *   - 'needs-payment' : there is a positive balance owed and it is not paid/void.
 *   - 'none'          : no invoice, void, or draft with nothing owed.
 */
export function paymentSectionState(data: {
  paymentStatus?: string;
  status?: string;
  amountCents?: number;
  total?: number;
}): { mode: "paid" | "needs-payment" | "none"; amountCents?: number } {
  const cents =
    typeof data.amountCents === "number"
      ? data.amountCents
      : typeof data.total === "number"
        ? Math.round(data.total * 100)
        : undefined;

  const isPaid = data.paymentStatus === "paid" || data.status === "paid";
  if (isPaid) return { mode: "paid", amountCents: cents };

  const isVoid = data.status === "void";
  const owes = typeof cents === "number" ? cents > 0 : false;
  if (!isVoid && owes) return { mode: "needs-payment", amountCents: cents };

  return { mode: "none", amountCents: cents };
}

export function money(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: n % 1 === 0 ? 0 : 2,
  }).format(n);
}

export const STATUS_PILL: Record<string, string> = {
  paid: "bg-ih-ok-bg text-ih-ok-fg",
  sent: "bg-ih-info-bg text-ih-info-fg",
  overdue: "bg-ih-bad-bg text-ih-bad-fg",
  draft: "bg-ih-bg-muted text-ih-fg-3",
  void: "bg-ih-bg-muted text-ih-fg-3",
};

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-ih-fg-4 mb-0.5">{label}</p>
      <p className="text-[13px] text-ih-fg-1 font-medium truncate">{children}</p>
    </div>
  );
}

export function Row({ label, value, muted, strong, tone }: { label: string; value: string; muted?: boolean; strong?: boolean; tone?: "ok" }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className={`${strong ? "font-bold text-ih-fg-1" : "text-ih-fg-3"} ${muted && !strong ? "text-ih-fg-3" : ""}`}>{label}</span>
      <span className={`font-mono tabular-nums ${tone === "ok" ? "text-ih-ok-fg" : strong ? "font-bold text-ih-fg-1" : "text-ih-fg-2"}`}>{value}</span>
    </div>
  );
}
