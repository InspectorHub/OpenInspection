import { useLoaderData, useNavigate } from "react-router";
import { SettingsCrumb } from "~/components/SettingsCrumb";
import type { Route } from "./+types/settings-schedule";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { useDisplayLocale, useSessionContext } from "~/hooks/useSessionContext";
import { SCHEDULING_ROLES } from "~/lib/settings/constants";
import { isAdminRole } from "~/lib/access";
import { WeeklySchedulePanel } from "~/components/settings/WeeklySchedulePanel";
import { DateOverridesPanel } from "~/components/settings/DateOverridesPanel";
import { TimeOffListPanel, type TimeOffBlock } from "~/components/settings/TimeOffListPanel";
import {
  CompanyClosedStrip,
  type ClosedDate,
  type HolidayPublicPolicy,
} from "~/components/settings/CompanyClosedStrip";
import {
  AvailabilityHeatmapWeek,
  type HeatmapDay,
} from "~/components/settings/AvailabilityHeatmapWeek";
import {
  CalendarConnectPanel,
  type CalendarCapability,
} from "~/components/settings/CalendarConnectPanel";
import type { CalendarPickerData } from "~/components/settings/CalendarReadSetPicker";
import { ScheduleLinksPanel } from "~/components/settings/ScheduleLinksPanel";
import { m } from "~/paraglide/messages";

interface AvailabilitySlot {
  id: number;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

interface DateOverride {
  id: string;
  date: string;
  isAvailable: boolean;
  startTime: string | null;
  endTime: string | null;
}

interface Member {
  id: string;
  email: string;
  role: string;
  createdAt: string;
}

function civilToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function addCivilDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Sunday-anchored week start, matching the calendar's startOfWeek. */
function startOfCivilWeek(isoDate: string): string {
  const dayOfWeek = new Date(`${isoDate}T12:00:00.000Z`).getUTCDay();
  return addCivilDays(isoDate, -dayOfWeek);
}

function parsePublicPolicy(raw: unknown): HolidayPublicPolicy {
  if (raw === "block" || raw === "advisory" || raw === "open") return raw;
  return "open";
}

export function meta() {
  return [{ title: m.settings_schedule_meta_title() }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = await requireToken(context, request);
  const api = createApi(context, { token });

  const url = new URL(request.url);
  const inspectorId = url.searchParams.get("inspectorId") ?? undefined;

  const start = civilToday();
  const end = addCivilDays(start, 365);
  const year = Number(start.slice(0, 4));
  const weekStart = startOfCivilWeek(start);

  const [availRes, overridesRes, membersRes, calendarStatusRes, blocksRes, configRes, previewRes, weekSummaryRes] =
    await Promise.all([
      api.availability.index.$get({ query: inspectorId ? { inspectorId } : {} }).catch(() => null),
      api.availability.overrides.$get({ query: inspectorId ? { inspectorId } : {} }).catch(() => null),
      api.admin.members.$get().catch(() => null),
      api.calendar.status.$get().catch(() => null),
      api.calendar.blocks
        .$get({
          query: {
            start,
            end,
            ...(inspectorId ? { userId: inspectorId } : {}),
          },
        })
        .catch(() => null),
      api.admin["tenant-config"].$get().catch(() => null),
      (api.admin as unknown as {
        holidays: { preview: { $get: (args?: unknown) => Promise<Response> } };
      }).holidays.preview
        .$get({ query: { year } })
        .catch(() => null),
      api.schedule["week-summary"]
        .$get({ query: { start: weekStart, ...(inspectorId ? { userId: inspectorId } : {}) } })
        .catch(() => null),
    ]);

  let slots: AvailabilitySlot[] = [];
  if (availRes?.ok) {
    const body = (await availRes.json()) as Record<string, unknown>;
    slots = (body.data ?? []) as AvailabilitySlot[];
  }

  let overrides: DateOverride[] = [];
  if (overridesRes?.ok) {
    const body = (await overridesRes.json()) as Record<string, unknown>;
    overrides = (body.data ?? []) as DateOverride[];
  }

  let members: Member[] = [];
  if (membersRes?.ok) {
    const body = (await membersRes.json()) as Record<string, unknown>;
    members = (body.data ?? []) as Member[];
  }

  const calendarStatus = calendarStatusRes?.ok
    ? ((await calendarStatusRes.json()) as {
        data?: {
          connected?: boolean;
          capability?: CalendarCapability | null;
          oauthConfigured?: boolean;
        };
      }).data
    : null;

  // A-polish 10b — the read-set / write-target picker data. Owner-only (the
  // endpoint uses the current user's connection), so skip it when managing
  // someone else's schedule. Best-effort: a Google hiccup just hides the picker.
  let calendarPicker: CalendarPickerData | null = null;
  if (calendarStatus?.connected && !inspectorId) {
    const readSetRes = await api.calendar["read-set"].$get().catch(() => null);
    if (readSetRes?.ok) {
      const body = (await readSetRes.json()) as {
        data?: {
          connected?: boolean;
          connectionId?: string;
          writeCalendarId?: string;
          readCalendarIds?: string[];
          calendars?: CalendarPickerData["calendars"];
        };
      };
      const d = body.data;
      if (d?.connected && d.connectionId) {
        calendarPicker = {
          connectionId: d.connectionId,
          writeCalendarId: d.writeCalendarId ?? "",
          readCalendarIds: d.readCalendarIds ?? [],
          calendars: d.calendars ?? [],
        };
      }
    }
  }

  let timeOffBlocks: TimeOffBlock[] = [];
  if (blocksRes?.ok) {
    const body = (await blocksRes.json()) as { data?: { blocks?: TimeOffBlock[] } };
    timeOffBlocks = body.data?.blocks ?? [];
  }

  let weekSummary: HeatmapDay[] = [];
  if (weekSummaryRes?.ok) {
    const body = (await weekSummaryRes.json()) as { data?: { days?: HeatmapDay[] } };
    weekSummary = body.data?.days ?? [];
  }

  let holidayRegion: string | null = null;
  let holidayPublicPolicy: HolidayPublicPolicy = "open";
  if (configRes?.ok) {
    const body = (await configRes.json()) as Record<string, unknown>;
    const d = (body.data ?? {}) as Record<string, unknown>;
    holidayRegion = typeof d.holidayRegion === "string" ? d.holidayRegion : null;
    holidayPublicPolicy = parsePublicPolicy(d.holidayPublicPolicy);
  }

  let upcomingClosed: ClosedDate[] = [];
  if (holidayRegion && previewRes?.ok) {
    const body = (await previewRes.json()) as {
      data?: { dates?: ClosedDate[] };
    };
    upcomingClosed = (body.data?.dates ?? [])
      .filter((d) => d.date >= start)
      .slice(0, 3);
  }

  // If preview year rolled past Dec, also pull next year for the strip.
  if (holidayRegion && upcomingClosed.length < 3) {
    const nextYearRes = await (api.admin as unknown as {
      holidays: { preview: { $get: (args?: unknown) => Promise<Response> } };
    }).holidays.preview
      .$get({ query: { year: year + 1 } })
      .catch(() => null);
    if (nextYearRes?.ok) {
      const body = (await nextYearRes.json()) as { data?: { dates?: ClosedDate[] } };
      const more = (body.data?.dates ?? []).filter((d) => d.date >= start);
      upcomingClosed = [...upcomingClosed, ...more].slice(0, 3);
    }
  }

  return {
    slots,
    overrides,
    members,
    managedInspectorId: inspectorId ?? null,
    timeOffBlocks,
    weekSummary,
    companyClosed: holidayRegion
      ? { holidayRegion, holidayPublicPolicy, upcomingClosed }
      : null,
    calendar: {
      connected: calendarStatus?.connected ?? false,
      capability: calendarStatus?.capability ?? null,
      oauthConfigured: calendarStatus?.oauthConfigured ?? false,
      picker: calendarPicker,
    },
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const token = await requireToken(context, request);
  const api = createApi(context, { token });
  const form = await request.formData();
  const intent = String(form.get("intent"));

  if (intent === "schedule-save") {
    let slots: { dayOfWeek: number; startTime: string; endTime: string }[];
    try {
      slots = JSON.parse(String(form.get("slots") ?? "[]"));
    } catch {
      return { ok: false, intent };
    }
    const inspectorId = String(form.get("inspectorId") ?? "") || undefined;
    const res = await api.availability.index.$put({
      json: { slots, ...(inspectorId ? { inspectorId } : {}) },
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

  if (intent === "override-remove") {
    const res = await api.availability.overrides[":id"].$delete({
      param: { id: String(form.get("id")) },
    });
    return { ok: res.ok, intent };
  }

  if (intent === "calendar-sync") {
    const res = await api.calendar.sync.$post();
    const body = (await res.json().catch(() => null)) as
      | { data?: { totalEvents?: number }; error?: { message?: string } }
      | null;
    return {
      ok: res.ok,
      intent,
      totalEvents: body?.data?.totalEvents ?? 0,
      message: res.ok ? null : body?.error?.message ?? m.settings_schedule_error_sync_failed(),
    };
  }

  if (intent === "calendar-disconnect") {
    const res = await api.calendar.disconnect.$delete();
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    return {
      ok: res.ok,
      intent,
      message: res.ok ? null : body?.error?.message ?? m.settings_schedule_error_disconnect_failed(),
    };
  }

  if (intent === "calendar-read-set-save") {
    const connectionId = String(form.get("connectionId") ?? "");
    let readCalendarIds: string[] = [];
    try {
      readCalendarIds = JSON.parse(String(form.get("readCalendarIds") ?? "[]"));
    } catch {
      return { ok: false, intent };
    }
    const writeCalendarId = String(form.get("writeCalendarId") ?? "");
    // The PUT route validates the body by hand (no client-visible validator),
    // so the client type omits `json`; the hono client still sends it at runtime.
    const putCalendars = api.calendar.connections[":id"].calendars.$put as unknown as (
      args: { param: { id: string }; json: { readCalendarIds: string[]; writeCalendarId: string } },
    ) => Promise<Response>;
    const res = await putCalendars({
      param: { id: connectionId },
      json: { readCalendarIds, writeCalendarId },
    });
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    return {
      ok: res.ok,
      intent,
      message: res.ok ? null : body?.error?.message ?? m.settings_calpicker_save_failed(),
    };
  }

  return { ok: false, intent };
}

export default function SettingsSchedulePage() {
  const data = useLoaderData<typeof loader>();
  const ctx = useSessionContext();
  const locale = useDisplayLocale();

  const tenant = ctx?.branding?.tenantSlug;
  const slug = ctx?.branding?.currentUserSlug;
  const isAdmin = isAdminRole(ctx?.user?.role);

  const pickerMembers = isAdmin
    ? data.members.filter((m) => (SCHEDULING_ROLES as readonly string[]).includes(m.role))
    : [];

  return (
    <div className="space-y-ih-list">
      <SettingsCrumb items={[{ label: m.settings_crumb_settings(), href: "/settings" }, { label: m.settings_schedule_crumb() }]} />
      <p className="text-[13px] text-ih-fg-3">
        {m.settings_schedule_intro()}
      </p>

      {pickerMembers.length > 0 && (
        <ManageOthersPicker members={pickerMembers} managedInspectorId={data.managedInspectorId} />
      )}

      <CalendarConnectPanel
        connected={data.calendar.connected}
        capability={data.calendar.capability}
        oauthConfigured={data.calendar.oauthConfigured}
        disabled={data.managedInspectorId !== null}
        picker={data.calendar.picker}
      />
      <WeeklySchedulePanel
        key={data.managedInspectorId ?? "self"}
        initialSlots={data.slots}
        inspectorId={data.managedInspectorId}
      />
      {data.weekSummary.length > 0 && (
        <section className="bg-ih-bg-card border border-ih-border rounded-lg p-5 space-y-3">
          <h3 className="text-[13px] font-bold text-ih-fg-1">{m.schedule_heatmap_heading()}</h3>
          <AvailabilityHeatmapWeek days={data.weekSummary} locale={locale} />
        </section>
      )}
      {data.companyClosed && (
        <CompanyClosedStrip
          holidayRegion={data.companyClosed.holidayRegion}
          holidayPublicPolicy={data.companyClosed.holidayPublicPolicy}
          upcomingClosed={data.companyClosed.upcomingClosed}
        />
      )}
      <TimeOffListPanel
        key={`time-off-${data.managedInspectorId ?? "self"}`}
        blocks={data.timeOffBlocks}
      />
      <DateOverridesPanel
        key={`overrides-${data.managedInspectorId ?? "self"}`}
        initialOverrides={data.overrides}
        inspectorId={data.managedInspectorId}
      />
      <ScheduleLinksPanel tenant={tenant} slug={slug} />
    </div>
  );
}

function ManageOthersPicker({
  members,
  managedInspectorId,
}: {
  members: Member[];
  managedInspectorId: string | null;
}) {
  const navigate = useNavigate();
  return (
    <section className="bg-ih-bg-card border border-ih-border rounded-lg p-5 flex items-center gap-3">
      <span className="text-[13px] font-bold text-ih-fg-1">{m.settings_schedule_managing_for()}</span>
      <select
        value={managedInspectorId ?? ""}
        onChange={(e) => {
          const v = e.target.value;
          navigate(v ? `/settings/schedule?inspectorId=${v}` : "/settings/schedule");
        }}
        className="h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:border-ih-primary focus:shadow-ih-focus outline-none"
      >
        <option value="">{m.settings_schedule_myself()}</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.email}
          </option>
        ))}
      </select>
    </section>
  );
}
