import { useLoaderData } from "react-router";
import type { Route } from "./+types/booking";
import { apiFetch } from "~/lib/api.server";

export function meta() {
  return [{ title: "Book an Inspection - OpenInspection" }];
}

interface InspectorProfile {
  name: string;
  company?: string;
  avatar?: string;
  services: { id: string; name: string; price: number; duration: number }[];
}

export async function loader({ params }: Route.LoaderArgs) {
  try {
    const res = await apiFetch(
      `/api/public/book/${params.tenant}/${params.slug}`,
    );
    const json = res.ok ? ((await res.json()) as Record<string, unknown>) : {};
    return {
      profile: (json.data as InspectorProfile) ?? null,
      error: res.ok ? null : "Inspector not found",
    };
  } catch {
    return { profile: null, error: "Service unavailable" };
  }
}

export default function BookingPage() {
  const { profile, error } = useLoaderData<typeof loader>();

  if (error || !profile) {
    return (
      <div className="p-8 text-center">
        <h1 className="text-2xl font-bold">Not Available</h1>
        <p className="text-slate-500 dark:text-slate-400 mt-2">
          {error ?? "This booking page is not available."}
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-6">
      {/* Inspector header */}
      <div className="flex items-center gap-4 mb-8">
        <div className="w-14 h-14 rounded-full bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400 text-xl font-bold">
          {profile.name.charAt(0)}
        </div>
        <div>
          <h1 className="text-xl font-bold">{profile.name}</h1>
          {profile.company && (
            <p className="text-[13px] text-slate-500 dark:text-slate-400">
              {profile.company}
            </p>
          )}
        </div>
      </div>

      {/* Service picker */}
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-3">
        Select a Service
      </h2>
      <div className="space-y-2 mb-8">
        {profile.services.map((svc) => (
          <label
            key={svc.id}
            className="flex items-center justify-between p-4 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-600 cursor-pointer transition-colors"
          >
            <div className="flex items-center gap-3">
              <input
                type="radio"
                name="service"
                value={svc.id}
                className="accent-indigo-600"
              />
              <div>
                <p className="text-[13px] font-medium">{svc.name}</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  ~{svc.duration} min
                </p>
              </div>
            </div>
            <span className="text-sm font-semibold">${svc.price}</span>
          </label>
        ))}
      </div>

      {/* Date/time placeholder */}
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-3">
        Pick a Date &amp; Time
      </h2>
      <div className="p-6 rounded-lg border border-dashed border-slate-300 dark:border-slate-600 text-center text-[13px] text-slate-400 dark:text-slate-500 mb-8">
        Calendar date/time picker will be implemented here
      </div>

      {/* Submit */}
      <button
        type="button"
        className="w-full h-10 rounded-md bg-indigo-600 text-white font-bold text-[13px] hover:bg-indigo-700 transition-colors"
      >
        Request Booking
      </button>
    </div>
  );
}
