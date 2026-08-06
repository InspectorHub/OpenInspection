// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { BookingRoutingPanel, type BookingRoutingConfig } from "./BookingRoutingPanel";
import { InspectorServiceAreasPanel, parseZipList } from "./InspectorServiceAreasPanel";

/**
 * The point of these panels is that they REFUSE to present a strategy as live
 * when it could not run. A snapshot of "three radios rendered" would pass
 * against the exact bug this feature exists to remove, so every assertion here
 * is about the readiness sentence, not about the controls.
 */
const base: BookingRoutingConfig = {
  routingStrategy: "closest",
  minLeadHours: 0,
  sameDayCutoffTime: null,
  companyAddress: "1 Main St, Austin, TX",
  companyLat: null,
  companyLng: null,
  geocodeAvailable: true,
  originCount: 0,
};

function mount(initial: BookingRoutingConfig, anchored = 0) {
  const Stub = createRoutesStub([
    { path: "/", Component: () => <BookingRoutingPanel initial={initial} anchoredInspectorCount={anchored} /> },
  ]);
  return render(<Stub initialEntries={["/"]} />);
}

describe("BookingRoutingPanel states the blocker before the radio is trusted", () => {
  it("says closest cannot run when nothing has been located", async () => {
    mount(base);
    expect(await screen.findByText(/cannot compare anyone/i)).toBeTruthy();
  });

  it("says closest cannot run when Places is not configured, and prefers that reason", async () => {
    mount({ ...base, geocodeAvailable: false });
    expect(await screen.findByText(/needs a Google Places key/i)).toBeTruthy();
  });

  it("says so when only ONE inspector is anchored — a comparison of one is not a comparison", async () => {
    mount({ ...base, companyLat: 30.26, companyLng: -97.74 }, 1);
    expect(await screen.findByText(/Only one inspector has a start address/i)).toBeTruthy();
  });

  it("shows no blocker once two inspectors are anchored", async () => {
    mount({ ...base, companyLat: 30.26, companyLng: -97.74 }, 2);
    expect(await screen.findByText(/located at 30\.2600, -97\.7400/i)).toBeTruthy();
    expect(screen.queryByText(/cannot compare anyone/i)).toBeNull();
    expect(screen.queryByText(/Only one inspector/i)).toBeNull();
  });

  it("first_available never carries a blocker — it always works", async () => {
    mount({ ...base, routingStrategy: "first_available" });
    expect(await screen.findByText(/Routing & booking rules/i)).toBeTruthy();
    expect(screen.queryByText(/cannot compare anyone/i)).toBeNull();
  });

  it("an unlocated company address is labelled as such, not left ambiguous", async () => {
    mount(base);
    expect(await screen.findByText(/not located yet/i)).toBeTruthy();
  });
});

describe("InspectorServiceAreasPanel", () => {
  const members = [
    { id: "u1", email: "ann@x.com", zipPrefixes: ["78701"], originAddress: null, originLocated: false },
    { id: "u2", email: "bea@x.com", zipPrefixes: [], originAddress: "500 Main", originLocated: true },
  ];

  it("states the empty-ZIP meaning rather than showing a blank box", async () => {
    const Stub = createRoutesStub([
      { path: "/", Component: () => <InspectorServiceAreasPanel members={[members[1]]} /> },
    ]);
    render(<Stub initialEntries={["/"]} />);
    expect(await screen.findByText(/serves all areas/i)).toBeTruthy();
  });

  it("says an inspector with no override starts from the company address", async () => {
    const Stub = createRoutesStub([
      { path: "/", Component: () => <InspectorServiceAreasPanel members={[members[0]]} /> },
    ]);
    render(<Stub initialEntries={["/"]} />);
    expect(await screen.findByText(/Starts from the company address/i)).toBeTruthy();
  });

  it("renders an honest empty state when the workspace has no schedulable staff", async () => {
    const Stub = createRoutesStub([
      { path: "/", Component: () => <InspectorServiceAreasPanel members={[]} /> },
    ]);
    render(<Stub initialEntries={["/"]} />);
    expect(await screen.findByText(/No inspectors yet/i)).toBeTruthy();
  });

  it("parseZipList normalizes case, whitespace and duplicates", () => {
    expect(parseZipList(" 78701, 787 ,, 78701 \n m5v ")).toEqual(["78701", "787", "M5V"]);
    expect(parseZipList("")).toEqual([]);
  });
});
