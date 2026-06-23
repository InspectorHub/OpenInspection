import { useLoaderData } from "react-router";
import type { Route } from "./+types/booking";
import { createApi } from "~/lib/api-client.server";
import { resolveTenantBrand } from "~/lib/tenant-brand.server";
import { EMPTY_BRAND, type TenantBrand } from "~/lib/brand";
import { readLegalLinks } from "~/lib/legal-links.server";
import { type CompanyProfile } from "~/components/booking/booking-constants";
import { useBookingFormState } from "~/components/booking/useBookingFormState";
import { BookingWizard } from "~/components/booking/BookingWizard";
import { BookingShell, BookingErrorState, BookingNotOpenState } from "~/components/booking/BookingShell";

export function meta() {
  return [{ title: "Book an Inspection - OpenInspection" }];
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
  // F7 — capture agent referral slug from ?ref= query parameter
  const url = new URL(request.url);
  const refRaw = url.searchParams.get("ref");
  const agentRefSlug =
    refRaw && /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(refRaw)
      ? refRaw
      : null;
  const inspectorSlug = url.searchParams.get("inspector");

  try {
    const api = createApi(context);
    const [res, brand] = await Promise.all([
      api.bookings.book[":tenant"].$get({ param: { tenant: params.tenant ?? "" } }),
      resolveTenantBrand(context, params.tenant),
    ]);
    const body = res.ok ? await res.json() : {};
    const d = ((body as Record<string, unknown>).data ?? {}) as Record<string, unknown>;

    // Deep link: resolve ?inspector=<slug> through the legacy profile
    // endpoint so the wizard can pin that inspector.
    let preselected: { id: string; name: string } | null = null;
    if (inspectorSlug) {
      const legacy = await api.bookings.book[":tenant"][":slug"].$get({
        param: { tenant: params.tenant ?? "", slug: inspectorSlug },
      }).catch(() => null);
      if (legacy?.ok) {
        const lb = (await legacy.json()) as { data?: { inspectorId?: string; name?: string } };
        if (lb.data?.inspectorId) preselected = { id: lb.data.inspectorId, name: lb.data.name ?? "Inspector" };
      }
    }

    const legal = readLegalLinks(context);
    return {
      profile: (Object.keys(d).length > 0 ? d : null) as CompanyProfile | null,
      preselected,
      error: res.ok ? null : "Company not found",
      tenant: params.tenant,
      agentRefSlug,
      brand,
      privacyUrl: legal?.privacyUrl ?? null,
      termsUrl: legal?.termsUrl ?? null,
    };
  } catch {
    return { profile: null, preselected: null, error: "Service unavailable", tenant: "", agentRefSlug: null, brand: EMPTY_BRAND as TenantBrand, privacyUrl: null, termsUrl: null };
  }
}

export default function BookingPage() {
  const { profile, preselected, error, agentRefSlug, brand, tenant, privacyUrl, termsUrl } = useLoaderData<typeof loader>();
  const form = useBookingFormState({ profile, preselected, tenant, agentRefSlug });

  if (error || !profile) {
    return <BookingErrorState error={error} />;
  }

  if (profile.bookingOpen === false) {
    return <BookingNotOpenState profile={profile} brand={brand} />;
  }

  return (
    <BookingShell profile={profile} brand={brand} privacyUrl={privacyUrl}>
      <BookingWizard profile={profile} privacyUrl={privacyUrl} termsUrl={termsUrl} form={form} />
    </BookingShell>
  );
}
