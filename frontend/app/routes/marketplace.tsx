import { useState } from "react";
import { useLoaderData } from "react-router";
import type { Route } from "./+types/marketplace";
import { requireToken } from "~/lib/session.server";
import { apiFetch } from "~/lib/api.server";

export function meta() {
  return [{ title: "Marketplace - OpenInspection" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const token = await requireToken(request);
  try {
    const res = await apiFetch("/api/marketplace/templates", { token });
    const data = res.ok ? await res.json() : {};
    return { templates: (data as any)?.data || [] };
  } catch {
    return { templates: [] };
  }
}

export default function MarketplacePage() {
  const { templates } = useLoaderData<typeof loader>();
  const [activeTab, setActiveTab] = useState("all");

  const tabs = [
    { id: "all", label: "All" },
    { id: "templates", label: "Templates" },
    { id: "comments", label: "Comments" },
    { id: "agreements", label: "Agreements" },
  ];

  return (
    <div className="space-y-[18px]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase tracking-[0.2em] bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400">
            <span className="w-1 h-1 rounded-full bg-current opacity-60" />
            Library · Marketplace
          </span>
          <h1 className="text-[26px] font-bold tracking-tight mt-1">Marketplace</h1>
          <p className="text-[13px] text-slate-500 mt-1">{templates.length} available</p>
        </div>
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

      {templates.length === 0 ? (
        <div className="text-center py-16 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
          <p className="font-semibold text-slate-700 dark:text-slate-200">Marketplace is empty</p>
          <p className="text-sm text-slate-500 mt-1">Community templates and content packs will appear here.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {templates.map((t: any) => (
            <div key={t.id} className="p-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg">
              <p className="text-[13px] font-semibold text-slate-800 dark:text-slate-200">{t.name || t.title}</p>
              {t.description && (
                <p className="text-[13px] text-slate-500 mt-1 line-clamp-2">{t.description}</p>
              )}
              <div className="flex items-center justify-between mt-3">
                <div className="flex items-center gap-2">
                  {t.category && (
                    <span className="inline-flex items-center h-6 px-2 rounded text-[11px] font-bold uppercase tracking-[0.04em] bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400">
                      {t.category}
                    </span>
                  )}
                  {t.author && (
                    <span className="text-[11px] text-slate-400">{t.author}</span>
                  )}
                </div>
                <button className="h-8 px-3 rounded-md bg-indigo-600 text-white font-bold text-[12px] hover:bg-indigo-700 transition-colors">
                  Install
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
