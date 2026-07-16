import { describe, expect, it } from "vitest";
import {
  calendarItemToEvent,
  defaultCalendarScope,
  type CalendarItem,
} from "./calendar-helpers";

describe("defaultCalendarScope", () => {
  it.each(["owner", "manager"])("defaults %s to the Team calendar", (role) => {
    expect(defaultCalendarScope(role)).toBe("team");
  });

  it.each(["inspector", "agent", undefined])("defaults %s to the My calendar", (role) => {
    expect(defaultCalendarScope(role)).toBe("my");
  });
});

describe("calendarItemToEvent", () => {
  it("preserves block fields needed by the edit drawer", () => {
    const item: CalendarItem = {
      id: "block-1",
      kind: "calendar_block",
      title: "Training",
      start: "2026-07-20T13:30:00.000Z",
      end: "2026-07-20T15:00:00.000Z",
      allDay: false,
      userId: "user-1",
      meta: { notes: "Bring materials" },
    };

    expect(calendarItemToEvent(item)).toMatchObject({
      id: "block-1",
      title: "Training",
      start: item.start,
      end: item.end,
      source: "calendar_block",
      extendedProps: {
        kind: "calendar_block",
        allDay: false,
        userId: "user-1",
        notes: "Bring materials",
      },
    });
  });

  it("maps inspection metadata for existing calendar views", () => {
    const item: CalendarItem = {
      id: "event-1",
      kind: "inspection_event",
      title: "Pre-purchase inspection",
      start: "2026-07-20T09:00:00.000Z",
      end: "2026-07-20T11:00:00.000Z",
      allDay: false,
      inspectionId: "inspection-1",
      meta: { status: "confirmed" },
    };

    expect(calendarItemToEvent(item)).toMatchObject({
      id: "event-1",
      status: "confirmed",
      extendedProps: {
        kind: "inspection_event",
        inspectionId: "inspection-1",
      },
    });
  });
});
