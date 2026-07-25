import { useLoaderData } from "react-router";
import type { Route } from "./+types/booking";
import { createApi } from "~/lib/api-client.server";
import { getToken } from "~/lib/session.server";
import { resolveTenantBrand } from "~/lib/tenant-brand.server";
import { EMPTY_BRAND, type TenantBrand } from "~/lib/brand";
import { readLegalLinks } from "~/lib/legal-links.server";
import type { CompanyProfile } from "~/components/booking/booking-constants";
import { useBookingFormState } from "~/components/booking/useBookingFormState";
import { BookingWizard } from "~/components/booking/BookingWizard";
import { BookingShell, BookingErrorState, BookingNotOpenState } from "~/components/booking/BookingShell";
import { m } from "~/paraglide/messages";

export function meta() {
  return [{ title: m.booking_page_meta_title() }];
}

/** A signed-in agent booking on behalf of a client at this company. */
export interface AgentBooking {
  agentName: string;
  tenantId: string;
}

interface AgentInspectorLink {
  tenantId: string;
  tenantSlug: string;
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
        if (lb.data?.inspectorId) preselected = { id: lb.data.inspectorId, name: lb.data.name ?? m.booking_inspector_default_name() };
      }
    }

    const legal = readLegalLinks(context);
    return {
      profile: (Object.keys(d).length > 0 ? d : null) as CompanyProfile | null,
      preselected,
      error: res.ok ? null : m.booking_error_company_not_found(),
      tenant: params.tenant,
      agentRefSlug,
      brand,
      privacyUrl: legal?.privacyUrl ?? null,
      termsUrl: legal?.termsUrl ?? null,
      agentBooking: await resolveAgentBooking(context, request, params.tenant ?? ""),
    };
  } catch {
    return { profile: null, preselected: null, error: m.booking_error_service_unavailable(), tenant: "", agentRefSlug: null, brand: EMPTY_BRAND as TenantBrand, privacyUrl: null, termsUrl: null, agentBooking: null };
  }
}

/**
 * Whether THIS visitor is an agent who may book on behalf of a client at THIS
 * company — i.e. has an active link with it. Booking is one page: the same form
 * either submits anonymously or places a hold, decided here rather than by a
 * second page that would drift from this one.
 *
 * Anyone else (signed out, an inspector, an agent with no link to this company)
 * resolves to null and sees the unchanged public flow.
 */
async function resolveAgentBooking(
  context: Route.LoaderArgs["context"],
  request: Request,
  tenantSlug: string,
): Promise<AgentBooking | null> {
  const token = await getToken(context, request);
  if (!token) return null;
  try {
    const api = createApi(context, { token });
    const [inspectorsRes, profileRes] = await Promise.all([
      api.agent.inspectors.$get(),
      api.agent.profile.$get(),
    ]);
    if (!inspectorsRes.ok || !profileRes.ok) return null;
    const links = ((await inspectorsRes.json()) as { data?: AgentInspectorLink[] }).data ?? [];
    const here = links.filter((l) => l.tenantSlug === tenantSlug);
    if (here.length === 0) return null;
    const profile = ((await profileRes.json()) as { data?: { name?: string | null; email?: string } }).data;
    return {
      agentName: profile?.name ?? profile?.email ?? "",
      tenantId: here[0].tenantId,
    };
  } catch {
    return null;
  }
}

/**
 * The agent branch's submit. It goes through the route action (not the browser)
 * because the hold endpoint is authenticated and the session token lives on the
 * server side of this app, never in the page.
 */
export async function action({ request, context, params }: Route.ActionArgs) {
  const token = await getToken(context, request);
  if (!token) return { ok: false as const, error: m.helper_booking_submit_error() };
  const form = await request.formData();
  if (String(form.get("_intent") ?? "") !== "agent-book") {
    return { ok: false as const, error: m.helper_booking_submit_error() };
  }

  const agent = await resolveAgentBooking(context, request, params.tenant ?? "");
  if (!agent) return { ok: false as const, error: m.helper_booking_submit_error() };

  const inspectorUserId = String(form.get("inspectorId") ?? "");
  const services = form.getAll("serviceId").map((id) => ({ serviceId: String(id) }));
  try {
    const api = createApi(context, { token });
    const res = await api.agent["concierge-book"].$post({
      json: {
        tenantId: agent.tenantId,
        ...(inspectorUserId ? { inspectorUserId } : {}),
        ...(services.length ? { services } : {}),
        date: String(form.get("date") ?? ""),
        timeSlot: String(form.get("timeSlot") ?? ""),
        propertyAddress: String(form.get("address") ?? ""),
        clientName: String(form.get("clientName") ?? ""),
        clientEmail: String(form.get("clientEmail") ?? ""),
        agreementRequired: true,
        paymentRequired: false,
      },
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      return { ok: false as const, error: body?.error?.message || m.helper_booking_submit_error() };
    }
    return { ok: true as const };
  } catch {
    return { ok: false as const, error: m.helper_booking_network_error() };
  }
}

export default function BookingPage() {
  const { profile, preselected, error, agentRefSlug, brand, tenant, privacyUrl, termsUrl, agentBooking } =
    useLoaderData<typeof loader>();
  const form = useBookingFormState({ profile, preselected, tenant, agentRefSlug, agentBooking });

  if (error || !profile) {
    return <BookingErrorState error={error} />;
  }

  if (profile.bookingOpen === false) {
    return <BookingNotOpenState profile={profile} brand={brand} />;
  }

  return (
    <BookingShell profile={profile} brand={brand} privacyUrl={privacyUrl}>
      <BookingWizard
        profile={profile}
        privacyUrl={privacyUrl}
        termsUrl={termsUrl}
        form={form}
        agentBooking={agentBooking}
      />
    </BookingShell>
  );
}
