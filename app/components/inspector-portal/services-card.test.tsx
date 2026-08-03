// @vitest-environment happy-dom
/**
 * IA-87 — the Services card used to be a dead end: it displayed what was sold
 * and offered nothing, so an inspection created without services showed "No
 * services have been added" beside no way to add one.
 *
 * These assert the two things the card must never regress on: it offers the
 * money verbs only to the roles the API accepts them from, and its picker never
 * offers a service the inspection already carries (which would read as a way to
 * bill the same line twice).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ServicesCard, type ServiceLine, type CatalogService } from "./ServicesCard";

vi.mock("react-router", () => ({
  useFetcher: () => ({ state: "idle", data: undefined, submit: vi.fn(), Form: "form" }),
}));

afterEach(cleanup);

const LINES: ServiceLine[] = [
  { id: "l1", serviceId: "s1", name: "Radon test", priceCents: 15000, priceSnapshot: 15000, priceOverride: null },
  { id: "l2", serviceId: "s2", name: "Sewer scope", priceCents: 9900, priceSnapshot: 12000, priceOverride: 9900 },
];

const CATALOG: CatalogService[] = [
  { id: "s1", name: "Radon test", price: 15000 },
  { id: "s2", name: "Sewer scope", price: 12000 },
  { id: "s3", name: "Pool inspection", price: 20000 },
];

describe("ServicesCard", () => {
  it("totals the effective line prices, not the catalog ones", () => {
    render(<ServicesCard services={LINES} catalog={CATALOG} canManage />);
    // 15000 + 9900 (the override), not 15000 + 12000.
    expect(screen.getByText("$249.00")).toBeTruthy();
    expect(screen.queryByText("$270.00")).toBeNull();
  });

  it("offers the money verbs to an owner or manager", () => {
    render(<ServicesCard services={LINES} catalog={CATALOG} canManage />);
    expect(screen.getByRole("button", { name: "Add service" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Edit price" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Remove" })).toHaveLength(2);
  });

  it("shows an inspector the lines but none of the money verbs", () => {
    render(<ServicesCard services={LINES} catalog={CATALOG} canManage={false} />);
    expect(screen.getByText("Radon test")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add service" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit price" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
  });

  it("keeps already-booked services out of the add picker", () => {
    render(<ServicesCard services={LINES} catalog={CATALOG} canManage />);
    fireEvent.click(screen.getByRole("button", { name: "Add service" }));

    const select = screen.getByTestId("hub-add-service-select") as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value).filter(Boolean);
    expect(values).toEqual(["s3"]);
  });

  it("says so when the catalog has nothing left to offer", () => {
    render(<ServicesCard services={LINES} catalog={CATALOG.slice(0, 2)} canManage />);
    fireEvent.click(screen.getByRole("button", { name: "Add service" }));

    expect(screen.getByText(/already on this inspection/i)).toBeTruthy();
  });

  it("points at the catalog when the tenant has no services at all", () => {
    render(<ServicesCard services={[]} catalog={[]} canManage />);
    fireEvent.click(screen.getByRole("button", { name: "Add service" }));

    expect(screen.getByText(/service catalog is empty/i)).toBeTruthy();
  });

  it("shows the lines but no figures when money is redacted (IA-95)", () => {
    // The server omits the price fields for a caller without `financial`.
    // Absence is the signal — the card must not re-derive the permission.
    const redacted: ServiceLine[] = LINES.map(({ id, serviceId, name }) => ({ id, serviceId, name }));
    render(<ServicesCard services={redacted} catalog={CATALOG} canManage />);

    // What was sold is still theirs to see...
    expect(screen.getByText("Radon test")).toBeTruthy();
    expect(screen.getByText("Sewer scope")).toBeTruthy();
    // ...what it cost is not, and no total is invented.
    expect(screen.queryByText(/\$/)).toBeNull();
    expect(screen.queryByText("Total")).toBeNull();
    // Repricing something you cannot see the price of makes no sense.
    expect(screen.queryByRole("button", { name: "Edit price" })).toBeNull();
    // Removing a line is not a money read, so it survives.
    expect(screen.getAllByRole("button", { name: "Remove" })).toHaveLength(2);
  });

  it("still offers a way in when the inspection has no services yet", () => {
    // The whole of IA-87: this state used to be a sentence and nothing else.
    render(<ServicesCard services={[]} catalog={CATALOG} canManage />);
    expect(screen.getByRole("button", { name: "Add service" })).toBeTruthy();
  });
});
