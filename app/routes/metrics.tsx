import { useState } from "react";
import { useLoaderData, useNavigate } from "react-router";
import type { Route } from "./+types/metrics";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { PageHeader, Card } from "@core/shared-ui";

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

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = await requireToken(context, request);
  const url = new URL(request.url);
  const periodParam = url.searchParams.get("period") ?? "6m";
  const period = (["3m", "6m", "12m"].includes(periodParam) ? periodParam : "6m") as "3m" | "6m" | "12m";
  try {
    const api = createApi(context, { token });
    const res = await api.metrics.index.$get({ query: { period } });
    const body = res.ok ? ((await res.json()) as Record<string, unknown>) : {};
    const d = (body.data ?? {}) as Record<string, unknown>;
    return { data: (Object.keys(d).length > 0 ? d : null) as MetricsData | null, period };
  } catch {
    return { data: null, period };
  }
}

const PERIODS = ["3m", "6m", "12m"] as const;

function fmt(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0 }).format(n);
}

export default function MetricsPage() {
  const { data, period: initialPeriod } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [period, setPeriod] = useState<string>(initialPeriod || "6m");

  const changePeriod = (p: string) => {
    setPeriod(p);
    navigate(`/metrics?period=${p}`, { replace: true });
  };

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
          <div className="flex gap-1 bg-ih-bg-muted rounded-md p-1">
            {PERIODS.map((p) => (
              <button
                key={p}
                onClick={() => changePeriod(p)}
                className={`h-6 px-3 rounded text-[12px] font-bold transition-all ${
                  period === p
                    ? "bg-ih-bg-card shadow-ih-card text-ih-fg-1"
                    : "text-ih-fg-4"
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
          <Card key={kpi.label} className="p-5">
            <p className="text-[10px] font-bold text-ih-fg-4 uppercase tracking-widest mb-1">{kpi.label}</p>
            <p className="text-xl font-bold text-ih-fg-1">{kpi.value}</p>
          </Card>
        ))}
      </div>

      {/* Inspections per month chart placeholder */}
      <Card className="p-5">
        <p className="text-sm font-bold text-ih-fg-1 mb-4">Inspections per Month</p>
        {data && data.months?.length > 0 ? (
          <div className="flex items-end gap-2 h-40">
            {data.months.map((m) => {
              const max = Math.max(...data.months.map((x) => x.count), 1);
              const pct = (m.count / max) * 100;
              return (
                <div key={m.ym} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[10px] font-bold text-ih-fg-3">{m.count}</span>
                  <div
                    className="w-full bg-ih-primary rounded-t"
                    style={{ height: `${Math.max(pct, 4)}%` }}
                  />
                  <span className="text-[10px] text-ih-fg-4">{m.ym.slice(5)}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-[13px] text-ih-fg-3 text-center py-8">No data available for this period.</p>
        )}
      </Card>

      {/* Revenue per month bar chart */}
      <Card className="p-5">
        <p className="text-sm font-bold text-ih-fg-1 mb-4">Revenue per Month</p>
        {data && data.months?.length > 0 ? (
          <div className="flex items-end gap-2 h-40">
            {data.months.map((m) => {
              const maxRev = Math.max(...data.months.map((x) => x.revenue), 1);
              const pct = (m.revenue / maxRev) * 100;
              return (
                <div key={m.ym + "-rev"} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[10px] font-bold text-ih-fg-3">{fmt(m.revenue)}</span>
                  <div
                    className="w-full bg-ih-ok rounded-t"
                    style={{ height: `${Math.max(pct, 4)}%` }}
                  />
                  <span className="text-[10px] text-ih-fg-4">{m.ym.slice(5)}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-[13px] text-ih-fg-3 text-center py-8">No revenue data available for this period.</p>
        )}
      </Card>

      {/* Findings heatmap */}
      <Card className="p-5">
        <p className="text-sm font-bold text-ih-fg-1 mb-4">Findings Heatmap</p>
        {data && data.heatmap?.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr>
                  <th className="py-2 px-3 text-[11px] uppercase tracking-wide font-bold text-ih-fg-4">Section</th>
                  <th className="py-2 px-3 text-[11px] uppercase tracking-wide font-bold text-ih-ok-fg text-center">Satisfactory</th>
                  <th className="py-2 px-3 text-[11px] uppercase tracking-wide font-bold text-ih-watch-fg text-center">Monitor</th>
                  <th className="py-2 px-3 text-[11px] uppercase tracking-wide font-bold text-ih-bad-fg text-center">Defect</th>
                </tr>
              </thead>
              <tbody>
                {data.heatmap.map((row) => (
                  <tr key={row.section} className="border-t border-ih-border">
                    <td className="py-2 px-3 text-[13px] font-medium text-ih-fg-1">{row.section}</td>
                    <td className="py-2 px-3 text-[13px] text-center text-ih-ok-fg">{row.satisfactory}</td>
                    <td className="py-2 px-3 text-[13px] text-center text-ih-watch-fg">{row.monitor}</td>
                    <td className="py-2 px-3 text-[13px] text-center text-ih-bad-fg">{row.defect}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-[13px] text-ih-fg-3 text-center py-8">No findings data yet.</p>
        )}
      </Card>

      {/* Top agents */}
      <Card className="p-5">
        <p className="text-sm font-bold text-ih-fg-1 mb-3">Top Referring Agents</p>
        {data && data.topAgents?.length > 0 ? (
          <div className="space-y-2">
            {data.topAgents.slice(0, 5).map((agent, i) => (
              <div key={i} className="flex items-center justify-between text-[13px]">
                <span className="font-medium text-ih-fg-1">{agent.agentName}</span>
                <div className="text-right">
                  <span className="font-bold text-ih-fg-1">{agent.count} insp</span>
                  <span className="text-ih-fg-4 ml-2 text-[12px]">{fmt(agent.revenue)}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[13px] text-ih-fg-3">No agent data yet.</p>
        )}
      </Card>
    </div>
  );
}
