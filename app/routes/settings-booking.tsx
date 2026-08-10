import { redirect, useLoaderData } from "react-router";
import { SettingsCrumb } from "~/components/SettingsCrumb";
import type { Route } from "./+types/settings-booking";
import { createApi } from "~/lib/api-client.server";
import { requireAdminLoader } from "~/lib/access.server";
import { useSessionContext } from "~/hooks/useSessionContext";
import { SCHEDULING_ROLES } from "~/lib/settings/constants";
import { BookingPoliciesPanel } from "~/components/settings/BookingPoliciesPanel";
import { EmbedWidgetPanel } from "~/components/settings/EmbedWidgetPanel";
import { ManageTeamSchedulesBar } from "~/components/settings/ManageTeamSchedulesBar";
import { CompanyBookingLinksPanel } from "~/components/settings/CompanyBookingLinksPanel";
import { SectionNav } from "~/components/settings/SectionNav";
import {
  BookingSlotRulesPanel,
  type BookingSlotIntervalMin,
  type BookingSlotMode,
} from "~/components/settings/BookingSlotRulesPanel";
import {
  HolidayClosedPanel,
  type CustomHoliday,
  type HolidayInternalPolicy,
  type HolidayPublicPolicy,
} from "~/components/settings/HolidayClosedPanel";
import { getHolidayDataCoverage } from "../../server/lib/holidays/resolve-closed-dates";
import { BookingRoutingPanel } from "~/components/settings/BookingRoutingPanel";
import { InspectorServiceAreasPanel } from "~/components/settings/InspectorServiceAreasPanel";
import { handleBookingRoutingIntent } from "~/lib/settings/booking-routing-actions";
import {
  EMPTY_ROUTING,
  buildServiceAreaMembers,
  countAnchoredInspectors,
  parseRoutingBody,
  parseServiceAreaBody,
} from "~/lib/settings/booking-routing-data";
import { parseDepositPolicy } from "~/lib/deposit-policy-form";
import { saveDepositFromForm, handleCancellationPolicyIntent } from "~/lib/settings/booking-policy-actions";
import { CancellationPolicyPanel, readCancellationSettings, readClauseAgreements, type ClauseState } from "~/components/settings/CancellationPolicyPanel";
import type { CancellationPolicy } from "../../server/lib/billing/cancellation-policy";
import type { DepositPolicy } from "../../server/lib/billing/deposit-policy";
import { m } from "~/paraglide/messages";

interface TenantConfig {
  conciergeReviewRequired: boolean;
  blockUnsignedAgreement: boolean;
  allowInspectorChoice: boolean;
  depositPolicy: DepositPolicy | null;
  bookingSlotMode: BookingSlotMode;
  bookingSlotIntervalMin: BookingSlotIntervalMin;
  holidayRegion: string | null;
  holidayPublicPolicy: HolidayPublicPolicy;
  holidayInternalPolicy: HolidayInternalPolicy;
}

interface Member {
  id: string;
  email: string;
  role: string;
  createdAt: string;
}

function parseSlotInterval(raw: unknown): BookingSlotIntervalMin {
  return raw === 15 || raw === 60 ? raw : 30;
}

function parsePublicPolicy(raw: unknown): HolidayPublicPolicy {
  return raw === "block" || raw === "advisory" || raw === "open" ? raw : "open";
}

function parseInternalPolicy(raw: unknown): HolidayInternalPolicy {
  return raw === "block" ? "block" : "advisory";
}



export function meta() {
  return [{ title: m.settings_booking_meta_title() }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { forbidden, token } = await requireAdminLoader(context, request);
  // Inspectors who bookmarked this page land on My Schedule instead of AccessDenied.
  if (forbidden) throw redirect("/settings/schedule");

  const api = createApi(context, { token });

  const [configRes, membersRes, holidaysRes, brandingRes, routingRes, areasRes, agreementsRes] = await Promise.all([
    api.admin["tenant-config"].$get().catch(() => null),
    api.admin.members.$get().catch(() => null),
    (api.admin as unknown as {
      ["custom-holidays"]: { $get: (args?: unknown) => Promise<Response> };
    })["custom-holidays"].$get().catch(() => null),
    // The deposit default is stored on the same tenant_configs row as the
    // policies above, but it is written through branding and is missing from
    // the tenant-config projection — so it is read from where it is written.
    api.adminBranding.branding.$get().catch(() => null),
    api.admin["booking-routing"].$get().catch(() => null),
    api.admin["service-areas"].all.$get().catch(() => null),
    // The cancellation panel names the agreement that carries the clause, so it
    // needs the templates by name. Read here rather than in the panel: a
    // component that fetches is a component that cannot be server-rendered.
    api.admin.agreements.$get().catch(() => null),
  ]);

  let config: TenantConfig = {
    conciergeReviewRequired: false,
    blockUnsignedAgreement: false,
    allowInspectorChoice: false,
    depositPolicy: null,
    bookingSlotMode: "fixed",
    bookingSlotIntervalMin: 30,
    holidayRegion: null,
    holidayPublicPolicy: "open",
    holidayInternalPolicy: "advisory",
  };
  if (configRes?.ok) {
    const body = (await configRes.json()) as Record<string, unknown>;
    const d = (body.data ?? {}) as Record<string, unknown>;
    config = {
      conciergeReviewRequired: Boolean(d.conciergeReviewRequired),
      blockUnsignedAgreement: Boolean(d.blockUnsignedAgreement),
      allowInspectorChoice: Boolean(d.allowInspectorChoice),
      bookingSlotMode: d.bookingSlotMode === "open" ? "open" : "fixed",
      bookingSlotIntervalMin: parseSlotInterval(d.bookingSlotIntervalMin),
      holidayRegion: typeof d.holidayRegion === "string" ? d.holidayRegion : null,
      holidayPublicPolicy: parsePublicPolicy(d.holidayPublicPolicy),
      holidayInternalPolicy: parseInternalPolicy(d.holidayInternalPolicy),
      depositPolicy: config.depositPolicy,
    };
  }

  let cancellationPolicy: CancellationPolicy | null = null;
  // Fail-closed default: with no branding payload the clause reads as never
  // confirmed, which is the state that REFUSES fees. An optimistic default here
  // would let the panel offer a save the server is bound to reject.
  let clause: ClauseState = { current: false, everAttested: false, agreementId: null };
  if (brandingRes?.ok) {
    const body = (await brandingRes.json()) as { data?: { branding?: Record<string, unknown> } };
    config.depositPolicy = parseDepositPolicy(body.data?.branding?.depositPolicy);
    const cancellation = readCancellationSettings(body.data?.branding);
    cancellationPolicy = cancellation.policy;
    clause = cancellation.clause;
  }

  const clauseAgreements = agreementsRes?.ok
    ? readClauseAgreements(await agreementsRes.json())
    : [];

  let members: Member[] = [];
  if (membersRes?.ok) {
    const body = (await membersRes.json()) as Record<string, unknown>;
    members = (body.data ?? []) as Member[];
  }

  let customHolidays: CustomHoliday[] = [];
  if (holidaysRes?.ok) {
    const body = (await holidaysRes.json()) as {
      data?: { holidays?: CustomHoliday[] };
    };
    customHolidays = body.data?.holidays ?? [];
  }

  // Routing configuration + the two anchors `closest` depends on. Its own
  // endpoint rather than the tenant-config projection: the geocode actions call
  // an external API and have no business in a generic settings PATCH.
  const parsed = routingRes?.ok
    ? parseRoutingBody(await routingRes.json())
    : { routing: EMPTY_ROUTING, origins: [] };
  const areasByUser = areasRes?.ok ? parseServiceAreaBody(await areasRes.json()) : {};

  return {
    routing: parsed.routing,
    origins: parsed.origins,
    areasByUser,
    config,
    cancellationPolicy,
    clause,
    clauseAgreements,
    members,
    customHolidays,
    holidayDataMaxYear: getHolidayDataCoverage().maxYear,
    currentYear: new Date().getUTCFullYear(),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { forbidden, token } = await requireAdminLoader(context, request);
  if (forbidden) throw redirect("/settings/schedule");

  const api = createApi(context, { token });
  const form = await request.formData();
  const intent = String(form.get("intent"));

  // Routing, territories and the two geocode actions live together in
  // ~/lib/settings/booking-routing-actions — they share one admin sub-router
  // and one "a lookup that resolved nothing says which nothing" rule.
  const routed = await handleBookingRoutingIntent(api, form, intent);
  if (routed) return routed;

  const cancellation = await handleCancellationPolicyIntent(api, form, intent);
  if (cancellation) return cancellation;

  if (intent === "policies-save") {
    const res = await api.admin["tenant-config"].$patch({
      json: {
        conciergeReviewRequired: form.get("conciergeReviewRequired") === "true",
        blockUnsignedAgreement: form.get("blockUnsignedAgreement") === "true",
        allowInspectorChoice: form.get("allowInspectorChoice") === "true",
      },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      const message = ((err as Record<string, Record<string, unknown>> | null)?.error?.message) as
        | string
        | undefined;
      return { ok: false, intent, message };
    }
    // One panel, two endpoints: the deposit default is the only booking policy
    // in this panel that lives behind branding. It shares its "an absent key
    // must not read as a clear" rule with the cancellation ladder, so both live
    // in ~/lib/settings/booking-policy-actions.
    const deposit = await saveDepositFromForm(api, form);
    if (deposit && !deposit.ok) return { ok: false, intent, message: deposit.message };
    return { ok: res.ok, intent };
  }

  if (intent === "slot-rules-save") {
    const modeRaw = String(form.get("bookingSlotMode") ?? "fixed");
    const intervalRaw = Number(form.get("bookingSlotIntervalMin") ?? 30);
    const bookingSlotMode: BookingSlotMode = modeRaw === "open" ? "open" : "fixed";
    const bookingSlotIntervalMin: BookingSlotIntervalMin =
      intervalRaw === 15 || intervalRaw === 60 ? intervalRaw : 30;

    const res = await api.admin["tenant-config"].$patch({
      json: { bookingSlotMode, bookingSlotIntervalMin },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      const message = ((err as Record<string, Record<string, unknown>> | null)?.error?.message) as
        | string
        | undefined;
      return { ok: false, intent, message };
    }
    return { ok: res.ok, intent };
  }

  if (intent === "holidays-save") {
    const regionRaw = String(form.get("holidayRegion") ?? "").trim();
    const holidayRegion = regionRaw === "" ? null : regionRaw;
    const holidayPublicPolicy = parsePublicPolicy(form.get("holidayPublicPolicy"));
    const holidayInternalPolicy = parseInternalPolicy(form.get("holidayInternalPolicy"));
    const conciergeReviewRequired = form.get("conciergeReviewRequired") === "true";

    const res = await api.admin["tenant-config"].$patch({
      json: {
        holidayRegion,
        holidayPublicPolicy,
        holidayInternalPolicy,
        conciergeReviewRequired,
      },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      const message = ((err as Record<string, Record<string, unknown>> | null)?.error?.message) as
        | string
        | undefined;
      return { ok: false, intent, message };
    }
    return { ok: true, intent };
  }

  if (intent === "holiday-custom-add") {
    const date = String(form.get("date") ?? "");
    const name = String(form.get("name") ?? "");
    const customApi = (api.admin as unknown as {
      ["custom-holidays"]: {
        $post: (args: { json: { date: string; name: string } }) => Promise<Response>;
      };
    })["custom-holidays"];
    const res = await customApi.$post({ json: { date, name } });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      const message = ((err as Record<string, Record<string, unknown>> | null)?.error?.message) as
        | string
        | undefined;
      return { ok: false, intent, message };
    }
    const body = (await res.json()) as { data?: { holiday?: CustomHoliday } };
    return { ok: true, intent, message: undefined, holiday: body.data?.holiday };
  }

  if (intent === "holiday-custom-delete") {
    const id = String(form.get("id") ?? "");
    const customApi = (api.admin as unknown as {
      ["custom-holidays"]: {
        [":id"]: {
          $delete: (args: { param: { id: string } }) => Promise<Response>;
        };
      };
    })["custom-holidays"];
    const res = await customApi[":id"].$delete({ param: { id } });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      const message = ((err as Record<string, Record<string, unknown>> | null)?.error?.message) as
        | string
        | undefined;
      return { ok: false, intent, message };
    }
    return { ok: true, intent, message: undefined, deletedId: id };
  }

  return { ok: false, intent };
}

export default function SettingsBookingPage() {
  const data = useLoaderData<typeof loader>();
  const ctx = useSessionContext();
  const tenant = ctx?.branding?.tenantSlug;

  const schedulingMembers = data.members.filter((m) =>
    (SCHEDULING_ROLES as readonly string[]).includes(m.role),
  );

  const navSections = [
    { id: "booking-links", label: m.settings_companylink_heading() },
    { id: "booking-policies", label: m.settings_policies_heading() },
    { id: "holidays", label: m.settings_holiday_panel_heading() },
    { id: "slot-rules", label: m.settings_slotrules_heading() },
    { id: "routing", label: m.settings_routing_heading() },
    { id: "service-areas", label: m.settings_serviceareas_heading() },
    { id: "embed-widget", label: m.settings_embed_heading() },
  ];

  const serviceAreaMembers = buildServiceAreaMembers(
    schedulingMembers, data.areasByUser, data.origins,
  );
  const anchoredInspectorCount = countAnchoredInspectors(serviceAreaMembers, data.routing);

  return (
    <div className="space-y-ih-list">
      <SettingsCrumb items={[{ label: m.settings_crumb_settings(), href: "/settings" }, { label: m.settings_booking_crumb() }]} />
      <p className="text-[13px] text-ih-fg-3">
        {m.settings_booking_intro()}
      </p>

      {/* In-page section navigation (sticky; scroll-spy). Shows only when ≥3 sections visible. */}
      <SectionNav sections={navSections} />

      <ManageTeamSchedulesBar
        members={schedulingMembers.map((m) => ({ id: m.id, email: m.email }))}
      />
      <div id="booking-links" className="scroll-mt-12">
        <CompanyBookingLinksPanel tenant={tenant} />
      </div>
      <div id="booking-policies" className="scroll-mt-12">
        <BookingPoliciesPanel initialConfig={data.config} />
        <CancellationPolicyPanel policy={data.cancellationPolicy} clause={data.clause} agreements={data.clauseAgreements} />
      </div>
      <div id="holidays" className="scroll-mt-12">
        <HolidayClosedPanel
          initialConfig={{
            holidayRegion: data.config.holidayRegion,
            holidayPublicPolicy: data.config.holidayPublicPolicy,
            holidayInternalPolicy: data.config.holidayInternalPolicy,
            conciergeReviewRequired: data.config.conciergeReviewRequired,
          }}
          initialCustomHolidays={data.customHolidays}
          dataMaxYear={data.holidayDataMaxYear}
          currentYear={data.currentYear}
        />
      </div>
      <div id="slot-rules" className="scroll-mt-12">
        <BookingSlotRulesPanel
          initial={{
            bookingSlotMode: data.config.bookingSlotMode,
            bookingSlotIntervalMin: data.config.bookingSlotIntervalMin,
          }}
        />
      </div>
      <div id="routing" className="scroll-mt-12">
        <BookingRoutingPanel
          initial={data.routing}
          anchoredInspectorCount={anchoredInspectorCount}
        />
      </div>
      <div id="service-areas" className="scroll-mt-12">
        <InspectorServiceAreasPanel members={serviceAreaMembers} />
      </div>
      <div id="embed-widget" className="scroll-mt-12">
        <EmbedWidgetPanel tenant={tenant} />
      </div>
    </div>
  );
}
