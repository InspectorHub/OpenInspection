import { useLoaderData, useNavigate } from "react-router";
import { SettingsCrumb } from "~/components/SettingsCrumb";
import type { Route } from "./+types/settings-schedule";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { useSessionContext } from "~/hooks/useSessionContext";
import { useCopyClipboard } from "~/hooks/useCopyClipboard";
import { SCHEDULING_ROLES } from "~/lib/settings/constants";
import { isAdminRole } from "~/lib/access";
import { WeeklySchedulePanel } from "~/components/settings/WeeklySchedulePanel";
import { DateOverridesPanel } from "~/components/settings/DateOverridesPanel";

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

  const [availRes, overridesRes, membersRes] = await Promise.all([
    api.availability.index.$get({ query: inspectorId ? { inspectorId } : {} }).catch(() => null),
    api.availability.overrides.$get({ query: inspectorId ? { inspectorId } : {} }).catch(() => null),
    api.admin.members.$get().catch(() => null),
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

  return {
    slots,
    overrides,
    members,
    managedInspectorId: inspectorId ?? null,
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

      <PersonalLinks tenant={tenant} slug={slug} />

      {pickerMembers.length > 0 && (
        <ManageOthersPicker members={pickerMembers} managedInspectorId={data.managedInspectorId} />
      )}

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

function PersonalLinks({
  tenant,
  slug,
}: {
  tenant: string | null | undefined;
  slug: string | null | undefined;
}) {
  const { copied: copiedField, copy } = useCopyClipboard();
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const deepLink = tenant && slug ? `${origin}/book/${tenant}/${slug}` : null;

  if (!deepLink) return null;

  return (
    <section className="bg-ih-bg-card border border-ih-border rounded-lg p-5 space-y-4">
      <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">Your links</h3>
      <div className="flex items-center gap-3">
        <span className="text-[12px] font-bold text-ih-fg-2 w-36 shrink-0">Personal deep link</span>
        <span className="text-[12px] text-ih-fg-1 truncate flex-1 font-mono bg-ih-bg-muted rounded px-2 py-1.5 border border-ih-border">
          {deepLink}
        </span>
        <button
          type="button"
          onClick={() => copy(deepLink, "deep")}
          className="h-8 px-3 rounded-md bg-ih-primary text-white font-bold text-[12px] hover:bg-ih-primary-600 transition-colors shrink-0"
        >
          {copiedField === "deep" ? "Copied!" : "Copy"}
        </button>
      </div>
      <p className="text-[12px] text-ih-fg-3">
        The personal deep link pre-selects you on the company booking page.
      </p>
    </section>
  );
}
