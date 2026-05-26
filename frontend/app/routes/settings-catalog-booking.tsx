import { useState } from "react";
import { useLoaderData, Link } from "react-router";
import type { Route } from "./+types/settings-catalog-booking";
import { requireToken } from "~/lib/session.server";
import { apiFetch } from "~/lib/api.server";

interface BookingConfig {
  enabled: boolean;
  conciergeReviewRequired: boolean;
  defaultDurationMin: number;
  availabilityStart: string;
  availabilityEnd: string;
  embedCode?: string;
}

export function meta() {
  return [{ title: "Booking Settings - OpenInspection" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const token = await requireToken(request);
  try {
    const res = await apiFetch("/api/admin/booking-config", { token });
    if (!res.ok)
      return {
        config: {
          enabled: false,
          conciergeReviewRequired: false,
          defaultDurationMin: 60,
          availabilityStart: "08:00",
          availabilityEnd: "17:00",
        },
      };
    const body = await res.json();
    const d = ((body as Record<string, unknown>).data ?? {}) as Record<string, unknown>;
    return { config: (Object.keys(d).length > 0 ? d : null) as BookingConfig | null };
  } catch {
    return {
      config: {
        enabled: false,
        conciergeReviewRequired: false,
        defaultDurationMin: 60,
        availabilityStart: "08:00",
        availabilityEnd: "17:00",
      },
    };
  }
}

export default function SettingsCatalogBooking() {
  const { config: initial } = useLoaderData<typeof loader>();
  const cfg = initial as BookingConfig;
  const [enabled, setEnabled] = useState(cfg?.enabled ?? false);
  const [reviewRequired, setReviewRequired] = useState(
    cfg?.conciergeReviewRequired ?? false,
  );
  const [duration, setDuration] = useState(cfg?.defaultDurationMin ?? 60);
  const [startTime, setStartTime] = useState(
    cfg?.availabilityStart ?? "08:00",
  );
  const [endTime, setEndTime] = useState(cfg?.availabilityEnd ?? "17:00");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const embedCode = `<iframe src="${typeof window !== "undefined" ? window.location.origin : ""}/book/YOUR_TENANT/default" width="100%" height="600" frameborder="0"></iframe>`;

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    await fetch("/api/admin/booking-config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        enabled,
        conciergeReviewRequired: reviewRequired,
        defaultDurationMin: duration,
        availabilityStart: startTime,
        availabilityEnd: endTime,
      }),
    });
    setSaving(false);
    setSaved(true);
  }

  return (
    <div className="space-y-[18px]">
      <div className="flex items-center gap-2 text-[13px] text-ih-fg-3">
        <Link
          to="/settings"
          className="hover:text-ih-primary transition-colors"
        >
          Settings
        </Link>
        <span>&rsaquo;</span>
        <span className="text-ih-fg-1">Booking</span>
      </div>

      <h2 className="text-[19px] font-bold text-ih-fg-1">
        Booking
      </h2>

      {/* Public booking toggle */}
      <div className="bg-ih-bg-card border border-ih-border rounded-lg p-6 space-y-5">
        <div>
          <h3 className="text-[15px] font-bold text-ih-fg-1">
            Public booking page
          </h3>
          <p className="text-[12px] text-ih-fg-3 mt-1">
            Allow clients to book inspections through your public booking page.
          </p>
        </div>

        <label className="flex items-start gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="mt-1 h-4 w-4 rounded border-ih-border text-ih-primary focus:ring-indigo-500"
          />
          <span>
            <span className="block text-[13px] font-bold text-ih-fg-1">
              Enable public booking
            </span>
            <span className="block text-[12px] text-ih-fg-3 mt-0.5">
              When enabled, clients can self-schedule through your booking link.
            </span>
          </span>
        </label>
      </div>

      {/* Concierge review */}
      <div className="bg-ih-bg-card border border-ih-border rounded-lg p-6 space-y-5">
        <div>
          <h3 className="text-[15px] font-bold text-ih-fg-1">
            Concierge bookings
          </h3>
          <p className="text-[12px] text-ih-fg-3 mt-1">
            Partner agents can submit bookings on behalf of their clients.
          </p>
        </div>

        {/* Flow diagram */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div
            className={`border rounded-lg p-4 ${
 reviewRequired
 ? "border-ih-border bg-ih-bg-muted"
 : "border-ih-primary bg-ih-primary-tint"
 }`}
          >
            <div className="text-[10px] font-bold uppercase tracking-widest text-ih-fg-3 mb-2">
              Auto mode{!reviewRequired ? " — active" : ""}
            </div>
            <div className="flex items-center gap-2 text-[11px] font-bold text-ih-fg-1">
              <span className="px-2 py-1 rounded border border-ih-border bg-ih-bg-card">
                Agent submits
              </span>
              <span className="text-ih-fg-4">&rarr;</span>
              <span className="px-2 py-1 rounded border border-ih-border bg-ih-bg-card">
                Client confirms
              </span>
            </div>
          </div>
          <div
            className={`border rounded-lg p-4 ${
 reviewRequired
 ? "border-ih-primary bg-ih-primary-tint"
 : "border-ih-border bg-ih-bg-muted"
 }`}
          >
            <div className="text-[10px] font-bold uppercase tracking-widest text-ih-fg-3 mb-2">
              Review mode{reviewRequired ? " — active" : ""}
            </div>
            <div className="flex items-center gap-2 text-[11px] font-bold text-ih-fg-1">
              <span className="px-2 py-1 rounded border border-ih-border bg-ih-bg-card">
                Agent submits
              </span>
              <span className="text-ih-fg-4">&rarr;</span>
              <span className="px-2 py-1 rounded border border-ih-primary bg-ih-primary-tint">
                You review
              </span>
              <span className="text-ih-fg-4">&rarr;</span>
              <span className="px-2 py-1 rounded border border-ih-border bg-ih-bg-card">
                Client confirms
              </span>
            </div>
          </div>
        </div>

        <label className="flex items-start gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={reviewRequired}
            onChange={(e) => setReviewRequired(e.target.checked)}
            className="mt-1 h-4 w-4 rounded border-ih-border text-ih-primary focus:ring-indigo-500"
          />
          <span>
            <span className="block text-[13px] font-bold text-ih-fg-1">
              Review concierge bookings before sending to client
            </span>
            <span className="block text-[12px] text-ih-fg-3 mt-0.5">
              When enabled, you must approve each booking from your dashboard
              before the client receives the magic link.
            </span>
          </span>
        </label>
      </div>

      {/* Availability */}
      <div className="bg-ih-bg-card border border-ih-border rounded-lg p-6 space-y-4">
        <h3 className="text-[15px] font-bold text-ih-fg-1">
          Availability
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-[11px] font-bold text-ih-fg-3 mb-1 uppercase tracking-widest">
              Default duration (min)
            </label>
            <input
              type="number"
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              min={15}
              step={15}
              className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:border-ih-primary focus:shadow-ih-focus outline-none"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-ih-fg-3 mb-1 uppercase tracking-widest">
              Start time
            </label>
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:border-ih-primary focus:shadow-ih-focus outline-none"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-ih-fg-3 mb-1 uppercase tracking-widest">
              End time
            </label>
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:border-ih-primary focus:shadow-ih-focus outline-none"
            />
          </div>
        </div>
      </div>

      {/* Embed code */}
      <div className="bg-ih-bg-card border border-ih-border rounded-lg p-6 space-y-3">
        <h3 className="text-[15px] font-bold text-ih-fg-1">
          Widget embed code
        </h3>
        <p className="text-[12px] text-ih-fg-3">
          Copy this snippet to embed the booking widget on your website.
        </p>
        <pre className="bg-ih-bg-muted border border-ih-border rounded-md p-3 text-[12px] text-ih-fg-2 font-mono overflow-x-auto">
          {embedCode}
        </pre>
      </div>

      {/* Save */}
      <div className="flex justify-end pt-2 border-t border-ih-border">
        <div className="flex items-center gap-3">
          {saved && (
            <span className="text-[13px] text-ih-ok-fg font-bold">
              Saved.
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="h-9 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 transition-colors disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
