import { useLoaderData, useNavigate } from "react-router";
import type { Route } from "./+types/inspections.new";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { NewInspectionWizard, type WizardTeamMember } from "~/components/NewInspectionWizard";
import { useSessionContext } from "~/hooks/useSessionContext";
import type { TemplateOption, ServiceOption } from "~/lib/dashboard-schema";
import { m } from "~/paraglide/messages";

export function meta() {
  return [{ title: m.inspections_new_meta_title() }];
}

type QuotaTriple = { inspections: number; sms: number; email: number };

/* ------------------------------------------------------------------ */
/*  Loader                                                             */
/* ------------------------------------------------------------------ */

// The dedicated /inspections/new page (formerly a modal mounted from
// /inspections). It loads only the data the wizard consumes — templates +
// services (B-6 picker / B-8 service linking), scheduling-role team members
// (B-21 Team step), and the free-tier usage summary (at-open quota gate) —
// each best-effort so a single failure degrades gracefully instead of
// breaking the page. The wizard itself still POSTs intent:"create" and
// intent:"search-agents" to the /inspections action (its fetchers target that
// route explicitly), so this route needs no action of its own.
export async function loader({ request, context }: Route.LoaderArgs) {
  const token = await requireToken(context, request);
  const empty = {
    templates: [] as TemplateOption[],
    services: [] as ServiceOption[],
    teamMembers: [] as WizardTeamMember[],
    quotaCaps: null as QuotaTriple | null,
    quotaUsage: null as QuotaTriple | null,
  };
  try {
    const api = createApi(context, { token });
    const [templatesRes, servicesRes, membersRes, usageRes] = await Promise.all([
      api.inspections.templates.$get({ query: { page: "1", pageSize: "100" } }).catch(() => null),
      api.services.index.$get().catch(() => null),
      api.admin.members.$get().catch(() => null),
      api.usage.summary.$get().catch(() => null),
    ]);

    let templates: TemplateOption[] = [];
    if (templatesRes && templatesRes.ok) {
      const tj = (await templatesRes.json()) as { data?: TemplateOption[] };
      templates = (tj.data ?? []).map((t) => ({ id: t.id, name: t.name, itemCount: t.itemCount }));
    }

    let services: ServiceOption[] = [];
    if (servicesRes && servicesRes.ok) {
      const sj = (await servicesRes.json()) as { data?: ServiceOption[] };
      services = (sj.data ?? []).map((s) => ({ id: s.id, name: s.name, price: s.price }));
    }

    // B-21 team step — non-admins get 403 → null → []; team step hidden for them.
    const schedulingRoles = new Set(["owner", "manager", "inspector"]);
    let teamMembers: WizardTeamMember[] = [];
    if (membersRes?.ok) {
      const mb = (await membersRes.json()) as {
        data?: Array<{ id: string; email: string; role: string; name?: string | null }>;
      };
      teamMembers = (mb.data ?? [])
        .filter((m) => schedulingRoles.has(m.role))
        .map((m) => ({ id: m.id, name: m.name ?? m.email }));
    }

    let quotaCaps: QuotaTriple | null = null;
    let quotaUsage: QuotaTriple | null = null;
    if (usageRes && usageRes.ok) {
      const ub = (await usageRes.json().catch(() => ({}))) as {
        data?: { caps?: QuotaTriple | null; usage?: Partial<QuotaTriple> };
      };
      quotaCaps = ub.data?.caps ?? null;
      if (quotaCaps) {
        quotaUsage = {
          inspections: ub.data?.usage?.inspections ?? 0,
          sms: ub.data?.usage?.sms ?? 0,
          email: ub.data?.usage?.email ?? 0,
        };
      }
    }

    return { templates, services, teamMembers, quotaCaps, quotaUsage };
  } catch {
    return empty;
  }
}

/* ------------------------------------------------------------------ */
/*  Page component                                                     */
/* ------------------------------------------------------------------ */

export default function NewInspectionRoute() {
  const { templates, services, teamMembers, quotaCaps, quotaUsage } = useLoaderData<typeof loader>();
  const sessionCtx = useSessionContext();
  const navigate = useNavigate();

  // Free-tier at-open quota gate — identical derivation to the former
  // /inspections mount. `caps` is null for standalone and paid-saas tenants,
  // so this stays undefined (normal wizard) for both. An `inspections` cap of
  // 0 is the "unlimited" sentinel and never gates.
  const billingUrl = sessionCtx?.branding?.portalBaseUrl
    ? `${sessionCtx.branding.portalBaseUrl}/billing`
    : undefined;
  const quotaExceededAtOpen: string | null | undefined =
    quotaCaps && quotaUsage && quotaCaps.inspections > 0 && quotaUsage.inspections >= quotaCaps.inspections
      ? billingUrl ?? null
      : undefined;

  return (
    <NewInspectionWizard
      open
      onClose={() => navigate("/inspections")}
      templates={templates}
      services={services}
      teamMembers={teamMembers}
      quotaExceededAtOpen={quotaExceededAtOpen}
    />
  );
}
