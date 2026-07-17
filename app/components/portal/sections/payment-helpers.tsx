/**
 * Pure helpers + the unit-testable display-state adapter for <PaymentSection>.
 * No router / window — safe to import from tests and from the section's
 * sub-components (InvoiceDisplay / StripePayPanel).
 */
import type { PillTone } from "@core/shared-ui";
import { formatDollars } from "~/lib/money";

export interface InvoiceData {
  number: string;
  date: string;
  dueDate: string | null;
  status: "draft" | "sent" | "paid" | "overdue" | "void";
  clientName: string;
  inspectorName: string;
  lineItems: { description: string; amount: number }[];
  total: number;
  // Phase B — the invoice's snapshot currency (ISO 4217). Optional so callers that
  // predate the snapshot (or build a bare estimate) fall back to USD in `money()`.
  currency?: string;
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

/** Dollars -> currency string; whole dollars drop the `.00` (whole-dollar
 *  convention). locale/currency default to en-US/USD; callers thread the viewer
 *  values to localize. Delegates to the shared formatter (integer-cents in). */
export function money(n: number, opts?: { locale?: string; currency?: string }): string {
  return formatDollars(Math.round(n * 100), { locale: opts?.locale ?? "en-US", currency: opts?.currency ?? "USD" });
}

export const STATUS_TONE: Record<InvoiceData["status"], PillTone> = {
  paid: "sat",
  sent: "info",
  overdue: "defect",
  draft: "neutral",
  void: "neutral",
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
