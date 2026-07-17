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
import { m } from "~/paraglide/messages";

interface TenantConfig {
  conciergeReviewRequired: boolean;
  blockUnsignedAgreement: boolean;
  allowInspectorChoice: boolean;
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

  const [configRes, membersRes, holidaysRes] = await Promise.all([
    api.admin["tenant-config"].$get().catch(() => null),
    api.admin.members.$get().catch(() => null),
    (api.admin as unknown as {
      ["custom-holidays"]: { $get: (args?: unknown) => Promise<Response> };
    })["custom-holidays"].$get().catch(() => null),
  ]);

  let config: TenantConfig = {
    conciergeReviewRequired: false,
    blockUnsignedAgreement: false,
    allowInspectorChoice: false,
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
    };
  }

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

  return { config, members, customHolidays };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { forbidden, token } = await requireAdminLoader(context, request);
  if (forbidden) throw redirect("/settings/schedule");

  const api = createApi(context, { token });
  const form = await request.formData();
  const intent = String(form.get("intent"));

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
    return { ok: true, intent, holiday: body.data?.holiday };
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
    return { ok: true, intent, deletedId: id };
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

  return (
    <div className="space-y-ih-list">
      <SettingsCrumb items={[{ label: m.settings_crumb_settings(), href: "/settings" }, { label: m.settings_booking_crumb() }]} />
      <p className="text-[13px] text-ih-fg-3">
        {m.settings_booking_intro()}
      </p>

      <ManageTeamSchedulesBar
        members={schedulingMembers.map((m) => ({ id: m.id, email: m.email }))}
      />
      <CompanyBookingLinksPanel tenant={tenant} />
      <BookingPoliciesPanel initialConfig={data.config} />
      <HolidayClosedPanel
        initialConfig={{
          holidayRegion: data.config.holidayRegion,
          holidayPublicPolicy: data.config.holidayPublicPolicy,
          holidayInternalPolicy: data.config.holidayInternalPolicy,
          conciergeReviewRequired: data.config.conciergeReviewRequired,
        }}
        initialCustomHolidays={data.customHolidays}
      />
      <BookingSlotRulesPanel
        initial={{
          bookingSlotMode: data.config.bookingSlotMode,
          bookingSlotIntervalMin: data.config.bookingSlotIntervalMin,
        }}
      />
      <EmbedWidgetPanel tenant={tenant} />
    </div>
  );
}
