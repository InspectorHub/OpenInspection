// Company-level embed: the only booking embed. Bookings submit without an
// inspectorId and the server auto-assigns the first available qualified
// inspector.

import { useLoaderData } from "react-router";
import type { Route } from "./+types/booking-embed-company";
import { createApi } from "~/lib/api-client.server";
import { resolveTenantBrand } from "~/lib/tenant-brand.server";
import { EmbedWizard, type EmbedData } from "./booking-embed-widget";
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
      resolveTenantBrand(context, params.tenant, request),
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
    return {
      data: d
        ? ({
            slug: "",
            inspectorId: "",
            inspectorName: d.company ?? m.booking_embed_company_default_name(),
            tenantSlug: params.tenant ?? "",
            siteKey: d.turnstileSiteKey ?? "",
            theme,
            brand: theme === "branded" ? brand : null,
            bookingOpen: d.bookingOpen !== false,
            privacyUrl: brand.privacyUrl,
            termsUrl: brand.termsUrl,
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
