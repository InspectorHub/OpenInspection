// @vitest-environment happy-dom
/**
 * The calendar is the field's entry point, so the only thing that matters about
 * an item is whether tapping it lands somewhere real.
 *
 * It did not, for two kinds. The modal offered "Open Inspection" for ANY item
 * carrying an id and fell back to the item's OWN id when it had no inspection
 * id — so a company holiday, whose id is `holiday:2026-08-04`, navigated to
 * `/inspections/holiday:2026-08-04`. Landing on a 404 in a crawlspace is the
 * failure worth a gate; a visit resolving to `/inspections/<event id>` is the
 * same 404 wearing a different hat.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";

import { CalendarEventModal } from "./CalendarEventModal";
import { calendarItemHref, calendarItemToEvent, type CalendarItem } from "./calendar-helpers";

const VISIT: CalendarItem = {
    id: "ev-radon-pickup",
    kind: "inspection_event",
    title: "Radon pickup",
    start: "2027-03-15T14:00:00.000Z",
    end: "2027-03-15T14:20:00.000Z",
    civilDate: "2027-03-15",
    startTime: "10:00",
    endTime: "10:20",
    allDay: false,
    inspectionId: "insp-77",
    meta: { status: "scheduled", durationMin: 20 },
};

const HOLIDAY: CalendarItem = {
    id: "holiday:2026-08-04",
    kind: "company_holiday",
    title: "Civic Holiday",
    start: "2026-08-04",
    end: "2026-08-04",
    civilDate: "2026-08-04",
    allDay: true,
    meta: { holidayName: "Civic Holiday" },
};

function renderModal(item: CalendarItem) {
    const Stub = createRoutesStub([
        {
            path: "/calendar",
            Component: () => (
                <CalendarEventModal
                    event={calendarItemToEvent(item)}
                    open
                    displayTz="America/New_York"
                    locale="en-US"
                    onClose={vi.fn()}
                />
            ),
        },
    ]);
    return render(<Stub initialEntries={["/calendar"]} />);
}

describe("calendarItemHref", () => {
    it("sends a visit to its inspection, not to its own id", () => {
        expect(calendarItemHref(calendarItemToEvent(VISIT))).toBe("/inspections/insp-77");
    });

    it("sends an inspection to itself", () => {
        const item: CalendarItem = {
            id: "insp-9",
            kind: "inspection",
            title: "742 Evergreen Terrace",
            start: "2026-08-04",
            end: "2026-08-04",
            civilDate: "2026-08-04",
            allDay: true,
            inspectionId: "insp-9",
        };
        expect(calendarItemHref(calendarItemToEvent(item))).toBe("/inspections/insp-9");
    });

    it("answers nowhere for a company holiday", () => {
        // The whole point: `/inspections/holiday:2026-08-04` is a 404.
        expect(calendarItemHref(calendarItemToEvent(HOLIDAY))).toBeNull();
    });

    it("answers nowhere for a visit that carries no inspection", () => {
        const orphan = calendarItemToEvent({ ...VISIT, inspectionId: undefined });
        expect(calendarItemHref(orphan)).toBeNull();
    });
});

describe("CalendarEventModal", () => {
    it("links a visit to the job it belongs to", () => {
        renderModal(VISIT);
        expect(screen.getByRole("link")).toHaveAttribute("href", "/inspections/insp-77");
    });

    it("offers no destination at all for a company holiday", () => {
        renderModal(HOLIDAY);
        expect(screen.queryByRole("link")).toBeNull();
    });

    it("shows the wall clock the server resolved, not a re-derived one", () => {
        // 14:00Z is 10:00 in New York on this date (EDT). The modal must read the
        // server's startTime; deriving it from `start` is the calendar
        // off-by-one.
        renderModal(VISIT);
        expect(document.body.textContent).toContain("10:00 - 10:20");
    });

    it("shows an all-day item on the civil day it was stored, not one converted through a zone", () => {
        // `2026-08-04` run through a UTC-negative viewer zone as an instant lands
        // on 2026-08-03 at 8 PM — the wrong day, with a time nobody set.
        renderModal(HOLIDAY);
        expect(document.body.textContent).toContain("Aug 4, 2026");
        expect(document.body.textContent).not.toContain("Aug 3");
        expect(document.body.textContent).not.toMatch(/\d:\d\d\s?(AM|PM)/);
    });

    it("translates the visit status instead of printing the column value", () => {
        renderModal({ ...VISIT, meta: { status: "results_received" } });
        expect(document.body.textContent).toContain("Results received");
        expect(document.body.textContent).not.toContain("results received");
    });
});
