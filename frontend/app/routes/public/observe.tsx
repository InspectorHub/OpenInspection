import { useLoaderData } from "react-router";
import type { Route } from "./+types/observe";
import { apiFetch } from "~/lib/api.server";

export function meta() {
  return [{ title: "Observe Inspection - OpenInspection" }];
}

interface ObserveData {
  address: string;
  date: string | null;
  inspectorName: string;
  status: string;
  sections: { name: string; completedItems: number; totalItems: number }[];
}

export async function loader({ params }: Route.LoaderArgs) {
  try {
    const res = await apiFetch(
      `/api/public/observe/inspections/${params.id}`,
    );
    const body = res.ok ? await res.json() : {};
    const d = ((body as Record<string, unknown>).data ?? {}) as Record<string, unknown>;
    return {
      inspection: (Object.keys(d).length > 0 ? d : null) as ObserveData | null,
      error: res.ok ? null : "Inspection not found",
    };
  } catch {
    return { inspection: null, error: "Service unavailable" };
  }
}

export default function ObservePage() {
  const { inspection, error } = useLoaderData<typeof loader>();

  if (error || !inspection) {
    return (
      <div className="p-8 text-center">
        <h1 className="text-2xl font-bold">Inspection Not Found</h1>
        <p className="text-ih-fg-3 mt-2">
          {error ?? "This observation link is invalid or expired."}
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-6">
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <h1 className="text-xl font-bold">{inspection.address}</h1>
          <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400">
            {inspection.status}
          </span>
        </div>
        <p className="text-[13px] text-ih-fg-3">
          Inspector: {inspection.inspectorName}
          {inspection.date && <span> &middot; {inspection.date}</span>}
        </p>
      </div>

      {/* Read-only section progress */}
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ih-fg-3 mb-3">
        Progress
      </h2>
      <div className="space-y-2">
        {inspection.sections.map((section, i) => {
          const pct =
            section.totalItems > 0
              ? Math.round(
                  (section.completedItems / section.totalItems) * 100,
                )
              : 0;
          return (
            <div
              key={i}
              className="p-4 rounded-lg border border-ih-border"
            >
              <div className="flex items-center justify-between mb-2">
                <p className="text-[13px] font-medium">{section.name}</p>
                <span className="text-[11px] text-ih-fg-3">
                  {section.completedItems}/{section.totalItems}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-ih-bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-indigo-500 transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
