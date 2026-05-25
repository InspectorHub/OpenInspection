import { useState } from "react";
import { useLoaderData } from "react-router";
import type { Route } from "./+types/recommendations";
import { requireToken } from "~/lib/session.server";
import { apiFetch } from "~/lib/api.server";

export function meta() {
  return [{ title: "Repair Items - OpenInspection" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const token = await requireToken(request);
  try {
    const res = await apiFetch("/api/recommendations", { token });
    const data = res.ok ? await res.json() : {};
    return { items: (data as any)?.data || [] };
  } catch {
    return { items: [] };
  }
}

export default function RecommendationsPage() {
  const { items } = useLoaderData<typeof loader>();
  const [activeTab, setActiveTab] = useState("all");

  const tabs = [
    { id: "all", label: "All" },
    { id: "safety", label: "Safety" },
    { id: "repair", label: "Repair" },
    { id: "maintenance", label: "Maintenance" },
  ];

  return (
    <div className="space-y-[18px]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase tracking-[0.2em] bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400">
            <span className="w-1 h-1 rounded-full bg-current opacity-60" />
            Library · Repair Items
          </span>
          <h1 className="text-[26px] font-bold tracking-tight mt-1">Repair Items</h1>
          <p className="text-[13px] text-slate-500 mt-1">{items.length} in library</p>
        </div>
        <button className="h-9 px-4 rounded-md bg-indigo-600 text-white font-bold text-[13px] hover:bg-indigo-700 inline-flex items-center gap-2">
          + Add item
        </button>
      </div>

      {/* Underline tabs (TabStrip pattern — NOT pills) */}
      <div className="flex items-center border-b border-slate-200 dark:border-slate-700">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3.5 py-2.5 border-b-2 text-[13px] font-bold transition-all ${
              activeTab === tab.id
                ? "border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400"
                : "border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-slate-200"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {items.length === 0 ? (
        <div className="text-center py-16 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
          <p className="font-semibold text-slate-700 dark:text-slate-200">No repair items yet</p>
          <p className="text-sm text-slate-500 mt-1">Click "+ Add item" above to create your first repair recommendation.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {items.map((item: any) => (
            <div key={item.id} className="p-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg">
              <p className="text-[13px] font-semibold text-slate-800 dark:text-slate-200">{item.title || item.name}</p>
              {item.description && (
                <p className="text-[13px] text-slate-500 mt-1 line-clamp-2">{item.description}</p>
              )}
              <div className="flex items-center gap-2 mt-2">
                {item.category && (
                  <span className="inline-flex items-center h-6 px-2 rounded text-[11px] font-bold uppercase tracking-[0.04em] bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400">
                    {item.category}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
