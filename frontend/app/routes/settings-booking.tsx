import { useState } from "react";
import { Link, useLoaderData } from "react-router";
import type { Route } from "./+types/settings-booking";
import { requireToken } from "~/lib/session.server";
import { apiFetch } from "~/lib/api.server";
import { useSessionContext } from "~/hooks/useSessionContext";

interface AvailabilitySlot {
  id: number;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

interface DateOverride {
  id: number;
  date: string;
  isAvailable: boolean;
  startTime: string | null;
  endTime: string | null;
}

interface TenantConfig {
  conciergeReviewRequired: boolean;
  blockUnsignedAgreement: boolean;
}

export function meta() {
  return [{ title: "Online Booking - Settings - OpenInspection" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const token = await requireToken(request);
  const [availRes, overridesRes, configRes, originsRes] = await Promise.all([
    apiFetch("/api/availability", { token }).catch(() => null),
    apiFetch("/api/availability/overrides", { token }).catch(() => null),
    apiFetch("/api/admin/tenant-config", { token }).catch(() => null),
    apiFetch("/api/admin/widget/origins", { token }).catch(() => null),
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

  let config: TenantConfig = { conciergeReviewRequired: false, blockUnsignedAgreement: false };
  if (configRes?.ok) {
    const body = (await configRes.json()) as Record<string, unknown>;
    const d = (body.data ?? {}) as Record<string, unknown>;
    config = {
      conciergeReviewRequired: Boolean(d.conciergeReviewRequired),
      blockUnsignedAgreement: Boolean(d.blockUnsignedAgreement),
    };
  }

  let origins: string[] = [];
  if (originsRes?.ok) {
    const body = (await originsRes.json()) as Record<string, unknown>;
    const d = (body.data ?? {}) as Record<string, unknown>;
    origins = (d.origins || []) as string[];
  }

  return { slots, overrides, config, origins };
}

const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default function SettingsBookingPage() {
  const data = useLoaderData<typeof loader>();
  const ctx = useSessionContext();

  const tenant = ctx?.branding?.tenantSubdomain;
  const slug = ctx?.branding?.currentUserSlug;

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
      <WeeklySchedule initialSlots={data.slots} />
      <DateOverrides initialOverrides={data.overrides} />
      <BookingPolicies initialConfig={data.config} />
      <EmbedWidget tenant={tenant} slug={slug} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Section 1 — Status & Links                                        */
/* ------------------------------------------------------------------ */

function StatusAndLinks({ tenant, slug }: { tenant: string | null | undefined; slug: string | null | undefined }) {
  const [copiedField, setCopiedField] = useState<string | null>(null);

  if (!slug) {
    return (
      <section className="bg-ih-bad-bg border border-ih-bad-fg/20 rounded-lg p-5 space-y-2">
        <h3 className="text-[13px] font-bold text-ih-bad-fg">Booking page not available</h3>
        <p className="text-[12px] text-ih-fg-2">
          You need to set a booking slug before your public booking page can go live.
        </p>
        <Link
          to="/settings/profile"
          className="inline-block text-[12px] text-ih-primary font-bold hover:underline"
        >
          Go to Profile settings &rarr;
        </Link>
      </section>
    );
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const bookingUrl = `${origin}/book/${tenant}/${slug}`;
  const profileUrl = `${origin}/inspector/${tenant}/${slug}`;

  function copy(value: string, field: string) {
    void navigator.clipboard.writeText(value);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  }

  return (
    <section className="bg-ih-bg-card border border-ih-border rounded-lg p-5 space-y-4">
      <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">Your links</h3>
      <UrlRow label="Booking page" url={bookingUrl} copied={copiedField === "booking"} onCopy={() => copy(bookingUrl, "booking")} />
      <UrlRow label="Inspector profile" url={profileUrl} copied={copiedField === "profile"} onCopy={() => copy(profileUrl, "profile")} />
    </section>
  );
}

function UrlRow({ label, url, copied, onCopy }: { label: string; url: string; copied: boolean; onCopy: () => void }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-[12px] font-bold text-ih-fg-2 w-32 shrink-0">{label}</span>
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

function WeeklySchedule({ initialSlots }: { initialSlots: AvailabilitySlot[] }) {
  const [days, setDays] = useState<DayState[]>(() => buildDayMap(initialSlots));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function updateDay(idx: number, patch: Partial<DayState>) {
    setDays((prev) => prev.map((d, i) => (i === idx ? { ...d, ...patch } : d)));
    setSaved(false);
  }

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    const slots = days
      .map((d, i) => (d.enabled ? { dayOfWeek: i, startTime: d.startTime, endTime: d.endTime } : null))
      .filter(Boolean);
    await fetch("/api/availability", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ slots }),
    });
    setSaving(false);
    setSaved(true);
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
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Section 3 — Date Overrides                                         */
/* ------------------------------------------------------------------ */

function DateOverrides({ initialOverrides }: { initialOverrides: DateOverride[] }) {
  const [overrides, setOverrides] = useState<DateOverride[]>(initialOverrides);
  const [newDate, setNewDate] = useState("");
  const [adding, setAdding] = useState(false);

  async function handleAdd() {
    if (!newDate) return;
    setAdding(true);
    const res = await fetch("/api/availability/overrides", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ date: newDate, isAvailable: false }),
    });
    if (res.ok) {
      const body = (await res.json()) as Record<string, unknown>;
      const d = (body.data ?? {}) as Record<string, unknown>;
      const created = d.override as DateOverride;
      if (created) {
        setOverrides((prev) => [...prev, created]);
      }
      setNewDate("");
    }
    setAdding(false);
  }

  async function handleRemove(id: number) {
    setOverrides((prev) => prev.filter((o) => o.id !== id));
    await fetch(`/api/availability/overrides/${id}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
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
          className="h-8 px-3 rounded-md bg-ih-primary text-white font-bold text-[12px] hover:bg-ih-primary-600 transition-colors disabled:opacity-50"
        >
          {adding ? "Adding..." : "Block date"}
        </button>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Section 4 — Booking Policies                                       */
/* ------------------------------------------------------------------ */

function BookingPolicies({ initialConfig }: { initialConfig: TenantConfig }) {
  const [concierge, setConcierge] = useState(initialConfig.conciergeReviewRequired);
  const [blockUnsigned, setBlockUnsigned] = useState(initialConfig.blockUnsignedAgreement);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    await fetch("/api/admin/tenant-config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        conciergeReviewRequired: concierge,
        blockUnsignedAgreement: blockUnsigned,
      }),
    });
    setSaving(false);
    setSaved(true);
  }

  return (
    <section className="bg-ih-bg-card border border-ih-border rounded-lg p-5 space-y-4">
      <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">Booking policies</h3>

      <label className="flex items-start gap-3 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={concierge}
          onChange={(e) => { setConcierge(e.target.checked); setSaved(false); }}
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
          onChange={(e) => { setBlockUnsigned(e.target.checked); setSaved(false); }}
          className="mt-0.5 h-4 w-4 rounded border-ih-border text-ih-primary"
        />
        <span>
          <span className="block text-[13px] font-bold text-ih-fg-1">Require signed agreement</span>
          <span className="block text-[12px] text-ih-fg-3 mt-0.5">
            Clients must sign the inspection agreement before the booking is confirmed.
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

function EmbedWidget({ tenant, slug }: { tenant: string | null | undefined; slug: string | null | undefined }) {
  const [style, setStyle] = useState<"light" | "dark" | "branded">("light");
  const [copied, setCopied] = useState(false);
  const hasBooking = !!(tenant && slug);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const embedUrl = hasBooking ? `${origin}/embed/${tenant}/${slug}?style=${style}` : null;

  const snippet = hasBooking
    ? `<iframe src="${origin}/embed/${tenant}/${slug}?style=${style}" style="width:100%;min-height:700px;border:none;" loading="lazy"></iframe>`
    : "";

  function copySnippet() {
    void navigator.clipboard.writeText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (!hasBooking) {
    return (
      <section className="bg-ih-bg-card border border-ih-border rounded-lg p-5 space-y-3">
        <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">Embed widget</h3>
        <div className="w-full min-h-[200px] rounded-md border-2 border-dashed border-ih-border flex items-center justify-center">
          <div className="text-center">
            <EmbedIcon />
            <p className="text-[13px] text-ih-fg-3 mt-2">Set a booking slug in your profile to enable the embed widget.</p>
            <Link to="/settings/profile" className="text-[13px] text-ih-primary hover:underline mt-1 inline-block">
              Go to Profile &rarr;
            </Link>
          </div>
        </div>
      </section>
    );
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
        <pre className="bg-slate-900 text-emerald-300 dark:bg-slate-950 p-4 rounded-md overflow-x-auto text-[12px] font-mono leading-relaxed whitespace-pre-wrap break-all">
          {snippet}
        </pre>
      </div>

      <div className="space-y-2">
        <span className="text-[12px] font-bold text-ih-fg-2">Live preview</span>
        <iframe
          src={embedUrl!}
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
