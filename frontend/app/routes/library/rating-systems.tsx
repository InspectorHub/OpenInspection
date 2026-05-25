import { useLoaderData } from "react-router";
import type { Route } from "./+types/rating-systems";
import { requireToken } from "~/lib/session.server";
import { apiFetch } from "~/lib/api.server";

export function meta() {
  return [{ title: "Rating Systems - OpenInspection" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const token = await requireToken(request);
  try {
    const res = await apiFetch("/api/admin/rating-systems", { token });
    const data = res.ok ? await res.json() : {};
    return { systems: (data as any)?.data || [] };
  } catch {
    return { systems: [] };
  }
}

export default function RatingSystemsPage() {
  const { systems } = useLoaderData<typeof loader>();

  return (
    <div className="space-y-[18px]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase tracking-[0.2em] bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400">
            <span className="w-1 h-1 rounded-full bg-current opacity-60" />
            Library · Rating Systems
          </span>
          <h1 className="text-[26px] font-bold tracking-tight mt-1">Rating Systems</h1>
          <p className="text-[13px] text-slate-500 mt-1">{systems.length} systems</p>
        </div>
        <button className="h-9 px-4 rounded-md bg-indigo-600 text-white font-bold text-[13px] hover:bg-indigo-700 inline-flex items-center gap-2">
          + New rating system
        </button>
      </div>

      {systems.length === 0 ? (
        <div className="text-center py-16 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
          <p className="font-semibold text-slate-700 dark:text-slate-200">No rating systems yet</p>
          <p className="text-sm text-slate-500 mt-1">Click "+ New rating system" above to define how items are rated during inspections.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {systems.map((sys: any) => (
            <div key={sys.id} className="p-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[13px] font-semibold text-slate-800 dark:text-slate-200">{sys.name}</p>
                  {sys.description && (
                    <p className="text-[13px] text-slate-500 mt-1 line-clamp-2">{sys.description}</p>
                  )}
                </div>
                <button className="text-[13px] text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300 font-semibold shrink-0 ml-4">
                  Edit
                </button>
              </div>
              {sys.ratings && Array.isArray(sys.ratings) && (
                <div className="flex items-center gap-1.5 mt-3">
                  {sys.ratings.map((r: any, idx: number) => (
                    <span
                      key={idx}
                      className="inline-flex items-center h-6 px-2 rounded text-[11px] font-bold"
                      style={{
                        backgroundColor: r.color ? `${r.color}20` : undefined,
                        color: r.color || undefined,
                      }}
                    >
                      {r.label || r.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
