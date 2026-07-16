import { describe, expect, it } from "vitest";
import {
  blockFormSeed,
  bucketEventsByCivilDate,
  calendarItemToEvent,
  civilDateOf,
  defaultCalendarScope,
  type CalendarEvent,
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
      civilDate: "2026-07-20",
      startTime: "13:30",
      endTime: "15:00",
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
      civilDate: "2026-07-20",
      startTime: "09:00",
      endTime: "11:00",
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

  it("carries civilDate and wall-clock times for timezone-safe bucketing", () => {
    const item: CalendarItem = {
      id: "block-2",
      kind: "calendar_block",
      title: "Dentist",
      start: "2026-07-17T09:00:00.000Z",
      end: "2026-07-17T10:00:00.000Z",
      civilDate: "2026-07-17",
      startTime: "09:00",
      endTime: "10:00",
      allDay: false,
      userId: "user-1",
    };

    expect(calendarItemToEvent(item)).toMatchObject({
      civilDate: "2026-07-17",
      startTime: "09:00",
      endTime: "10:00",
    });
  });
});

describe("civilDateOf", () => {
  it("builds a YYYY-MM-DD from calendar parts with no UTC drift", () => {
    // month is 0-based (JS Date convention): 6 = July.
    expect(civilDateOf(2026, 6, 18)).toBe("2026-07-18");
    expect(civilDateOf(2026, 0, 1)).toBe("2026-01-01");
    expect(civilDateOf(2026, 11, 31)).toBe("2026-12-31");
  });
});

describe("blockFormSeed", () => {
  it("populates the edit form from the block's effective-tz civil fields, not the UTC instant", () => {
    // A block authored 09:00 on 2026-07-17 in a UTC+8 tz has instant 01:00Z.
    // Slicing the instant would wrongly show 01:00; the form must show 09:00.
    const block: CalendarEvent = {
      id: "block-1",
      title: "Dentist",
      start: "2026-07-17T01:00:00.000Z",
      end: "2026-07-17T02:00:00.000Z",
      civilDate: "2026-07-17",
      startTime: "09:00",
      endTime: "10:00",
      extendedProps: { allDay: false },
    };
    expect(blockFormSeed(block, null)).toEqual({
      date: "2026-07-17",
      startTime: "09:00",
      endTime: "10:00",
      allDay: false,
    });
  });

  it("seeds an all-day block with default times", () => {
    const block: CalendarEvent = {
      id: "b2", title: "Vacation", start: "2026-07-20", civilDate: "2026-07-20",
      extendedProps: { allDay: true },
    };
    expect(blockFormSeed(block, null)).toMatchObject({ date: "2026-07-20", allDay: true });
  });

  it("seeds a new block from a day-click civil string", () => {
    expect(blockFormSeed(null, "2026-07-21T14:00")).toEqual({
      date: "2026-07-21",
      startTime: "14:00",
      endTime: "10:00",
      allDay: false,
    });
  });
});

describe("bucketEventsByCivilDate", () => {
  it("groups events by their civilDate so a 07-17 event stays out of the 07-18 cell", () => {
    const ev = (id: string, civilDate: string): CalendarEvent => ({
      id, title: id, start: `${civilDate}T09:00:00.000Z`, civilDate,
    });
    const map = bucketEventsByCivilDate([
      ev("block", "2026-07-17"),
      ev("insp", "2026-07-18"),
      ev("other", "2026-07-18"),
    ]);

    expect(map.get("2026-07-17")?.map((e) => e.id)).toEqual(["block"]);
    expect(map.get("2026-07-18")?.map((e) => e.id)).toEqual(["insp", "other"]);
  });
});
