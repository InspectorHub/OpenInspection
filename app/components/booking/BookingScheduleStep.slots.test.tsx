// @vitest-environment happy-dom
/**
 * The schedule step asks the slots endpoint about the window the visitor chose,
 * not about a default: the booking is judged over that window, so a day that only
 * fits a morning visit must not read as bookable while All Day is selected.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { useState } from "react";
import { ScheduleStep } from "./BookingScheduleStep";

function Harness({ onUnbookable = () => {} }: { onUnbookable?: (v: boolean) => void }) {
  const [timeWindow, setTimeWindow] = useState("morning");
  return (
    <ScheduleStep
      inspectionDate="2099-01-05" setInspectionDate={() => {}} timeWindow={timeWindow} setTimeWindow={setTimeWindow}
      customTime="" setCustomTime={() => {}} showInspectorDropdown={false} chosenInspectorId={null} setChosenInspectorId={() => {}}
      inspectorOptions={[]} clientName="" setClientName={() => {}} clientEmail="" setClientEmail={() => {}} smsOptin={false}
      setSmsOptin={() => {}} locale={null} setLocale={() => {}} privacyUrl={null} termsUrl={null} companyName="Acme" tenant="acme"
      serviceIds={["svc-1"]} onDateBookableChange={onUnbookable}
    />
  );
}

afterEach(() => vi.restoreAllMocks());

describe("ScheduleStep slots request", () => {
  it("carries the chosen time slot and asks again when it changes", async () => {
    const urls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ data: { slots: [{ time: "08:00", available: true }] } }), { status: 200 });
    });
    const Stub = createRoutesStub([{ path: "/", Component: Harness }]);
    render(<Stub initialEntries={["/"]} />);
    await waitFor(() => expect(urls.some((u) => u.includes("/api/public/slots") && u.includes("timeSlot=morning"))).toBe(true), { timeout: 3000 });
    const allDay = (await screen.findAllByRole("radio")).find((r) => (r as HTMLInputElement).value === "all-day")!;
    fireEvent.click(allDay);
    await waitFor(() => expect(urls.some((u) => u.includes("timeSlot=all-day"))).toBe(true), { timeout: 3000 });
  });
});

/** Answer the slots list per time slot: `open` lists the windows that still have a start. */
function mockSlots(open: string[]) {
  const urls: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    const u = String(url);
    urls.push(u);
    const w = new URL(u, "http://x").searchParams.get("timeSlot") ?? "";
    return new Response(JSON.stringify({ data: { slots: [{ time: "13:00", available: open.includes(w) }] } }), { status: 200 });
  });
  return urls;
}

describe("ScheduleStep when the chosen window has no starts", () => {
  it("says which windows still have times and does not block the date", async () => {
    mockSlots(["afternoon"]);
    const seen: boolean[] = [];
    const Stub = createRoutesStub([{ path: "/", Component: () => <Harness onUnbookable={(v) => seen.push(v)} /> }]);
    render(<Stub initialEntries={["/"]} />);
    const alert = await screen.findByText(/No morning times are left on/, undefined, { timeout: 4000 });
    expect(alert.textContent).toMatch(/Try Afternoon, or pick another date\./);
    expect(alert.textContent).not.toMatch(/All Day/);
    expect(screen.queryByText(/has no times available/)).toBeNull();
    await waitFor(() => expect(seen.at(-1)).toBe(false));
    expect(seen).not.toContain(true);
  });

  it("names every window that has starts", async () => {
    mockSlots(["afternoon", "all-day"]);
    const Stub = createRoutesStub([{ path: "/", Component: () => <Harness /> }]);
    render(<Stub initialEntries={["/"]} />);
    expect((await screen.findByText(/No morning times are left on/, undefined, { timeout: 4000 })).textContent).toMatch(/Try Afternoon or All Day,/);
  });

  it("blocks the date and says the company has no times only when NO window has a start", async () => {
    mockSlots([]);
    const seen: boolean[] = [];
    const Stub = createRoutesStub([{ path: "/", Component: () => <Harness onUnbookable={(v) => seen.push(v)} /> }]);
    render(<Stub initialEntries={["/"]} />);
    await screen.findByText(/has no times available on/, undefined, { timeout: 4000 });
    expect(screen.queryByText(/times are left on/)).toBeNull();
    await waitFor(() => expect(seen.at(-1)).toBe(true));
  });

  it("asks one question when the chosen window has starts, and at most three in all", async () => {
    const some = mockSlots(["morning"]);
    const Stub = createRoutesStub([{ path: "/", Component: () => <Harness /> }]);
    const v = render(<Stub initialEntries={["/"]} />);
    await waitFor(() => expect(some.length).toBe(1), { timeout: 3000 });
    expect(screen.queryByText(/times are left on/)).toBeNull();
    v.unmount();
    vi.restoreAllMocks();
    const none = mockSlots([]);
    render(<Stub initialEntries={["/"]} />);
    await screen.findByText(/has no times available on/, undefined, { timeout: 4000 });
    expect(none.length).toBe(3);
  });
});

