/**
 * <PaymentSection> — the invoice display + Stripe pay form, extracted from the
 * standalone route `app/routes/public/invoice.tsx` so it can be rendered BOTH as
 * a standalone page AND inline inside the unified client-portal Hub (section ③,
 * "Payment").
 *
 * Data-source-agnostic: receives everything via props (no `useLoaderData`). The
 * pay flow is keyed by INSPECTION ID — it POSTs `/api/public/inspections/:id/pay-intent`
 * and reads `/api/public/inspections/:id/invoice` upstream; no signer token is required.
 *
 * Bare-content convention — it renders the invoice card + pay form ONLY; the page
 * chrome (max-width container, padding, page background) is supplied by the host
 * (the standalone route wrapper, or the Hub). It does NOT wrap itself in a
 * full-page shell.
 *
 * Stripe lazy-init — the inner pay panel owns its own <Elements> provider and
 * lazy-loads `loadStripe` only after the client clicks "Pay" (the existing
 * useEffect-free, click-driven `startPayment`). Because the Hub mounts only the
 * ACTIVE section's slot, Stripe never initializes until the Payment tab is open.
 *
 * return_url correctness — `confirmPayment` returns to `window.location.href`
 * (read inside the click handler, never at render → SSR-safe). Standalone that is
 * the invoice page; inline that is the Hub's `?section=payment` tab.
 *
 * lint:ds — only `ih-*` design tokens; raw Tailwind colors are forbidden.
 */
import { brandTokens, type TenantBrand } from "~/lib/brand";
import { m } from "~/paraglide/messages";
import { InvoiceDisplay } from "./InvoiceDisplay";
import { type InvoiceData, paymentSectionState } from "./payment-helpers";

// Re-exported so existing importers (section-loaders, the standalone invoice
// route, and the unit test) keep their stable import path on this module.
export { paymentSectionState };
export type { InvoiceData };

export interface PaymentSectionProps {
  /** Mapped invoice (dollars), or null when none/unavailable. */
  invoice: InvoiceData | null;
  brand: TenantBrand;
  /** Inspection id — keys the pay-intent + invoice fetch. */
  inspectionId: string;
  /** Tenant privacy policy link (standalone footer only). */
  privacyUrl?: string | null;
  /** After Stripe redirect with ?redirect_status=succeeded (optimistic state). */
  justPaid?: boolean;
  /** Standalone page renders an error card; inline shows a quiet empty state. */
  error?: string | null;
  /** Standalone page shows print/contact actions + privacy footer. */
  showStandaloneChrome?: boolean;
}

export function PaymentSection({
  invoice,
  brand,
  inspectionId,
  privacyUrl,
  justPaid = false,
  error,
  showStandaloneChrome = false,
}: PaymentSectionProps) {
  if (error || !invoice) {
    return (
      <div className="rounded-xl border border-ih-border bg-ih-bg-card p-6 text-center">
        <h1 className="font-serif text-xl font-semibold text-ih-fg-1">{m.portal_payment_no_invoice_title()}</h1>
        <p className="text-sm text-ih-fg-3 mt-2">{error ?? m.portal_payment_no_invoice_body()}</p>
      </div>
    );
  }

  return (
    <div style={brandTokens(brand.primaryColor)}>
      {/* Document */}
      <InvoiceDisplay invoice={invoice} brand={brand} inspectionId={inspectionId} justPaid={justPaid} />

      {/* Actions + footer (standalone page only; outside the document, not printed) */}
      {showStandaloneChrome && (
        <>
          <div className="mt-4 flex items-center justify-between print:hidden">
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-ih-border bg-ih-bg-card text-[13px] font-semibold text-ih-fg-2 hover:text-ih-fg-1 transition-colors"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M4 6V2h8v4M4 12H3a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1M4 10h8v4H4z" />
              </svg>
              {m.portal_payment_download_pdf()}
            </button>
            <p className="text-[12px] text-ih-fg-4">
              {m.portal_payment_questions({ name: invoice.inspectorName || m.portal_pay_inspector_fallback() })}
            </p>
          </div>
          {privacyUrl && (
            <p className="mt-8 text-center text-xs text-ih-fg-3 print:hidden">
              <a href={privacyUrl} target="_blank" rel="noreferrer" className="hover:underline">{m.portal_payment_privacy_policy()}</a>
            </p>
          )}
        </>
      )}
    </div>
  );
}
