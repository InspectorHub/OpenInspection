import { useLoaderData, useNavigate } from "react-router";
import { SettingsCrumb } from "~/components/SettingsCrumb";
import type { Route } from "./+types/settings-schedule";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { useSessionContext } from "~/hooks/useSessionContext";
import { SCHEDULING_ROLES } from "~/lib/settings/constants";
import { isAdminRole } from "~/lib/access";
import { WeeklySchedulePanel } from "~/components/settings/WeeklySchedulePanel";
import { DateOverridesPanel } from "~/components/settings/DateOverridesPanel";
import {
  CalendarConnectPanel,
  type CalendarCapability,
} from "~/components/settings/CalendarConnectPanel";
import { ScheduleLinksPanel } from "~/components/settings/ScheduleLinksPanel";

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

export function meta() {
  return [{ title: "My Schedule - Settings - OpenInspection" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = await requireToken(context, request);
  const api = createApi(context, { token });

  const url = new URL(request.url);
  const inspectorId = url.searchParams.get("inspectorId") ?? undefined;

  const [availRes, overridesRes, membersRes, calendarStatusRes] = await Promise.all([
    api.availability.index.$get({ query: inspectorId ? { inspectorId } : {} }).catch(() => null),
    api.availability.overrides.$get({ query: inspectorId ? { inspectorId } : {} }).catch(() => null),
    api.admin.members.$get().catch(() => null),
    api.calendar.status.$get().catch(() => null),
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

  return {
    slots,
    overrides,
    members,
    managedInspectorId: inspectorId ?? null,
    calendar: {
      connected: calendarStatus?.connected ?? false,
      capability: calendarStatus?.capability ?? null,
      oauthConfigured: calendarStatus?.oauthConfigured ?? false,
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

  if (intent === "override-add") {
    const inspectorId = String(form.get("inspectorId") ?? "") || undefined;
    const res = await api.availability.overrides.$post({
      json: {
        date: String(form.get("date")),
        isAvailable: false,
        ...(inspectorId ? { inspectorId } : {}),
      },
    });
    const body = res.ok ? ((await res.json()) as { data?: { override?: unknown } }) : null;
    return { ok: res.ok, intent, override: body?.data?.override ?? null };
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
      message: res.ok ? null : body?.error?.message ?? "Calendar sync failed.",
    };
  }

  if (intent === "calendar-disconnect") {
    const res = await api.calendar.disconnect.$delete();
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    return {
      ok: res.ok,
      intent,
      message: res.ok ? null : body?.error?.message ?? "Failed to disconnect Google Calendar.",
    };
  }

  return { ok: false, intent };
}

export default function SettingsSchedulePage() {
  const data = useLoaderData<typeof loader>();
  const ctx = useSessionContext();

  const tenant = ctx?.branding?.tenantSlug;
  const slug = ctx?.branding?.currentUserSlug;
  const isAdmin = isAdminRole(ctx?.user?.role);

  const pickerMembers = isAdmin
    ? data.members.filter((m) => (SCHEDULING_ROLES as readonly string[]).includes(m.role))
    : [];

  return (
    <div className="space-y-ih-list">
      <SettingsCrumb items={[{ label: "Settings", href: "/settings" }, { label: "My Schedule" }]} />
      <p className="text-[13px] text-ih-fg-3">
        Weekly hours, time off, and your personal booking link.
      </p>

      {pickerMembers.length > 0 && (
        <ManageOthersPicker members={pickerMembers} managedInspectorId={data.managedInspectorId} />
      )}

      <CalendarConnectPanel
        connected={data.calendar.connected}
        capability={data.calendar.capability}
        oauthConfigured={data.calendar.oauthConfigured}
        disabled={data.managedInspectorId !== null}
      />
      <WeeklySchedulePanel
        key={data.managedInspectorId ?? "self"}
        initialSlots={data.slots}
        inspectorId={data.managedInspectorId}
      />
      <DateOverridesPanel
        key={data.managedInspectorId ?? "self"}
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
      <span className="text-[13px] font-bold text-ih-fg-1">Managing schedule for</span>
      <select
        value={managedInspectorId ?? ""}
        onChange={(e) => {
          const v = e.target.value;
          navigate(v ? `/settings/schedule?inspectorId=${v}` : "/settings/schedule");
        }}
        className="h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:border-ih-primary focus:shadow-ih-focus outline-none"
      >
        <option value="">Myself</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.email}
          </option>
        ))}
      </select>
    </section>
  );
}
