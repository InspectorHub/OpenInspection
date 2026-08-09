// @vitest-environment happy-dom
/**
 * The price on a dashboard row is integer CENTS and must be formatted as money.
 *
 * It used to be interpolated raw — `${insp.price}` — which is a units bug that
 * hid behind a data bug for as long as both existed. The row only ever received
 * `inspections.price_cents`, the denormalized cache, and that column reads 0 on
 * real data; "$0" looks identical whether you believe it is dollars or cents.
 * Resolving the real price server-side (IA-131) is what turned a $450 job into
 * "$45000" on screen.
 *
 * So this asserts the scale, not merely that something renders.
 */
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { createRoutesStub } from "react-router";

import { DashboardInspectionRow } from "~/components/dashboard/DashboardInspectionRow";
import type { Inspection } from "~/lib/dashboard-schema";

vi.mock("~/hooks/useSessionContext", () => ({
  useDisplayLocale: () => "en-US",
  useDisplayCurrency: () => "USD",
  useDisplayTimeZone: () => "UTC",
  // #270 — the row renders an inspection date, whose SHAPE is the tenant's.
  useTenantFormatPrefs: () => ({ dateFormat: "us", timeFormat: "12h" }),
}));

const INSPECTION = {
  id: "i-1",
  propertyAddress: "742 Evergreen Terrace",
  address: "742 Evergreen Terrace",
  clientName: "Homer Simpson",
  date: "2026-07-23",
  status: "requested",
  reportStatus: null,
  price: 45_000,
  defectStats: { safety: 0, recommendation: 0, maintenance: 0 },
} as unknown as Inspection;

function renderRow(price: number | null, status = "requested") {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () => (
        <DashboardInspectionRow
          insp={{ ...INSPECTION, price, status } as Inspection}
          tenantSlug={null}
          selectedIds={new Set<string>()}
          isColumnVisible={() => true}
          toggleSelect={() => {}}
          transitionStatus={() => {}}
          timeZone="UTC"
        />
      ),
    },
  ]);
  return render(<Stub initialEntries={["/"]} />);
}

describe("DashboardInspectionRow — price scale", () => {
  it("renders 45000 cents as $450, not $45000", async () => {
    const { findByText, queryByText } = renderRow(45_000);
    expect(await findByText("$450")).toBeTruthy();
    expect(queryByText("$45000")).toBeNull();
  });

  it("keeps cents when the amount actually has them", async () => {
    const { findByText } = renderRow(45_050);
    expect(await findByText("$450.50")).toBeTruthy();
  });

  it("still renders a genuine zero", async () => {
    // A $0 job is a real state (an unpriced inspection) — the fix must not make
    // it disappear or read as unknown.
    const { findByText } = renderRow(0);
    expect(await findByText("$0")).toBeTruthy();
  });
});

/**
 * #78 — the row's status dropdown is a PATCH, and a PATCH cannot cancel.
 *
 * The fee, the refund and the recorded reason live only in
 * `POST /:id/cancel`, so "Cancelled" sitting in this list was a second door
 * into the same room that skipped the till. It is gone — but a row that IS
 * cancelled still has to say so, and still has to be recoverable, so the
 * option survives in exactly one place: disabled, on a cancelled row.
 */
function statusSelect(container: HTMLElement) {
  const select = container.querySelector("select");
  if (!select) throw new Error("no status select rendered");
  return Array.from(select.options).map((o) => ({ value: o.value, disabled: o.disabled }));
}

describe("DashboardInspectionRow — the status dropdown cannot cancel", () => {
  it("offers no Cancelled option on a live inspection", () => {
    const { container } = renderRow(0, "scheduled");
    expect(statusSelect(container).map((o) => o.value)).toEqual([
      "requested", "scheduled", "confirmed", "completed",
    ]);
  });

  it("shows Cancelled as a DISABLED option on an already-cancelled row", () => {
    // Without it the select value matches nothing and the browser renders the
    // first option — a cancelled inspection reading "Requested".
    const options = statusSelect(renderRow(0, "cancelled").container);
    expect(options.find((o) => o.value === "cancelled")).toEqual({
      value: "cancelled", disabled: true,
    });
  });

  it("leaves the recovery route open — the other four stay selectable", () => {
    // A mis-click in the cancel dialog is put right from here.
    const options = statusSelect(renderRow(0, "cancelled").container);
    expect(options.filter((o) => !o.disabled).map((o) => o.value)).toEqual([
      "requested", "scheduled", "confirmed", "completed",
    ]);
  });
});
