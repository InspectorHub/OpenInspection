import { useState } from "react";
import { useLoaderData, useNavigate } from "react-router";
import type { Route } from "./+types/metrics";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { PageHeader, Card, Table } from "@core/shared-ui";
import { formatDollars } from "~/lib/money";
import { useDisplayLocale, useDisplayCurrency } from "~/hooks/useSessionContext";
import { m } from "~/paraglide/messages";

export function meta() {
  return [{ title: m.metrics_meta_title() }];
}

interface MetricsData {
  totalInspections: number;
  totalRevenue: number;
  avgOrderValue: number;
  // Field names mirror the server's response exactly (server/api/metrics.ts):
  // the monthly series is `monthly[]` with `{ month, count, revenue }`.
  monthly: { month: string; count: number; revenue: number }[];
  topAgents: { agentName: string; count: number; revenue: number }[];
  byInspector: { inspectorId: string | null; inspectorName: string; count: number; revenue: number; avgTurnaroundDays: number | null }[];
  // IA-82 — the endpoint has always computed and returned this; nothing rendered
  // it, so the aggregation ran for no reader.
  serviceBreakdown: { serviceName: string; count: number; revenue: number }[];
}

/** Mirrors `FindingsMatrix` from server/lib/analytics.ts. */
interface FindingsData {
  columns: { key: string; label: string; color: string }[];
  rows: { section: string; counts: Record<string, number>; total: number }[];
  total: number;
}

type FindingsRow = FindingsData["rows"][number];

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = await requireToken(context, request);
  const url = new URL(request.url);
  const periodParam = url.searchParams.get("period") ?? "6m";
  const period = (["3m", "6m", "12m"].includes(periodParam) ? periodParam : "6m") as "3m" | "6m" | "12m";
  const api = createApi(context, { token });

  let data: MetricsData | null = null;
  try {
    const res = await api.metrics.index.$get({ query: { period } });
    const body = res.ok ? ((await res.json()) as Record<string, unknown>) : {};
    const d = (body.data ?? {}) as Record<string, unknown>;
    data = (Object.keys(d).length > 0 ? d : null) as MetricsData | null;
  } catch {
    data = null;
  }

  // IA-82 — the findings matrix is a second aggregation with its own endpoint.
  // It is fetched separately (and fails alone) so a slow or erroring findings
  // read cannot blank the revenue KPIs, which are the page's primary content.
  let findings: FindingsData | null = null;
  try {
    const res = await api.analytics["findings-heatmap"].$get({ query: { period } });
    if (res.ok) {
      const body = (await res.json()) as { data?: FindingsData };
      findings = body.data ?? null;
    }
  } catch {
    findings = null;
  }

  return { data, findings, period };
}

const PERIODS = ["3m", "6m", "12m"] as const;

export default function MetricsPage() {
  const { data, findings, period: initialPeriod } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const locale = useDisplayLocale();
  const currency = useDisplayCurrency();
  const [period, setPeriod] = useState<string>(initialPeriod || "6m");

  // Every revenue figure from /api/metrics is integer CENTS, and formatDollars
  // takes integer cents — so it is passed straight through.
  //
  // This used to multiply by 100, on the stated belief that the values were
  // whole dollars. They never were: the underlying column is `price_cents`, and
  // the money-naming rule in CLAUDE.md is that `_cents` means cents. The error
  // was invisible for as long as it was, because the endpoint summed
  // `inspections.price` — a cache that reads 0 on real data — so every figure on
  // this page was $0 and 100 × 0 is still 0. Fixing the source (IA-132) is what
  // finally made a wrong scale show up, as $83,000 for two jobs worth $830.
  const fmt = (n: number) => formatDollars(n, { locale, currency });

  const changePeriod = (p: string) => {
    setPeriod(p);
    navigate(`/metrics?period=${p}`, { replace: true });
  };

  const kpis = [
    { label: m.metrics_kpi_revenue(), value: data ? fmt(data.totalRevenue) : "—" },
    { label: m.metrics_kpi_inspections(), value: data ? String(data.totalInspections) : "—" },
    { label: m.metrics_kpi_aov(), value: data ? fmt(data.avgOrderValue) : "—" },
  ];

  return (
    <div className="space-y-ih-list">
      <PageHeader
        title={m.metrics_heading()}
        meta={data ? m.metrics_meta({ count: data.totalInspections }) : m.metrics_loading()}
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
        <p className="text-sm font-bold text-ih-fg-1 mb-4">{m.metrics_chart_inspections()}</p>
        {data && data.monthly?.length > 0 ? (
          <div className="flex items-end gap-2 h-40">
            {data.monthly.map((mo) => {
              const max = Math.max(...data.monthly.map((x) => x.count), 1);
              const pct = (mo.count / max) * 100;
              return (
                <div key={mo.month} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[10px] font-bold text-ih-fg-3">{mo.count}</span>
                  <div
                    className="w-full bg-ih-primary rounded-t"
                    style={{ height: `${Math.max(pct, 4)}%` }}
                  />
                  <span className="text-[10px] text-ih-fg-4">{mo.month.slice(5)}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-[13px] text-ih-fg-3 text-center py-8">{m.metrics_no_data()}</p>
        )}
      </Card>

      {/* Revenue per month bar chart */}
      <Card className="p-5">
        <p className="text-sm font-bold text-ih-fg-1 mb-4">{m.metrics_chart_revenue()}</p>
        {data && data.monthly?.length > 0 ? (
          <div className="flex items-end gap-2 h-40">
            {data.monthly.map((mo) => {
              const maxRev = Math.max(...data.monthly.map((x) => x.revenue), 1);
              const pct = (mo.revenue / maxRev) * 100;
              return (
                <div key={mo.month + "-rev"} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[10px] font-bold text-ih-fg-3">{fmt(mo.revenue)}</span>
                  <div
                    className="w-full bg-ih-ok rounded-t"
                    style={{ height: `${Math.max(pct, 4)}%` }}
                  />
                  <span className="text-[10px] text-ih-fg-4">{mo.month.slice(5)}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-[13px] text-ih-fg-3 text-center py-8">{m.metrics_no_revenue()}</p>
        )}
      </Card>

      {/* By inspector — team productivity: count, revenue, turnaround */}
      <Card className="p-5">
        <p className="text-sm font-bold text-ih-fg-1 mb-4">{m.metrics_by_inspector()}</p>
        {data && data.byInspector?.length > 0 ? (
          <div className="overflow-x-auto">
            <Table<MetricsData["byInspector"][number]>
              rows={data.byInspector}
              getRowKey={(row) => row.inspectorId ?? row.inspectorName}
              columns={[
                { label: m.metrics_col_inspector(), cell: (row) => <span className="font-medium text-ih-fg-1">{row.inspectorName}</span> },
                { label: m.metrics_col_inspections(), align: "center", cell: (row) => <span className="text-ih-fg-2">{row.count}</span> },
                { label: m.metrics_col_revenue(), align: "right", cell: (row) => <span className="text-ih-fg-2">{fmt(row.revenue)}</span> },
                { label: m.metrics_col_turnaround(), align: "right", cell: (row) => (
                  <span className="text-ih-fg-2">{row.avgTurnaroundDays == null ? m.metrics_turnaround_na() : m.metrics_turnaround_days({ days: row.avgTurnaroundDays })}</span>
                ) },
              ]}
            />
          </div>
        ) : (
          <p className="text-[13px] text-ih-fg-3 text-center py-8">{m.metrics_no_inspectors()}</p>
        )}
      </Card>

      {/* Findings by section — the tenant's own rating levels as columns.
          Not Inspected / Not Present are excluded server-side: they record the
          absence of a condition, so counting them would let a mostly-unbuilt
          section outrank one full of real defects. */}
      <Card className="p-5">
        <p className="text-sm font-bold text-ih-fg-1 mb-4">{m.metrics_findings_title()}</p>
        {findings && findings.rows.length > 0 && findings.columns.length > 0 ? (
          <div className="overflow-x-auto">
            <Table<FindingsRow>
              rows={findings.rows}
              getRowKey={(row) => row.section}
              columns={[
                { label: m.metrics_col_section(), cell: (row) => <span className="font-medium text-ih-fg-1">{row.section}</span> },
                ...findings.columns.map((col) => ({
                  label: (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: col.color }} />
                      {col.label}
                    </span>
                  ),
                  align: "center" as const,
                  cell: (row: FindingsRow) => (
                    <span className={row.counts[col.key] ? "text-ih-fg-2" : "text-ih-fg-4"}>
                      {row.counts[col.key] ?? "—"}
                    </span>
                  ),
                })),
                { label: m.metrics_col_total(), align: "right", cell: (row) => <span className="font-bold text-ih-fg-1">{row.total}</span> },
              ]}
            />
          </div>
        ) : (
          <p className="text-[13px] text-ih-fg-3 text-center py-8">{m.metrics_no_findings()}</p>
        )}
      </Card>

      {/* Service mix */}
      <Card className="p-5">
        <p className="text-sm font-bold text-ih-fg-1 mb-4">{m.metrics_services_title()}</p>
        {data && data.serviceBreakdown?.length > 0 ? (
          <div className="overflow-x-auto">
            <Table<MetricsData["serviceBreakdown"][number]>
              rows={data.serviceBreakdown}
              getRowKey={(row) => row.serviceName}
              columns={[
                { label: m.metrics_col_service(), cell: (row) => <span className="font-medium text-ih-fg-1">{row.serviceName}</span> },
                { label: m.metrics_col_inspections(), align: "center", cell: (row) => <span className="text-ih-fg-2">{row.count}</span> },
                { label: m.metrics_col_revenue(), align: "right", cell: (row) => <span className="text-ih-fg-2">{fmt(row.revenue)}</span> },
              ]}
            />
          </div>
        ) : (
          <p className="text-[13px] text-ih-fg-3 text-center py-8">{m.metrics_no_services()}</p>
        )}
      </Card>

      {/* Top agents */}
      <Card className="p-5">
        <p className="text-sm font-bold text-ih-fg-1 mb-3">{m.metrics_top_agents()}</p>
        {data && data.topAgents?.length > 0 ? (
          <div className="space-y-2">
            {data.topAgents.slice(0, 5).map((agent, i) => (
              <div key={i} className="flex items-center justify-between text-[13px]">
                <span className="font-medium text-ih-fg-1">{agent.agentName}</span>
                <div className="text-right">
                  <span className="font-bold text-ih-fg-1">{m.metrics_agent_count({ count: agent.count })}</span>
                  <span className="text-ih-fg-4 ml-2 text-[12px]">{fmt(agent.revenue)}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[13px] text-ih-fg-3">{m.metrics_no_agents()}</p>
        )}
      </Card>
    </div>
  );
}
