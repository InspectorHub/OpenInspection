import { redirect, useLoaderData, useSearchParams } from "react-router";
import type { Route } from "./+types/invoice";
import { createApi } from "~/lib/api-client.server";
import { brandTokens, EMPTY_BRAND } from "~/lib/brand";
// Shared with the Hub's payment section — one declaration of this wire shape,
// so the two callers cannot drift apart again.
import type { RawInvoice } from "~/lib/section-loaders";
import { formatDate } from "~/lib/format";
import { portalHubUrl } from "~/lib/portal-hub-url";
import { resolveTenantBrand } from "~/lib/tenant-brand.server";
import { PaymentSection, type InvoiceData } from "~/components/portal/sections/PaymentSection";
import { m } from "~/paraglide/messages";

export function meta() {
  return [{ title: m.invoice_meta_title() }];
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const url = new URL(request.url);
  // IA-34 — the invoice endpoint is gated by resolveClientActor; the emailed
  // pay link carries the recipient's portal token, which we forward verbatim.
  const token = url.searchParams.get("token") ?? "";
  const justPaidParam = url.searchParams.get("redirect_status") === "succeeded";
  const id = params.id ?? "";
  try {
    const api = createApi(context);
    const res = await api.publicReport.inspections[":id"].invoice.$get({
      param: { id },
      query: token ? { token } : {},
    });
    const body = res.ok ? await res.json() : {};
    const d = ((body as Record<string, unknown>).data ?? null) as RawInvoice | null;

    // IA-44 — Stripe returns here with ?redirect_status=succeeded. Rather than
    // reload this standalone page (a third, isolated payment surface), hand off
    // to the Hub carrying the same token + optimistic marker, so all three
    // payment entrances converge on one place. Requires the slug (the Hub route
    // is slug-keyed) and the token (the Hub exchanges it for the session).
    if (justPaidParam && token && d?.tenantSlug) {
      throw redirect(
        portalHubUrl({ tenant: d.tenantSlug, inspectionId: id, token, section: "payment", justPaid: true }),
      );
    }

    const brand = d?.tenantSlug
      ? await resolveTenantBrand(context, d.tenantSlug, request)
      : (d?.brand ?? EMPTY_BRAND);

    const invoice: InvoiceData | null = d
      ? {
          number: `INV-${d.id.slice(0, 8).toUpperCase()}`,
          // Issued/Due are calendar dates (YYYY-MM-DD) — format for display via
          // the shared formatter (locale only; date-only anchors to UTC). Keep
          // empty/null so the "—" / "Due on receipt" fallbacks still apply.
          date: d.createdAt ? formatDate(d.createdAt.slice(0, 10), { locale: "en-US", timeZone: "UTC" }) : "",
          dueDate: d.dueDate ? formatDate(d.dueDate, { locale: "en-US", timeZone: "UTC" }) : null,
          status: (d.status as InvoiceData["status"]) ?? "draft",
          clientName: d.clientName ?? "",
          inspectorName: "",
          lineItems: (d.lineItems ?? []).map((li) => ({ description: li.description, amount: li.amountCents / 100 })),
          total: d.amountCents / 100,
          currency: d.currency,
        }
      : null;
    // IA-34 — a 401 means "this link does not authenticate you", which is a
    // different remedy from "no such invoice": use the link from your
    // inspector's email, or ask them to resend it.
    const error = res.ok
      ? null
      : res.status === 401
        ? m.invoice_error_link_invalid()
        : m.invoice_error_not_found();
    return {
      invoice,
      brand,
      error,
      id,
      token,
      privacyUrl: brand.privacyUrl,
    };
  } catch (err) {
    // A thrown `redirect()` is a Response — never swallow it as a fetch failure.
    if (err instanceof Response) throw err;
    return { invoice: null, brand: EMPTY_BRAND, error: m.invoice_error_service_unavailable(), id, token, privacyUrl: null };
  }
}

/* ------------------------------------------------------------------ */
/* Page — thin wrapper: standalone chrome (page bg + container) around the  */
/* shared <PaymentSection> (invoice + Stripe pay form).                      */
/* ------------------------------------------------------------------ */

export default function InvoicePage() {
  const { invoice, brand, error, id, token, privacyUrl } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  // After Stripe's confirmPayment redirect the page reloads with
  // ?redirect_status=succeeded. The webhook flips the invoice to paid
  // asynchronously, so show an optimistic "received" state until the
  // loader picks up the settled invoice on a later visit.
  const justPaid = searchParams.get("redirect_status") === "succeeded";

  if (error || !invoice) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-ih-bg-app">
        <div className="text-center">
          <h1 className="font-serif text-2xl font-semibold text-ih-fg-1">{m.invoice_error_not_found()}</h1>
          <p className="text-sm text-ih-fg-3 mt-2">{error ?? m.invoice_not_available()}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-ih-bg-app py-8 px-4 print:bg-white print:py-0" style={brandTokens(brand.primaryColor)}>
      <div className="max-w-[560px] mx-auto">
        {/* Tenant brand bar */}
        {(brand.logoUrl || brand.companyName) && (
          <div className="mb-4 flex items-center gap-2.5">
            {brand.logoUrl ? (
              <img src={brand.logoUrl} alt={brand.companyName ?? m.invoice_brand_logo_alt()} className="h-8 w-auto" />
            ) : (
              <span className="font-serif text-[16px] font-semibold text-ih-fg-2">{brand.companyName}</span>
            )}
          </div>
        )}
        {/* Spec section 2 — the "from" party on an invoice is the registered
            legal entity, not the trading brand above it. An ADDITION rather
            than a swap: the bar above is brand chrome (logo OR name), and the
            invoice previously named no issuing party at all. Rendered only when
            it says something the brand bar does not. */}
        {brand.legalName && brand.legalName !== brand.companyName && (
          <p className="mb-4 text-[12px] text-ih-fg-3">
            {m.invoice_from_party({ entity: brand.legalName })}
          </p>
        )}
        <PaymentSection
          invoice={invoice}
          brand={brand}
          inspectionId={id}
          portalToken={token}
          privacyUrl={privacyUrl}
          justPaid={justPaid}
          showStandaloneChrome
        />
      </div>
    </div>
  );
}
