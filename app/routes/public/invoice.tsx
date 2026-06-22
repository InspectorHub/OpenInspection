import { useLoaderData, useSearchParams } from "react-router";
import type { Route } from "./+types/invoice";
import { createApi } from "~/lib/api-client.server";
import { brandTokens, EMPTY_BRAND, type TenantBrand } from "~/lib/brand";
import { readLegalLinks } from "~/lib/legal-links.server";
import { PaymentSection, type InvoiceData } from "~/components/portal/sections/PaymentSection";

export function meta() {
  return [{ title: "Invoice - OpenInspection" }];
}

/** Wire shape of GET /api/public/inspections/:id/invoice (cents + ISO dates + brand). */
interface RawInvoice {
  id: string;
  amountCents: number;
  status: string;
  createdAt?: string | null;
  dueDate?: string | null;
  clientName?: string | null;
  lineItems?: { description: string; amountCents: number }[];
  brand?: TenantBrand;
}

export async function loader({ params, context }: Route.LoaderArgs) {
  const privacyUrl = readLegalLinks(context)?.privacyUrl ?? null;
  try {
    const api = createApi(context);
    const res = await api.publicReport.inspections[":id"].invoice.$get({ param: { id: params.id ?? "" } });
    const body = res.ok ? await res.json() : {};
    const d = ((body as Record<string, unknown>).data ?? null) as RawInvoice | null;
    const invoice: InvoiceData | null = d
      ? {
          number: `INV-${d.id.slice(0, 8).toUpperCase()}`,
          date: d.createdAt?.slice(0, 10) ?? "",
          dueDate: d.dueDate ?? null,
          status: (d.status as InvoiceData["status"]) ?? "draft",
          clientName: d.clientName ?? "",
          inspectorName: "",
          lineItems: (d.lineItems ?? []).map((li) => ({ description: li.description, amount: li.amountCents / 100 })),
          total: d.amountCents / 100,
        }
      : null;
    return {
      invoice,
      brand: d?.brand ?? EMPTY_BRAND,
      error: res.ok ? null : "Invoice not found",
      id: params.id ?? "",
      privacyUrl,
    };
  } catch {
    return { invoice: null, brand: EMPTY_BRAND, error: "Service unavailable", id: params.id ?? "", privacyUrl };
  }
}

/* ------------------------------------------------------------------ */
/* Page — thin wrapper: standalone chrome (page bg + container) around the  */
/* shared <PaymentSection> (invoice + Stripe pay form).                      */
/* ------------------------------------------------------------------ */

export default function InvoicePage() {
  const { invoice, brand, error, id, privacyUrl } = useLoaderData<typeof loader>();
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
          <h1 className="font-serif text-2xl font-semibold text-ih-fg-1">Invoice not found</h1>
          <p className="text-sm text-ih-fg-3 mt-2">{error ?? "This invoice is not available."}</p>
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
              <img src={brand.logoUrl} alt={brand.companyName ?? "Logo"} className="h-8 w-auto" />
            ) : (
              <span className="font-serif text-[16px] font-semibold text-ih-fg-2">{brand.companyName}</span>
            )}
          </div>
        )}
        <PaymentSection
          invoice={invoice}
          brand={brand}
          inspectionId={id}
          privacyUrl={privacyUrl}
          justPaid={justPaid}
          showStandaloneChrome
        />
      </div>
    </div>
  );
}
