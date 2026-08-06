import { useLoaderData, useNavigate } from "react-router";
import type { Route } from "./+types/metrics";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { PageHeader, Card, Table } from "@core/shared-ui";
import { formatDollars } from "~/lib/money";
import { useDisplayLocale, useDisplayCurrency, useDisplayTimeZone } from "~/hooks/useSessionContext";
import { DateRangePicker } from "~/components/metrics/DateRangePicker";
import { FindingsBySection, type FindingsData } from "~/components/metrics/FindingsBySection";
import { civilToday, normaliseRange, type MetricsRange } from "~/lib/metrics-range";
import { m } from "~/paraglide/messages";

export function meta() {
  return [{ title: m.metrics_meta_title() }];
}

interface MetricsData {
  totalInspections: number;
  // Null, not zero, for a reader without the `financial` capability: zero would
  // be a claim about the business. `scope: 'self'` says why they are null.
  totalRevenue: number | null;
  avgOrderValue: number | null;
  scope: "all" | "self";
  // Field names mirror the server's response exactly (server/api/metrics.ts):
  // the monthly series is `monthly[]` with `{ month, count, revenue }`.
  monthly: { month: string; count: number; revenue: number }[];
  topAgents: { agentName: string; kind: "contact" | "source"; count: number; revenue: number }[];
  // Two money columns with two labels. `payCents` is what the inspector earns;
  // `attributedRevenueCents` is what the business billed for the lines they
  // worked. Never merged into one column called "revenue" — they differ by
  // margin and the difference is the business. Never called "cost": unlike the
  // competitor's equivalent report, an inspector reads this page.
  byInspector: {
    inspectorId: string;
    inspectorName: string;
    ledCount: number;
    assistedCount: number;
    payCents: number;
    attributedRevenueCents: number | null;
    medianTurnaroundDays: number | null;
    turnaroundBasis: "field_complete_to_report_published" | "no_data";
  }[];
  // IA-82 — the endpoint has always computed and returned this; nothing rendered
  // it, so the aggregation ran for no reader.
  serviceBreakdown: { serviceName: string; count: number; revenue: number }[];
}



export async function loader({ request, context }: Route.LoaderArgs) {
  const token = await requireToken(context, request);
  const url = new URL(request.url);
  // The window is whatever the URL says, resolved rather than validated: a
  // hand-edited or stale query string must still render a page. The server
  // resolves independently — this is a public endpoint, not only our caller.
  const range = normaliseRange(
    url.searchParams.get("from"),
    url.searchParams.get("to"),
    civilToday("UTC"),
  );
  const query = { from: range.from, to: range.to };
  const api = createApi(context, { token });

  let data: MetricsData | null = null;
  try {
    const res = await api.metrics.index.$get({ query });
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
    const res = await api.analytics["findings-heatmap"].$get({ query });
    if (res.ok) {
      const body = (await res.json()) as { data?: FindingsData };
      findings = body.data ?? null;
    }
  } catch {
    findings = null;
  }

  return { data, findings, range };
}

export default function MetricsPage() {
  const { data, findings, range } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const locale = useDisplayLocale();
  const currency = useDisplayCurrency();
  const timeZone = useDisplayTimeZone();
  // Presets resolve against the VIEWER's calendar day. The loader runs on the
  // edge and has no viewer zone, so it defaults on the UTC day; the moment the
  // page hydrates, "last 7 days" means seven days on the reader's own calendar.
  const today = civilToday(timeZone);

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

  const changeRange = (next: MetricsRange) => {
    navigate(`/metrics?from=${next.from}&to=${next.to}`, { replace: true });
  };

  /** Null money is "not yours to see", and renders as a dash, never as $0. */
  const fmtOrDash = (n: number | null | undefined) => (n == null ? "—" : fmt(n));

  const kpis = [
    { label: m.metrics_kpi_revenue(), value: fmtOrDash(data?.totalRevenue) },
    { label: m.metrics_kpi_inspections(), value: data ? String(data.totalInspections) : "—" },
    { label: m.metrics_kpi_aov(), value: fmtOrDash(data?.avgOrderValue) },
  ];

  // A reader without the `financial` capability gets their own row and nothing
  // else. Rendering the company cards as a wall of dashes would be worse than
  // not rendering them: it advertises figures they cannot have.
  const companyView = data?.scope !== "self";

  return (
    <div className="space-y-ih-list">
      <PageHeader
        title={m.metrics_heading()}
        meta={data ? m.metrics_meta({ count: data.totalInspections }) : m.metrics_loading()}
        actions={
          <DateRangePicker range={range} today={today} locale={locale} onChange={changeRange} />
        }
      />

      {/* KPI cards */}
      {companyView ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {kpis.map((kpi) => (
            <Card key={kpi.label} className="p-5">
              <p className="text-[10px] font-bold text-ih-fg-4 uppercase tracking-widest mb-1">{kpi.label}</p>
              <p className="text-xl font-bold text-ih-fg-1">{kpi.value}</p>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="p-5">
          <p className="text-[13px] text-ih-fg-2">{m.metrics_self_scope_notice()}</p>
        </Card>
      )}

      {/* Inspections per month chart placeholder */}
      {companyView && (
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
      )}

      {/* Revenue per month bar chart */}
      {companyView && (
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
      )}

      {/* Per inspector. Two money columns, two labels: Pay is the worker's,
          Attributed revenue is the company's. The turnaround basis is stated
          under the title rather than hidden in a tooltip — a duration with an
          unstated start is not a measurement. */}
      <Card className="p-5">
        <p className="text-sm font-bold text-ih-fg-1">{m.metrics_by_inspector()}</p>
        <p className="text-[12px] text-ih-fg-4 mb-4">
          {data?.byInspector?.some((r) => r.turnaroundBasis !== "no_data")
            ? m.metrics_turnaround_basis()
            : m.metrics_turnaround_no_basis()}
        </p>
        {data && data.byInspector?.length > 0 ? (
          <div className="overflow-x-auto">
            <Table<MetricsData["byInspector"][number]>
              rows={data.byInspector}
              getRowKey={(row) => row.inspectorId}
              columns={[
                { label: m.metrics_col_inspector(), cell: (row) => <span className="font-medium text-ih-fg-1">{row.inspectorName}</span> },
                { label: m.metrics_col_led(), align: "center", cell: (row) => <span className="text-ih-fg-2">{row.ledCount}</span> },
                { label: m.metrics_col_assisted(), align: "center", cell: (row) => <span className="text-ih-fg-2">{row.assistedCount}</span> },
                { label: m.metrics_col_pay(), align: "right", cell: (row) => <span className="text-ih-fg-2">{fmt(row.payCents)}</span> },
                { label: m.metrics_col_attributed_revenue(), align: "right", cell: (row) => <span className="text-ih-fg-2">{fmtOrDash(row.attributedRevenueCents)}</span> },
                { label: m.metrics_col_turnaround(), align: "right", cell: (row) => (
                  <span className="text-ih-fg-2">{row.medianTurnaroundDays == null ? m.metrics_turnaround_na() : m.metrics_turnaround_days({ days: row.medianTurnaroundDays })}</span>
                ) },
              ]}
            />
          </div>
        ) : (
          <p className="text-[13px] text-ih-fg-3 text-center py-8">{m.metrics_no_inspectors()}</p>
        )}
      </Card>

      <FindingsBySection findings={findings} />

      {/* Service mix */}
      {companyView && (
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
      )}

      {/* Referrers. Contact-keyed rows come first and free-text sources follow,
          tagged — they are different kinds of answer and merging them into one
          list without saying which is which invents precision. */}
      {companyView && (
      <Card className="p-5">
        <p className="text-sm font-bold text-ih-fg-1 mb-3">{m.metrics_top_agents()}</p>
        {data && data.topAgents?.length > 0 ? (
          <div className="space-y-2">
            {data.topAgents.slice(0, 8).map((agent, i) => (
              <div key={i} className="flex items-center justify-between text-[13px]">
                <span className="font-medium text-ih-fg-1">
                  {agent.agentName}
                  {agent.kind === "source" && (
                    <span className="ml-2 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4">
                      {m.metrics_referrer_source_tag()}
                    </span>
                  )}
                </span>
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
      )}
    </div>
  );
}
