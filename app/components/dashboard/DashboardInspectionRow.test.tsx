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
 * into the same room that skipped the till. It is gone.
 *
 * #81 — AND THE DROPDOWN NO LONGER REACHES THE WAY BACK EITHER. Leaving
 * `cancelled` was a plain status write from here, which made this hover-only
 * control the product's only recovery — while the mis-click happens on the
 * hub's Lifecycle card, a page away. `POST /:id/uncancel` is the one door now
 * (it also restores the calendar entry, which this PATCH did and the bulk door
 * did not), the API refuses this write, and the row offers a Restore control
 * instead of four options the server would reject.
 */
function statusSelect(container: HTMLElement) {
  const select = container.querySelector("select");
  if (!select) throw new Error("no status select rendered");
  return {
    disabled: select.disabled,
    options: Array.from(select.options).map((o) => ({ value: o.value, disabled: o.disabled })),
  };
}

const restoreButton = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("button")).find(
    (b) => b.textContent?.includes("Restore"),
  );

describe("DashboardInspectionRow — the status dropdown cannot cancel", () => {
  it("offers no Cancelled option on a live inspection", () => {
    const { container } = renderRow(0, "scheduled");
    expect(statusSelect(container).options.map((o) => o.value)).toEqual([
      "requested", "scheduled", "confirmed", "completed",
    ]);
  });

  it("offers no selectable status at all on a cancelled row", () => {
    // Every one of those four is a write the API now answers 400
    // USE_UNCANCEL_ENDPOINT. Offering a door the server has closed is the
    // exact failure #78 removed in the other direction.
    const select = statusSelect(renderRow(0, "cancelled").container);
    expect(select.disabled).toBe(true);
    expect(select.options.map((o) => o.value)).toEqual(["cancelled"]);
  });

  it("still says Cancelled rather than falling back to the first option", () => {
    // Without a matching option the browser renders "Requested" over a
    // cancelled inspection.
    const { container } = renderRow(0, "cancelled");
    expect(container.querySelector("select")?.value).toBe("cancelled");
  });
});

describe("DashboardInspectionRow — recovery is a control, not a status pick", () => {
  it("offers Restore on a cancelled row", () => {
    expect(restoreButton(renderRow(0, "cancelled").container)).toBeTruthy();
  });

  it("POSITIVE CONTROL — a live inspection is offered no recovery", () => {
    // Nothing to recover from, and a Restore button beside a scheduled job
    // would read as a claim that something went wrong with it.
    for (const status of ["requested", "scheduled", "confirmed", "completed"]) {
      expect(restoreButton(renderRow(0, status).container)).toBeUndefined();
    }
  });

  it("keeps the control out of the hover-only group", () => {
    // Load-bearing twice: the confirmation Modal renders INLINE, so an
    // ancestor at opacity-0 would both hide it and become the containing
    // block its `fixed inset-0` backdrop resolves against. And a hover-only
    // affordance is what made the old recovery undiscoverable.
    const { container } = renderRow(0, "cancelled");
    const button = restoreButton(container);
    expect(button?.closest(".opacity-0")).toBeNull();
  });
});
