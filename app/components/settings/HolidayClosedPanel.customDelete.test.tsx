// @vitest-environment happy-dom
/**
 * Removing a custom closed day: a refusal used to be invisible (the panel only
 * reported failures of the Advanced Save). The day stays listed and the panel says
 * the removal did not go through.
 */
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { HolidayClosedPanel, type HolidayConfig } from "./HolidayClosedPanel";

const CONFIG: HolidayConfig = { holidayRegion: "US-TX", holidayPublicPolicy: "block", holidayInternalPolicy: "advisory", conciergeReviewRequired: false };
const DAY = { id: "h1", date: "2026-07-03", name: "Company picnic" };

function mount(ok: boolean) {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () => <HolidayClosedPanel initialConfig={CONFIG} initialCustomHolidays={[DAY]} currentYear={2026} dataMaxYear={2027} />,
      action: async ({ request }) => {
        const fd = await request.formData();
        return ok ? { ok: true, intent: "holiday-custom-delete", deletedId: String(fd.get("id")) } : { ok: false, intent: "holiday-custom-delete" };
      },
    },
  ]);
  return render(<Stub initialEntries={["/"]} />);
}

const removeDay = async () => {
  const label = await screen.findByText(/Company picnic/, undefined, { timeout: 2000 });
  const row = label.closest("li") ?? label.parentElement!.parentElement!;
  fireEvent.click(Array.from(row.querySelectorAll("button")).find((b) => /remove/i.test(b.textContent ?? ""))!);
};

describe("HolidayClosedPanel custom day removal", () => {
  it("a refused removal keeps the day and says it could not be removed", async () => {
    mount(false);
    await removeDay();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/could not be removed/i);
    expect(screen.getByText(/Company picnic/)).toBeTruthy();
  });

  it("CONTROL: a removal that goes through takes the day off the list with no alert", async () => {
    mount(true);
    await removeDay();
    await waitFor(() => expect(screen.queryByText(/Company picnic/)).toBeNull());
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
