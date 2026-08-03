// @vitest-environment happy-dom
/**
 * The /metrics page reads the server's aggregation response. The monthly
 * series is the server's source of truth: the endpoint returns
 * `data.monthly[]` with `{ month, count, revenue }`. The page must read that
 * exact shape — an earlier field-name drift (`data.months[].ym`) left both
 * month charts rendering their empty state even when the server returned real
 * data.
 *
 * Pattern: render via createRoutesStub (mirrors
 * app/routes/agent/dashboard.test.tsx) with a loader returning the server's
 * response shape.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { createRoutesStub } from "react-router";

import MetricsPage from "~/routes/metrics";

const SERVER_MONTHLY = [
  { month: "2026-04", count: 3, revenue: 1500 },
  { month: "2026-05", count: 7, revenue: 4200 },
];

function renderMetrics(
  data: Record<string, unknown> | null,
  findings: Record<string, unknown> | null = null,
) {
  const Stub = createRoutesStub([
    {
      path: "/metrics",
      Component: MetricsPage,
      loader: () => ({ data, findings, range: { from: "2026-04-29", to: "2026-07-29" } }),
    },
  ]);
  return render(<Stub initialEntries={["/metrics"]} />);
}

describe("MetricsPage money scale", () => {
  it("renders the server's CENTS as dollars, not 100x them", async () => {
    // The endpoint sums `_cents` columns, so 83_000 is $830.00. The page used to
    // multiply by 100 before formatting, on the belief that these were whole
    // dollars — $83,000 for two jobs worth $830. It went unnoticed because the
    // endpoint summed a cache column that reads 0 on real data, and 100 × 0 is
    // still 0; only fixing the source (IA-132) made the scale visible.
    const { findByText, queryByText } = renderMetrics({
      totalInspections: 2,
      totalRevenue: 83_000,
      avgOrderValue: 41_500,
      monthly: [],
      topAgents: [],
      byInspector: [],
    });

    expect(await findByText("$830")).toBeTruthy();
    expect(await findByText("$415")).toBeTruthy();
    expect(queryByText("$83,000")).toBeNull();
    expect(queryByText("$41,500")).toBeNull();
  });
});

describe("MetricsPage monthly charts", () => {
  it("renders the monthly bars from the server's `monthly` series", async () => {
    const { findByText, findAllByText, queryByText } = renderMetrics({
      totalInspections: 10,
      totalRevenue: 5700,
      avgOrderValue: 570,
      monthly: SERVER_MONTHLY,
      topAgents: [],
      byInspector: [],
    });

    // Each month's count is rendered above its bar — proves the series is read.
    await findByText("3");
    await findByText("7");
    // The month label is the `YYYY-MM` sliced to `MM` — proves `month` (not
    // the old `ym`) is the field being read. It appears in both month charts.
    expect((await findAllByText("04")).length).toBeGreaterThan(0);
    expect((await findAllByText("05")).length).toBeGreaterThan(0);
    // The empty-state copy must NOT appear when the series has data.
    expect(queryByText(/No data in this date range/i)).toBeNull();
  });

  it("shows the empty state when the monthly series is absent", async () => {
    const { findAllByText } = renderMetrics({
      totalInspections: 0,
      totalRevenue: 0,
      avgOrderValue: 0,
      monthly: [],
      topAgents: [],
      byInspector: [],
    });
    // Both month cards fall back to their empty copy.
    const empties = await findAllByText(/in this date range/i);
    expect(empties.length).toBeGreaterThan(0);
  });
});

/**
 * IA-82 — two server aggregations reached the page and rendered nothing.
 *
 * `serviceBreakdown` was computed by `/api/metrics` on every request and did not
 * appear in the page's own response interface, let alone its markup. The
 * findings matrix had a whole endpoint (`GET /api/analytics/findings-heatmap`)
 * with no caller anywhere in the app. A fully-specified route with no reader is
 * indistinguishable from a feature until someone checks.
 */
describe("MetricsPage findings matrix", () => {
  const FINDINGS = {
    systems: [
      {
        systemId: "rs-default",
        systemName: "OpenInspection Default",
        columns: [
          { key: "satisfactory", label: "Satisfactory", color: "#10b981" },
          { key: "monitor", label: "Monitor", color: "#f59e0b" },
          { key: "defect", label: "Defect", color: "#ef4444" },
        ],
        rows: [
          { section: "Roof", counts: { satisfactory: 4, defect: 2 }, total: 6 },
          { section: "Electrical", counts: { monitor: 1 }, total: 1 },
        ],
        total: 7,
      },
    ],
    total: 7,
  };

  it("renders a column per rating level and a row per section", async () => {
    const { findByText, queryByText } = renderMetrics(
      { totalInspections: 2, totalRevenue: 0, avgOrderValue: 0, monthly: [], topAgents: [], byInspector: [] },
      FINDINGS,
    );

    // Column headers come from the tenant's own levels, not a hardcoded scale.
    await findByText("Satisfactory");
    await findByText("Monitor");
    await findByText("Defect");
    // Section rows.
    await findByText("Roof");
    await findByText("Electrical");
    expect(queryByText(/No rated findings in this date range/i)).toBeNull();
  });

  it("falls back to the empty state when the findings fetch failed", async () => {
    // The loader returns null for findings when its endpoint errors — the page
    // must still render (the KPIs are the primary content), just without a matrix.
    const { findByText } = renderMetrics(
      { totalInspections: 2, totalRevenue: 0, avgOrderValue: 0, monthly: [], topAgents: [], byInspector: [] },
      null,
    );
    await findByText(/No rated findings in this date range/i);
  });
});

describe("MetricsPage service mix", () => {
  it("renders the serviceBreakdown the endpoint has always returned", async () => {
    const { findByText, queryByText } = renderMetrics({
      totalInspections: 3,
      totalRevenue: 90_000,
      avgOrderValue: 30_000,
      monthly: [],
      topAgents: [],
      byInspector: [],
      serviceBreakdown: [
        { serviceName: "Radon Test", count: 2, revenue: 25_000 },
        { serviceName: "Sewer Scope", count: 1, revenue: 65_000 },
      ],
    });

    await findByText("Radon Test");
    await findByText("Sewer Scope");
    // Revenue is integer cents, same as every other figure on this page.
    await findByText("$250");
    await findByText("$650");
    expect(queryByText(/No service data yet/i)).toBeNull();
  });

  it("shows the empty state when no services are attached", async () => {
    const { findByText } = renderMetrics({
      totalInspections: 0,
      totalRevenue: 0,
      avgOrderValue: 0,
      monthly: [],
      topAgents: [],
      byInspector: [],
      serviceBreakdown: [],
    });
    await findByText(/No service data yet/i);
  });
});
