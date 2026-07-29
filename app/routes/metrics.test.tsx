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

function renderMetrics(data: Record<string, unknown> | null) {
  const Stub = createRoutesStub([
    {
      path: "/metrics",
      Component: MetricsPage,
      loader: () => ({ data, period: "6m" }),
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
    expect(queryByText(/No data available for this period/i)).toBeNull();
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
    const empties = await findAllByText(/available for this period/i);
    expect(empties.length).toBeGreaterThan(0);
  });
});
