import { useLoaderData } from "react-router";
import type { Route } from "./+types/dashboard";
import { requireToken } from "~/lib/session.server";
import { apiFetch } from "~/lib/api.server";

export function meta() {
  return [{ title: "Dashboard - OpenInspection" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const token = await requireToken(request);

  try {
    const res = await apiFetch("/api/inspections/dashboard", { token });
    const data = res.ok ? await res.json() : {};
    return {
      inspections:
        (data as Record<string, Record<string, unknown>>)?.data?.inspections ||
        [],
      greeting: getGreeting(),
    };
  } catch {
    return { inspections: [], greeting: getGreeting() };
  }
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

export default function DashboardPage() {
  const { inspections, greeting } = useLoaderData<typeof loader>();
  const inspectionList = inspections as unknown[];

  return (
    <div className="space-y-[18px]">
      {/* PageHeader */}
      <div>
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase tracking-[0.2em] bg-indigo-50 text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400">
          <span className="w-1 h-1 rounded-full bg-current opacity-60" />
          Dashboard
        </span>
        <h1 className="text-[26px] font-bold tracking-tight mt-1">
          {greeting}
        </h1>
        <p className="text-[13px] text-slate-500 mt-1">
          {inspectionList.length > 0
            ? `${inspectionList.length} inspections`
            : "No inspections yet"}
        </p>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <button className="h-8 px-4 rounded-md bg-indigo-600 text-white font-bold text-[13px] hover:bg-indigo-700 inline-flex items-center gap-2 transition-colors">
          + New Inspection
        </button>
      </div>

      {/* Empty state */}
      {inspectionList.length === 0 && (
        <div className="text-center py-16 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
          <div className="w-16 h-16 mx-auto mb-4 rounded-xl bg-indigo-50 dark:bg-indigo-900/20 flex items-center justify-center">
            <svg
              className="w-8 h-8 text-indigo-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
              />
            </svg>
          </div>
          <p className="font-semibold text-slate-700 dark:text-slate-200">
            No inspections yet
          </p>
          <p className="text-sm text-slate-500 mt-1">
            Create one above to get started.
          </p>
        </div>
      )}
    </div>
  );
}
