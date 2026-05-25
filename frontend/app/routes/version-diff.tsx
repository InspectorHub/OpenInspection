import { useLoaderData } from "react-router";
import type { Route } from "./+types/version-diff";
import { requireToken } from "~/lib/session.server";
import { apiFetch } from "~/lib/api.server";

export function meta() {
  return [{ title: "Version Diff - OpenInspection" }];
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface DiffEntry {
  field: string;
  section: string;
  item: string;
  before: string | null;
  after: string | null;
}

/* ------------------------------------------------------------------ */
/*  Loader                                                             */
/* ------------------------------------------------------------------ */

export async function loader({ request, params }: Route.LoaderArgs) {
  const token = await requireToken(request);
  const { id, n } = params;

  try {
    const res = await apiFetch(
      `/api/inspections/${id}/versions/${n}/diff`,
      { token },
    );
    if (!res.ok) {
      return { inspectionId: id, version: n, diffs: [] as DiffEntry[], error: "Version not found" };
    }
    const json = (await res.json()) as Record<string, unknown>;
    return {
      inspectionId: id,
      version: n,
      diffs: ((json.data as Record<string, unknown>)?.diffs as DiffEntry[]) ?? [],
      error: null,
    };
  } catch {
    return { inspectionId: id, version: n, diffs: [] as DiffEntry[], error: "Service unavailable" };
  }
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function VersionDiffPage() {
  const { inspectionId, version, diffs, error } =
    useLoaderData<typeof loader>();

  if (error) {
    return (
      <div className="max-w-3xl mx-auto p-8 text-center">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
          Version Diff
        </h1>
        <p className="text-slate-500 dark:text-slate-400 mt-2">{error}</p>
        <a
          href={`/inspections/${inspectionId}/edit`}
          className="inline-flex items-center mt-4 h-9 px-4 rounded-md bg-indigo-600 text-white font-bold text-[13px] hover:bg-indigo-700 transition-colors"
        >
          Back to Inspection
        </a>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto py-8 px-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            Version {version} Changes
          </h1>
          <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-1">
            Inspection #{String(inspectionId).slice(0, 8).toUpperCase()} — {diffs.length} change{diffs.length !== 1 ? "s" : ""}
          </p>
        </div>
        <a
          href={`/inspections/${inspectionId}/edit`}
          className="h-9 px-4 rounded-md border border-slate-200 dark:border-slate-700 text-[13px] font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors inline-flex items-center"
        >
          Back to Editor
        </a>
      </div>

      {/* Diff table */}
      {diffs.length === 0 ? (
        <div className="p-6 rounded-lg border border-dashed border-slate-300 dark:border-slate-600 text-center text-[13px] text-slate-400">
          No changes in this version.
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
          <div className="grid grid-cols-[1fr_1fr_1fr] gap-0 text-[11px] font-bold uppercase tracking-widest text-slate-400 bg-slate-50 dark:bg-slate-900/30 border-b border-slate-200 dark:border-slate-700">
            <div className="px-4 py-3">Field</div>
            <div className="px-4 py-3 border-l border-slate-200 dark:border-slate-700">
              Before
            </div>
            <div className="px-4 py-3 border-l border-slate-200 dark:border-slate-700">
              After
            </div>
          </div>

          {diffs.map((d, i) => (
            <div
              key={i}
              className="grid grid-cols-[1fr_1fr_1fr] gap-0 border-b last:border-b-0 border-slate-100 dark:border-slate-700"
            >
              <div className="px-4 py-3">
                <p className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">
                  {d.item}
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {d.section} / {d.field}
                </p>
              </div>
              <div className="px-4 py-3 border-l border-slate-200 dark:border-slate-700 bg-red-50/50 dark:bg-red-900/10">
                <span className="text-[13px] text-red-700 dark:text-red-400">
                  {d.before ?? <span className="italic text-slate-400">empty</span>}
                </span>
              </div>
              <div className="px-4 py-3 border-l border-slate-200 dark:border-slate-700 bg-emerald-50/50 dark:bg-emerald-900/10">
                <span className="text-[13px] text-emerald-700 dark:text-emerald-400">
                  {d.after ?? <span className="italic text-slate-400">empty</span>}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
