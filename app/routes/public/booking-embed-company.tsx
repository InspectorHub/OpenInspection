// IA-26 — company-level embed variant: same widget, no inspector slug.
// Bookings submit without inspectorId and the server auto-assigns the
// first available qualified inspector.

import { useLoaderData } from "react-router";
import type { Route } from "./+types/booking-embed-company";
import { createApi } from "~/lib/api-client.server";
import { resolveTenantBrand } from "~/lib/tenant-brand.server";
import { readLegalLinks } from "~/lib/legal-links.server";
import { EmbedWizard, type EmbedData } from "./booking-embed";
import { m } from "~/paraglide/messages";

export function meta() {
  return [{ title: m.booking_embed_meta_title() }];
}

/* ------------------------------------------------------------------ */
/*  Loader                                                             */
/* ------------------------------------------------------------------ */

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const raw = url.searchParams.get("style");
  const theme: EmbedData["theme"] =
    raw === "dark" ? "dark" : raw === "branded" ? "branded" : "light";
  try {
    const api = createApi(context);
    // C-6 — branded mode renders light with the tenant's accent tokens.
    const [res, brand] = await Promise.all([
      api.bookings.book[":tenant"].$get({
        param: { tenant: params.tenant ?? "" },
      }),
      theme === "branded" ? resolveTenantBrand(context, params.tenant) : Promise.resolve(null),
    ]);
    const body = res.ok ? await res.json() : {};
    // Shape returned by GET /api/public/book/:tenant (IA-26 company endpoint):
    //   { company, turnstileSiteKey, bookingOpen, allowInspectorChoice, inspectors, services }
    const d = res.ok
      ? (((body as Record<string, unknown>).data ?? null) as
          | {
              company?: string | null;
              turnstileSiteKey?: string | null;
              bookingOpen?: boolean;
            }
          | null)
      : null;
    const legal = readLegalLinks(context);
    return {
      data: d
        ? ({
            slug: "",
            inspectorId: "",
            inspectorName: d.company ?? m.booking_embed_company_default_name(),
            tenantSlug: params.tenant ?? "",
            siteKey: d.turnstileSiteKey ?? "",
            theme,
            brand,
            bookingOpen: d.bookingOpen !== false,
            privacyUrl: legal?.privacyUrl ?? null,
          } satisfies EmbedData)
        : null,
      error: res.ok ? null : "Not found",
    };
  } catch {
    return { data: null, error: "Service unavailable" };
  }
}

/* ------------------------------------------------------------------ */
/*  Page (no layout -- standalone iframe)                              */
/* ------------------------------------------------------------------ */

export default function BookingEmbedCompanyPage() {
  const { data, error } = useLoaderData<typeof loader>();
  return <EmbedWizard data={data} error={error} />;
}
