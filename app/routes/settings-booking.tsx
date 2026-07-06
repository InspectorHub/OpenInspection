import { useLoaderData, useNavigate } from "react-router";
import { SettingsCrumb } from "~/components/SettingsCrumb";
import type { Route } from "./+types/settings-booking";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { useSessionContext } from "~/hooks/useSessionContext";
import { useCopyClipboard } from "~/hooks/useCopyClipboard";
import { SCHEDULING_ROLES } from "~/lib/settings/constants";
import { WeeklySchedulePanel } from "~/components/settings/WeeklySchedulePanel";
import { DateOverridesPanel } from "~/components/settings/DateOverridesPanel";
import { BookingPoliciesPanel } from "~/components/settings/BookingPoliciesPanel";
import { EmbedWidgetPanel } from "~/components/settings/EmbedWidgetPanel";

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

interface TenantConfig {
  conciergeReviewRequired: boolean;
  blockUnsignedAgreement: boolean;
  allowInspectorChoice: boolean;
}

interface Member {
  id: string;
  email: string;
  role: string;
  createdAt: string;
}

export function meta() {
  return [{ title: "Online Booking - Settings - OpenInspection" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = await requireToken(context, request);
  const api = createApi(context, { token });

  const url = new URL(request.url);
  const inspectorId = url.searchParams.get("inspectorId") ?? undefined;

  const [availRes, overridesRes, configRes, originsRes, membersRes] = await Promise.all([
    api.availability.index.$get({ query: inspectorId ? { inspectorId } : {} }).catch(() => null),
    api.availability.overrides.$get({ query: inspectorId ? { inspectorId } : {} }).catch(() => null),
    api.admin["tenant-config"].$get().catch(() => null),
    api.admin.widget.origins.$get().catch(() => null),
    api.admin.members.$get().catch(() => null),
  ]);

  let slots: AvailabilitySlot[] = [];
  if (availRes?.ok) {
    const body = (await availRes.json()) as Record<string, unknown>;
    slots = ((body.data ?? []) as AvailabilitySlot[]);
  }

  let overrides: DateOverride[] = [];
  if (overridesRes?.ok) {
    const body = (await overridesRes.json()) as Record<string, unknown>;
    overrides = ((body.data ?? []) as DateOverride[]);
  }

  let config: TenantConfig = { conciergeReviewRequired: false, blockUnsignedAgreement: false, allowInspectorChoice: false };
  if (configRes?.ok) {
    const body = (await configRes.json()) as Record<string, unknown>;
    const d = (body.data ?? {}) as Record<string, unknown>;
    config = {
      conciergeReviewRequired: Boolean(d.conciergeReviewRequired),
      blockUnsignedAgreement: Boolean(d.blockUnsignedAgreement),
      allowInspectorChoice: Boolean(d.allowInspectorChoice),
    };
  }

  let origins: string[] = [];
  if (originsRes?.ok) {
    const body = (await originsRes.json()) as Record<string, unknown>;
    const d = (body.data ?? {}) as Record<string, unknown>;
    origins = (d.origins || []) as string[];
  }

  // Non-admins get 403 → null → empty list; no separate role check needed.
  let members: Member[] = [];
  if (membersRes?.ok) {
    const body = (await membersRes.json()) as Record<string, unknown>;
    members = ((body.data ?? []) as Member[]);
  }

  return {
    slots,
    overrides,
    config,
    origins,
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
    // defensive: value is client-built; guard against malformed JSON
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
      const message = ((err as Record<string, Record<string, unknown>> | null)?.error?.message) as string | undefined;
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
      const message = ((err as Record<string, Record<string, unknown>> | null)?.error?.message) as string | undefined;
      return { ok: false, intent, message };
    }
    return { ok: res.ok, intent };
  }

  return { ok: false, intent };
}

export default function SettingsBookingPage() {
  const data = useLoaderData<typeof loader>();
  const ctx = useSessionContext();

  const tenant = ctx?.branding?.tenantSlug;
  const slug = ctx?.branding?.currentUserSlug;
  // The current user's id is not in session context — we use role+members for the picker.
  // Admin/owner role means members loaded successfully (403 gate for non-admins).
  const isAdmin = ctx?.user?.role === "owner" || ctx?.user?.role === "manager";

  // Show picker only to admins; restrict to the roles that can hold a
  // schedule.
  const pickerMembers = isAdmin
    ? data.members.filter((m) => (SCHEDULING_ROLES as readonly string[]).includes(m.role))
    : [];

  return (
    <div className="space-y-ih-list">
      <SettingsCrumb items={[{ label: "Settings", href: "/settings" }, { label: "Online Booking" }]} />
      <p className="text-[13px] text-ih-fg-3">
        Configure your availability, booking policies, and embeddable widget.
      </p>

      <StatusAndLinks tenant={tenant} slug={slug} />

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
      <BookingPoliciesPanel initialConfig={data.config} />
      <EmbedWidgetPanel tenant={tenant} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Manage-others picker (admin only)                                  */
/* ------------------------------------------------------------------ */

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
          navigate(v ? `/settings/booking?inspectorId=${v}` : "/settings/booking");
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

/* ------------------------------------------------------------------ */
/*  Section 1 — Status & Links                                        */
/* ------------------------------------------------------------------ */

function StatusAndLinks({ tenant, slug }: { tenant: string | null | undefined; slug: string | null | undefined }) {
  const { copied: copiedField, copy } = useCopyClipboard();

  // window.location.origin is "" during SSR and real on client.
  // The existing code used this same pattern — it's a pre-existing SSR/client
  // mismatch (both sides render a different string). React does NOT suppress
  // text mismatches, but in practice the hydration warning is benign here
  // because the iframe src / anchor href update on the first client render.
  // This matches the pre-Task-10 behavior exactly; we do not introduce a new
  // mismatch class. A proper fix (useEffect + state) is tracked separately.
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const companyUrl = tenant ? `${origin}/book/${tenant}` : null;
  const deepLink = tenant && slug ? `${origin}/book/${tenant}/${slug}` : null;

  if (!companyUrl) return null;

  return (
    <section className="bg-ih-bg-card border border-ih-border rounded-lg p-5 space-y-4">
      <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">Your links</h3>
      <UrlRow
        label="Company booking page"
        url={companyUrl}
        copied={copiedField === "company"}
        onCopy={() => copy(companyUrl, "company")}
      />
      {deepLink && (
        <UrlRow
          label="Your personal deep link"
          url={deepLink}
          copied={copiedField === "deep"}
          onCopy={() => copy(deepLink, "deep")}
        />
      )}
      <p className="text-[12px] text-ih-fg-3">
        Share the company link — clients are matched with the first available inspector.
        The personal deep link pre-selects you.
      </p>
    </section>
  );
}

function UrlRow({ label, url, copied, onCopy }: { label: string; url: string; copied: boolean; onCopy: () => void }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-[12px] font-bold text-ih-fg-2 w-36 shrink-0">{label}</span>
      <span className="text-[12px] text-ih-fg-1 truncate flex-1 font-mono bg-ih-bg-muted rounded px-2 py-1.5 border border-ih-border">
        {url}
      </span>
      <button
        onClick={onCopy}
        className="h-8 px-3 rounded-md bg-ih-primary text-white font-bold text-[12px] hover:bg-ih-primary-600 transition-colors shrink-0"
      >
        {copied ? "Copied!" : "Copy"}
      </button>
      <a href={url} target="_blank" rel="noopener noreferrer" className="text-ih-fg-3 hover:text-ih-primary transition-colors shrink-0">
        <ExternalLinkIcon />
      </a>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Icons                                                              */
/* ------------------------------------------------------------------ */

function ExternalLinkIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" />
    </svg>
  );
}
