import { useState } from "react";
import { useLoaderData } from "react-router";
import type { Route } from "./+types/metrics";
import { requireToken } from "~/lib/session.server";
import { apiFetch } from "~/lib/api.server";
import { PageHeader } from "@core/shared-ui";

export function meta() {
  return [{ title: "Metrics - OpenInspection" }];
}

interface MetricsData {
  totalInspections: number;
  totalRevenue: number;
  avgOrderValue: number;
  months: { ym: string; count: number; revenue: number }[];
  topAgents: { agentName: string; count: number; revenue: number }[];
  heatmap: { section: string; satisfactory: number; monitor: number; defect: number }[];
}

export async function loader({ request }: Route.LoaderArgs) {
  const token = await requireToken(request);
  try {
    const res = await apiFetch("/api/metrics?period=6m", { token });
    const json = res.ok ? await res.json() : {};
    return { data: ((json as any)?.data || null) as MetricsData | null };
  } catch {
    return { data: null };
  }
}

const PERIODS = ["3m", "6m", "12m"] as const;

function fmt(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0 }).format(n);
}

export default function MetricsPage() {
  const { data } = useLoaderData<typeof loader>();
  const [period, setPeriod] = useState<string>("6m");

  const kpis = [
    { label: "Total Revenue", value: data ? fmt(data.totalRevenue) : "—" },
    { label: "Total Inspections", value: data ? String(data.totalInspections) : "—" },
    { label: "Avg Order Value", value: data ? fmt(data.avgOrderValue) : "—" },
  ];

  return (
    <div className="space-y-[18px]">
      <PageHeader
        eyebrow="METRICS"
        eyebrowColor="slate"
        title="Metrics"
        meta={data ? `${data.totalInspections} inspections` : "Loading..."}
        actions={
          <div className="flex gap-1 bg-slate-100 dark:bg-slate-700 rounded-md p-1">
            {PERIODS.map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`h-6 px-3 rounded text-[12px] font-bold transition-all ${
                  period === p
                    ? "bg-white dark:bg-slate-600 shadow-sm text-slate-900 dark:text-white"
                    : "text-slate-400 dark:text-slate-500"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        }
      />

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">{kpi.label}</p>
            <p className="text-xl font-bold text-slate-900 dark:text-white">{kpi.value}</p>
          </div>
        ))}
      </div>

      {/* Inspections per month chart placeholder */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5">
        <p className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-4">Inspections per Month</p>
        {data && data.months.length > 0 ? (
          <div className="flex items-end gap-2 h-40">
            {data.months.map((m) => {
              const max = Math.max(...data.months.map((x) => x.count), 1);
              const pct = (m.count / max) * 100;
              return (
                <div key={m.ym} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[10px] font-bold text-slate-500">{m.count}</span>
                  <div
                    className="w-full bg-indigo-500 dark:bg-indigo-400 rounded-t"
                    style={{ height: `${Math.max(pct, 4)}%` }}
                  />
                  <span className="text-[10px] text-slate-400">{m.ym.slice(5)}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-[13px] text-slate-500 text-center py-8">No data available for this period.</p>
        )}
      </div>

      {/* Findings heatmap */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5">
        <p className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-4">Findings Heatmap</p>
        {data && data.heatmap.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr>
                  <th className="py-2 px-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">Section</th>
                  <th className="py-2 px-3 text-[10px] font-bold uppercase tracking-widest text-emerald-600 text-center">Satisfactory</th>
                  <th className="py-2 px-3 text-[10px] font-bold uppercase tracking-widest text-amber-600 text-center">Monitor</th>
                  <th className="py-2 px-3 text-[10px] font-bold uppercase tracking-widest text-rose-600 text-center">Defect</th>
                </tr>
              </thead>
              <tbody>
                {data.heatmap.map((row) => (
                  <tr key={row.section} className="border-t border-slate-100 dark:border-slate-700">
                    <td className="py-2 px-3 text-[13px] font-medium text-slate-700 dark:text-slate-200">{row.section}</td>
                    <td className="py-2 px-3 text-[13px] text-center text-emerald-700 dark:text-emerald-400">{row.satisfactory}</td>
                    <td className="py-2 px-3 text-[13px] text-center text-amber-700 dark:text-amber-400">{row.monitor}</td>
                    <td className="py-2 px-3 text-[13px] text-center text-rose-700 dark:text-rose-400">{row.defect}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-[13px] text-slate-500 text-center py-8">No findings data yet.</p>
        )}
      </div>

      {/* Top agents */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5">
        <p className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-3">Top Referring Agents</p>
        {data && data.topAgents.length > 0 ? (
          <div className="space-y-2">
            {data.topAgents.slice(0, 5).map((agent, i) => (
              <div key={i} className="flex items-center justify-between text-[13px]">
                <span className="font-medium text-slate-700 dark:text-slate-200">{agent.agentName}</span>
                <div className="text-right">
                  <span className="font-bold text-slate-900 dark:text-white">{agent.count} insp</span>
                  <span className="text-slate-400 ml-2 text-[12px]">{fmt(agent.revenue)}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[13px] text-slate-500">No agent data yet.</p>
        )}
      </div>
    </div>
  );
}
