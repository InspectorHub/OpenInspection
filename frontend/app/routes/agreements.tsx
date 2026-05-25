import { useState } from "react";
import { useLoaderData } from "react-router";
import type { Route } from "./+types/agreements";
import { requireToken } from "~/lib/session.server";
import { apiFetch } from "~/lib/api.server";

export function meta() {
  return [{ title: "Agreements - OpenInspection" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const token = await requireToken(request);
  try {
    const res = await apiFetch("/api/admin/agreements", { token });
    const data = res.ok ? await res.json() : {};
    return { agreements: (data as any)?.data || [] };
  } catch {
    return { agreements: [] };
  }
}

export default function AgreementsPage() {
  const { agreements } = useLoaderData<typeof loader>();
  const [activeTab, setActiveTab] = useState("templates");

  const tabs = [
    { id: "templates", label: "Templates" },
    { id: "signing", label: "Signing" },
  ];

  const filtered = activeTab === "templates"
    ? agreements.filter((a: any) => !a.signedAt)
    : agreements.filter((a: any) => a.signedAt);

  return (
    <div className="space-y-[18px]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase tracking-[0.2em] bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400">
            <span className="w-1 h-1 rounded-full bg-current opacity-60" />
            Library · Agreements
          </span>
          <h1 className="text-[26px] font-bold tracking-tight mt-1">Agreements</h1>
          <p className="text-[13px] text-slate-500 mt-1">{agreements.length} total</p>
        </div>
        <button className="h-9 px-4 rounded-md bg-indigo-600 text-white font-bold text-[13px] hover:bg-indigo-700 inline-flex items-center gap-2">
          + New agreement
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

      {filtered.length === 0 ? (
        <div className="text-center py-16 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
          <p className="font-semibold text-slate-700 dark:text-slate-200">
            {activeTab === "templates" ? "No agreement templates yet" : "No signed agreements yet"}
          </p>
          <p className="text-sm text-slate-500 mt-1">
            {activeTab === "templates"
              ? "Click \"+ New agreement\" above to create your first agreement template."
              : "Signed agreements will appear here after clients complete the signing process."}
          </p>
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700">
                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">Title</th>
                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  {activeTab === "templates" ? "Last updated" : "Signed"}
                </th>
                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">Status</th>
                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-500 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {filtered.map((a: any) => (
                <tr key={a.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                  <td className="px-4 py-3 text-[13px] font-semibold text-slate-800 dark:text-slate-200">
                    {a.title || a.name || "Untitled"}
                  </td>
                  <td className="px-4 py-3 text-[13px] text-slate-500">
                    {a.signedAt || a.updatedAt || "--"}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center h-6 px-2 rounded text-[11px] font-bold uppercase tracking-[0.04em] ${
                      a.signedAt
                        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400"
                        : "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400"
                    }`}>
                      {a.signedAt ? "Signed" : "Draft"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button className="text-[13px] text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300 font-semibold">
                      {activeTab === "templates" ? "Edit" : "View"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
