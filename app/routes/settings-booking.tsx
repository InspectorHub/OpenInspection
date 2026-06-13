import { useState, useEffect, useRef } from "react";
import { Link, useLoaderData, useFetcher, useNavigate } from "react-router";
import type { Route } from "./+types/settings-booking";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { useSessionContext } from "~/hooks/useSessionContext";

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

const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

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
    ? data.members.filter((m) => ['owner', 'manager', 'inspector'].includes(m.role))
    : [];

  return (
    <div className="space-y-[18px]">
      <div className="flex items-center gap-2 text-[13px] text-ih-fg-3">
        <Link to="/settings" className="hover:text-ih-primary transition-colors">Settings</Link>
        <span>&rsaquo;</span>
        <span className="text-ih-fg-1">Online Booking</span>
      </div>

      <h2 className="text-[19px] font-bold text-ih-fg-1">Online Booking</h2>
      <p className="text-[13px] text-ih-fg-3">
        Configure your availability, booking policies, and embeddable widget.
      </p>

      <StatusAndLinks tenant={tenant} slug={slug} />

      {pickerMembers.length > 0 && (
        <ManageOthersPicker members={pickerMembers} managedInspectorId={data.managedInspectorId} />
      )}

      <WeeklySchedule
        key={data.managedInspectorId ?? "self"}
        initialSlots={data.slots}
        inspectorId={data.managedInspectorId}
      />
      <DateOverrides
        key={data.managedInspectorId ?? "self"}
        initialOverrides={data.overrides}
        inspectorId={data.managedInspectorId}
      />
      <BookingPolicies initialConfig={data.config} />
      <EmbedWidget tenant={tenant} />
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
  const [copiedField, setCopiedField] = useState<string | null>(null);

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

  function copy(value: string, field: string) {
    void navigator.clipboard.writeText(value);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  }

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
/*  Section 2 — Weekly Schedule                                        */
/* ------------------------------------------------------------------ */

interface DayState {
  enabled: boolean;
  startTime: string;
  endTime: string;
}

function buildDayMap(slots: AvailabilitySlot[]): DayState[] {
  const days: DayState[] = Array.from({ length: 7 }, () => ({
    enabled: false,
    startTime: "08:00",
    endTime: "17:00",
  }));
  for (const s of slots) {
    days[s.dayOfWeek] = { enabled: true, startTime: s.startTime, endTime: s.endTime };
  }
  return days;
}

function WeeklySchedule({
  initialSlots,
  inspectorId,
}: {
  initialSlots: AvailabilitySlot[];
  inspectorId: string | null | undefined;
}) {
  const fetcher = useFetcher<typeof action>();
  const [days, setDays] = useState<DayState[]>(() => buildDayMap(initialSlots));
  // dirty tracks whether local state differs from the last saved state
  const [dirty, setDirty] = useState(false);

  // Derive saved from fetcher response; reset dirty when the save completes
  const saved =
    fetcher.state === "idle" &&
    fetcher.data?.intent === "schedule-save" &&
    fetcher.data.ok === true &&
    !dirty;

  const failed =
    fetcher.state === "idle" &&
    fetcher.data?.intent === "schedule-save" &&
    fetcher.data.ok === false &&
    !dirty;

  const saving = fetcher.state !== "idle";

  function updateDay(idx: number, patch: Partial<DayState>) {
    setDays((prev) => prev.map((d, i) => (i === idx ? { ...d, ...patch } : d)));
    setDirty(true);
  }

  function handleSave() {
    const slots = days
      .map((d, i) => (d.enabled ? { dayOfWeek: i, startTime: d.startTime, endTime: d.endTime } : null))
      .filter(Boolean);
    setDirty(false);
    fetcher.submit(
      {
        intent: "schedule-save",
        slots: JSON.stringify(slots),
        ...(inspectorId ? { inspectorId } : {}),
      },
      { method: "post" },
    );
  }

  const displayOrder = [1, 2, 3, 4, 5, 6, 0];

  return (
    <section className="bg-ih-bg-card border border-ih-border rounded-lg p-5 space-y-4">
      <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">Weekly schedule</h3>
      <div className="space-y-2">
        {displayOrder.map((dow) => (
          <div key={dow} className="flex items-center gap-3">
            <label className="flex items-center gap-2 w-28 shrink-0 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={days[dow].enabled}
                onChange={(e) => updateDay(dow, { enabled: e.target.checked })}
                className="h-4 w-4 rounded border-ih-border text-ih-primary"
              />
              <span className="text-[13px] font-bold text-ih-fg-1">{DAY_LABELS[dow]}</span>
            </label>
            {days[dow].enabled ? (
              <div className="flex items-center gap-2">
                <input
                  type="time"
                  value={days[dow].startTime}
                  onChange={(e) => updateDay(dow, { startTime: e.target.value })}
                  className="px-2 py-1.5 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:border-ih-primary focus:shadow-ih-focus outline-none"
                />
                <span className="text-[12px] text-ih-fg-3">to</span>
                <input
                  type="time"
                  value={days[dow].endTime}
                  onChange={(e) => updateDay(dow, { endTime: e.target.value })}
                  className="px-2 py-1.5 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:border-ih-primary focus:shadow-ih-focus outline-none"
                />
              </div>
            ) : (
              <span className="text-[12px] text-ih-fg-4 italic">Unavailable</span>
            )}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 pt-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="h-8 px-3 rounded-md bg-ih-primary text-white font-bold text-[12px] hover:bg-ih-primary-600 transition-colors disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save schedule"}
        </button>
        {saved && <span className="text-[13px] text-ih-ok-fg font-bold">Saved.</span>}
        {failed && (
          <span className="text-[13px] text-ih-bad-fg font-bold">
            {fetcher.data?.message ?? "Save failed. Please try again."}
          </span>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Section 3 — Date Overrides                                         */
/* ------------------------------------------------------------------ */

function DateOverrides({
  initialOverrides,
  inspectorId,
}: {
  initialOverrides: DateOverride[];
  inspectorId: string | null | undefined;
}) {
  const addFetcher = useFetcher<typeof action>();
  const removeFetcher = useFetcher<typeof action>();

  const [overrides, setOverrides] = useState<DateOverride[]>(initialOverrides);
  const [newDate, setNewDate] = useState("");
  // Track the last appended override id to prevent double-append on re-render
  const lastAppendedId = useRef<string | null>(null);
  // Keep a ref to the pending-removed override for rollback on failure
  const pendingRemovedRef = useRef<DateOverride | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const adding = addFetcher.state !== "idle";

  // Append the newly created override to local list when add succeeds
  useEffect(() => {
    if (
      addFetcher.state === "idle" &&
      addFetcher.data?.intent === "override-add" &&
      addFetcher.data.ok === true &&
      addFetcher.data.override
    ) {
      const created = addFetcher.data.override as DateOverride;
      if (created.id && created.id !== lastAppendedId.current) {
        lastAppendedId.current = created.id;
        setOverrides((prev) => [...prev, created]);
        setNewDate("");
      }
    }
  }, [addFetcher.state, addFetcher.data]);

  // Restore the row and show error if remove failed
  useEffect(() => {
    if (
      removeFetcher.state === "idle" &&
      removeFetcher.data?.intent === "override-remove" &&
      removeFetcher.data.ok === false
    ) {
      if (pendingRemovedRef.current) {
        setOverrides((prev) => [...prev, pendingRemovedRef.current!]);
        pendingRemovedRef.current = null;
        setRemoveError("Failed to remove date — please try again.");
      }
    } else if (removeFetcher.state === "idle" && removeFetcher.data?.ok === true) {
      pendingRemovedRef.current = null;
      setRemoveError(null);
    }
  }, [removeFetcher.state, removeFetcher.data]);

  function handleAdd() {
    if (!newDate) return;
    addFetcher.submit(
      {
        intent: "override-add",
        date: newDate,
        ...(inspectorId ? { inspectorId } : {}),
      },
      { method: "post" },
    );
  }

  function handleRemove(id: string) {
    const target = overrides.find((o) => o.id === id) ?? null;
    pendingRemovedRef.current = target;
    setRemoveError(null);
    // Optimistic removal
    setOverrides((prev) => prev.filter((o) => o.id !== id));
    removeFetcher.submit(
      { intent: "override-remove", id },
      { method: "post" },
    );
  }

  return (
    <section className="bg-ih-bg-card border border-ih-border rounded-lg p-5 space-y-4">
      <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">Date overrides</h3>
      <p className="text-[12px] text-ih-fg-3">Block specific dates when you are unavailable.</p>

      {overrides.length > 0 ? (
        <div className="space-y-2">
          {overrides.map((o) => (
            <div key={o.id} className="flex items-center justify-between bg-ih-bg-muted rounded-md px-3 py-2 border border-ih-border">
              <div className="flex items-center gap-3">
                <span className="text-[13px] font-bold text-ih-fg-1">{o.date}</span>
                <span className="text-[11px] text-ih-bad-fg font-bold uppercase">Blocked</span>
              </div>
              <button
                onClick={() => handleRemove(o.id)}
                className="text-[12px] text-ih-bad-fg font-bold hover:underline"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[12px] text-ih-fg-4 italic">No date overrides set.</p>
      )}

      {removeError && (
        <p className="text-[12px] text-ih-bad-fg">{removeError}</p>
      )}

      <div className="flex items-center gap-3 pt-1">
        <input
          type="date"
          value={newDate}
          onChange={(e) => setNewDate(e.target.value)}
          className="px-3 py-1.5 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:border-ih-primary focus:shadow-ih-focus outline-none"
        />
        <button
          onClick={handleAdd}
          disabled={adding || !newDate}
          title={!adding && !newDate ? "Pick a date in the field on the left first" : ""}
          className="h-8 px-3 rounded-md bg-ih-primary text-white font-bold text-[12px] hover:bg-ih-primary-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {adding ? "Adding..." : newDate ? "Block date" : "Pick a date first"}
        </button>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Section 4 — Booking Policies                                       */
/* ------------------------------------------------------------------ */

function BookingPolicies({ initialConfig }: { initialConfig: TenantConfig }) {
  const fetcher = useFetcher<typeof action>();
  const [concierge, setConcierge] = useState(initialConfig.conciergeReviewRequired);
  const [blockUnsigned, setBlockUnsigned] = useState(initialConfig.blockUnsignedAgreement);
  const [allowChoice, setAllowChoice] = useState(initialConfig.allowInspectorChoice);
  const [dirty, setDirty] = useState(false);

  const saving = fetcher.state !== "idle";
  const saved =
    fetcher.state === "idle" &&
    fetcher.data?.intent === "policies-save" &&
    fetcher.data.ok === true &&
    !dirty;

  const failed =
    fetcher.state === "idle" &&
    fetcher.data?.intent === "policies-save" &&
    fetcher.data.ok === false &&
    !dirty;

  function handleSave() {
    setDirty(false);
    fetcher.submit(
      {
        intent: "policies-save",
        conciergeReviewRequired: String(concierge),
        blockUnsignedAgreement: String(blockUnsigned),
        allowInspectorChoice: String(allowChoice),
      },
      { method: "post" },
    );
  }

  return (
    <section className="bg-ih-bg-card border border-ih-border rounded-lg p-5 space-y-4">
      <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">Booking policies</h3>

      <label className="flex items-start gap-3 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={concierge}
          onChange={(e) => { setConcierge(e.target.checked); setDirty(true); }}
          className="mt-0.5 h-4 w-4 rounded border-ih-border text-ih-primary"
        />
        <span>
          <span className="block text-[13px] font-bold text-ih-fg-1">Require concierge review</span>
          <span className="block text-[12px] text-ih-fg-3 mt-0.5">
            Agent-submitted bookings must be approved by you before the client receives a confirmation link.
          </span>
        </span>
      </label>

      <label className="flex items-start gap-3 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={blockUnsigned}
          onChange={(e) => { setBlockUnsigned(e.target.checked); setDirty(true); }}
          className="mt-0.5 h-4 w-4 rounded border-ih-border text-ih-primary"
        />
        <span>
          <span className="block text-[13px] font-bold text-ih-fg-1">Require signed agreement</span>
          <span className="block text-[12px] text-ih-fg-3 mt-0.5">
            Clients must sign the inspection agreement before the booking is confirmed.
          </span>
        </span>
      </label>

      <label className="flex items-start gap-3 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={allowChoice}
          onChange={(e) => { setAllowChoice(e.target.checked); setDirty(true); }}
          className="mt-0.5 h-4 w-4 rounded border-ih-border text-ih-primary"
        />
        <span>
          <span className="block text-[13px] font-bold text-ih-fg-1">Allow clients to choose their inspector</span>
          <span className="block text-[12px] text-ih-fg-3 mt-0.5">
            When off, bookings are auto-assigned to the first available inspector.
          </span>
        </span>
      </label>

      <div className="flex items-center gap-3 pt-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="h-8 px-3 rounded-md bg-ih-primary text-white font-bold text-[12px] hover:bg-ih-primary-600 transition-colors disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save policies"}
        </button>
        {saved && <span className="text-[13px] text-ih-ok-fg font-bold">Saved.</span>}
        {failed && (
          <span className="text-[13px] text-ih-bad-fg font-bold">
            {fetcher.data?.message ?? "Save failed. Please try again."}
          </span>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Section 5 — Embed Widget                                           */
/* ------------------------------------------------------------------ */

const STYLES = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "branded", label: "Branded" },
] as const;

function EmbedWidget({ tenant }: { tenant: string | null | undefined }) {
  const [style, setStyle] = useState<"light" | "dark" | "branded">("light");
  const [copied, setCopied] = useState(false);

  // Company-level embed: only requires tenant (slug not needed).
  // See Part 4c — we use company-only embed, no per-inspector variant in the snippet.
  if (!tenant) {
    return (
      <section className="bg-ih-bg-card border border-ih-border rounded-lg p-5 space-y-3">
        <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">Embed widget</h3>
        <div className="w-full min-h-[200px] rounded-md border-2 border-dashed border-ih-border flex items-center justify-center">
          <div className="text-center">
            <EmbedIcon />
            <p className="text-[13px] text-ih-fg-3 mt-2">No company configured — embed widget unavailable.</p>
          </div>
        </div>
      </section>
    );
  }

  // SSR produces "" for origin; client produces the real origin.
  // Same pre-existing mismatch class as StatusAndLinks above.
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const embedUrl = `${origin}/embed/${tenant}?style=${style}`;
  const snippet = `<iframe src="${origin}/embed/${tenant}?style=${style}" style="width:100%;min-height:700px;border:none;" loading="lazy"></iframe>`;

  function copySnippet() {
    void navigator.clipboard.writeText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <section className="bg-ih-bg-card border border-ih-border rounded-lg p-5 space-y-4">
      <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">Embed widget</h3>

      <div className="flex gap-2">
        {STYLES.map((s) => (
          <button
            key={s.id}
            onClick={() => setStyle(s.id)}
            className={`h-9 px-4 rounded-md border-2 text-[13px] font-bold transition-colors ${
              style === s.id
                ? "border-ih-primary text-ih-primary bg-ih-primary-tint"
                : "border-ih-border text-ih-fg-2 hover:border-ih-border"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-bold text-ih-fg-2">Embed code</span>
          <button
            onClick={copySnippet}
            className="h-8 px-3 rounded-md bg-ih-primary text-white font-bold text-[12px] hover:bg-ih-primary-600 transition-colors"
          >
            {copied ? "Copied!" : "Copy snippet"}
          </button>
        </div>
        {/* ds-allow: fixed-dark terminal/code block — stays dark in both themes */}
        <pre className="bg-slate-900 text-emerald-300 dark:bg-slate-950 p-4 rounded-md overflow-x-auto text-[12px] font-mono leading-relaxed whitespace-pre-wrap break-all">
          {snippet}
        </pre>
      </div>

      <div className="space-y-2">
        <span className="text-[12px] font-bold text-ih-fg-2">Live preview</span>
        <iframe
          src={embedUrl}
          className="w-full min-h-[700px] rounded-md border border-ih-border"
          loading="lazy"
          title="Widget preview"
        />
      </div>
    </section>
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

function EmbedIcon() {
  return (
    <svg className="w-8 h-8 mx-auto text-ih-fg-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
    </svg>
  );
}
