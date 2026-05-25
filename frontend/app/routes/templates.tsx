import { useState } from "react";
import { useLoaderData } from "react-router";
import type { Route } from "./+types/templates";
import { requireToken } from "~/lib/session.server";
import { apiFetch } from "~/lib/api.server";

export function meta() {
  return [{ title: "Templates - OpenInspection" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const token = await requireToken(request);
  try {
    const res = await apiFetch("/api/inspections/templates", { token });
    const data = res.ok ? await res.json() : {};
    return { templates: (data as any)?.data || [] };
  } catch {
    return { templates: [] };
  }
}

export default function TemplatesPage() {
  const { templates } = useLoaderData<typeof loader>();
  const [view, setView] = useState<"list" | "card">("list");

  return (
    <div className="space-y-[18px]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase tracking-[0.2em] bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400">
            <span className="w-1 h-1 rounded-full bg-current opacity-60" />
            Library &middot; Templates
          </span>
          <h1 className="text-[26px] font-bold tracking-tight mt-1">
            Inspection Templates
          </h1>
          <p className="text-[13px] text-slate-500 mt-1">
            {templates.length} templates
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex bg-slate-100 dark:bg-slate-700 rounded-md p-0.5">
            <button
              onClick={() => setView("card")}
              className={`px-3 py-1.5 rounded text-[12px] font-bold ${view === "card" ? "bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm" : "text-slate-500"}`}
            >
              Cards
            </button>
            <button
              onClick={() => setView("list")}
              className={`px-3 py-1.5 rounded text-[12px] font-bold ${view === "list" ? "bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm" : "text-slate-500"}`}
            >
              List
            </button>
          </div>
          <button className="h-9 px-3 rounded-md border border-slate-200 dark:border-slate-700 text-[13px] font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 inline-flex items-center gap-2">
            &darr; Import Spectora
          </button>
          <button className="h-9 px-4 rounded-md bg-indigo-600 text-white font-bold text-[13px] hover:bg-indigo-700 inline-flex items-center gap-2">
            + New Template
          </button>
        </div>
      </div>

      {/* List view */}
      {view === "list" && (
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700">
                <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  Name
                </th>
                <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  Version
                </th>
                <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  Items
                </th>
              </tr>
            </thead>
            <tbody>
              {templates.length === 0 ? (
                <tr>
                  <td
                    colSpan={3}
                    className="py-12 text-center text-[13px] text-slate-500"
                  >
                    No templates yet. Create one or import from Spectora.
                  </td>
                </tr>
              ) : (
                templates.map((t: any) => (
                  <tr
                    key={t.id}
                    className="border-b border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/30"
                  >
                    <td className="py-3 px-4 text-[13px] font-medium text-slate-900 dark:text-slate-100">
                      {t.name}
                    </td>
                    <td className="py-3 px-4 text-[13px] font-mono text-slate-500">
                      v{t.version || 1}
                    </td>
                    <td className="py-3 px-4 text-[13px] text-slate-500">
                      {t.schema?.sections?.reduce(
                        (sum: number, s: any) =>
                          sum + (s.items?.length || 0),
                        0,
                      ) || 0}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Card view */}
      {view === "card" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {templates.length === 0 ? (
            <div className="col-span-full text-center py-16 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
              <p className="font-semibold text-slate-700 dark:text-slate-200">
                No templates yet
              </p>
            </div>
          ) : (
            templates.map((t: any) => (
              <div
                key={t.id}
                className="p-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:shadow-md transition-all"
              >
                <h3 className="font-bold text-[14px] text-slate-900 dark:text-slate-100">
                  {t.name}
                </h3>
                <p className="text-[11px] text-slate-500 mt-1">
                  v{t.version || 1} &middot;{" "}
                  {t.schema?.sections?.length || 0} sections
                </p>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
