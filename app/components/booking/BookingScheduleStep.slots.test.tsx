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

function Harness() {
  const [timeWindow, setTimeWindow] = useState("morning");
  return (
    <ScheduleStep
      inspectionDate="2099-01-05" setInspectionDate={() => {}} timeWindow={timeWindow} setTimeWindow={setTimeWindow}
      customTime="" setCustomTime={() => {}} showInspectorDropdown={false} chosenInspectorId={null} setChosenInspectorId={() => {}}
      inspectorOptions={[]} clientName="" setClientName={() => {}} clientEmail="" setClientEmail={() => {}} smsOptin={false}
      setSmsOptin={() => {}} locale={null} setLocale={() => {}} privacyUrl={null} termsUrl={null} companyName="Acme" tenant="acme"
      serviceIds={["svc-1"]}
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
