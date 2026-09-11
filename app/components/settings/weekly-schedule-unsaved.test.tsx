/**
 * @vitest-environment happy-dom
 *
 * F40 — the weekly-schedule panel must not present an unsaved draft as a saved
 * week.
 *
 * `/settings/schedule` opened with Monday–Friday ticked and 08:00–17:00 filled
 * in while `GET /api/availability` answered `{"data":[]}` — zero rows. Nothing
 * on the page said so, which is why an operator whose online booking was CLOSED
 * saw a schedule that looked finished and had no reason to press Save: saving is
 * the only thing that writes the five rows and flips `bookingOpen`.
 *
 * The resolution is the notice, NOT a write. Availability is a commitment to
 * whoever reads the public booking page, so it may only be published by somebody
 * deciding to publish it — a loader that persisted the default would open
 * bookings for hours the operator never agreed to.
 *
 * ⚠️ The discriminating assertion is the FIRST one. "No notice when rows exist"
 * passes with the fix reverted (there was never a notice at all), so on its own
 * it would be a test that proves nothing.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("~/hooks/useGuardedSubmit", () => ({
    useGuardedSubmit: () => ({
        submit: vi.fn(() => true),
        fetcher: { state: "idle", data: undefined },
        busy: false,
        idempotencyKey: "k",
    }),
}));

import { WeeklySchedulePanel } from "./WeeklySchedulePanel";

const SLOT = { id: 1, dayOfWeek: 1, startTime: "09:00", endTime: "16:00" };

describe("WeeklySchedulePanel — an unsaved week says so", () => {
    it("warns when NOTHING is stored, even though five days render as ticked", () => {
        render(<WeeklySchedulePanel initialSlots={[]} inspectorId={null} />);
        // The draft is still offered — the fix is honesty, not an empty form.
        expect(screen.getAllByRole("checkbox").filter((c) => (c as HTMLInputElement).checked))
            .toHaveLength(5);
        expect(screen.getByTestId("weekly-unsaved-notice")).toBeInTheDocument();
    });

    it("says nothing once the schedule is really stored", () => {
        render(<WeeklySchedulePanel initialSlots={[SLOT]} inspectorId={null} />);
        expect(screen.queryByTestId("weekly-unsaved-notice")).toBeNull();
        // Positive control: the stored row is what is on screen, so this really
        // is the saved-state render and not a failure to render at all.
        expect(screen.getAllByRole("checkbox").filter((c) => (c as HTMLInputElement).checked))
            .toHaveLength(1);
    });
});
