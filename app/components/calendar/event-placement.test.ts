/**
 * Where a loader event lands in the grid.
 *
 * The month/week/day views ask two questions and nothing else: which civil-date
 * cell does this belong to, and — if it is timed — which hour row. Both answers
 * come from strings the server resolved in the effective timezone, so both are
 * testable without a browser. They are tested here because the failure mode is
 * total and silent: an event whose `civilDate` is not a cell key renders in no
 * cell at all, and the page looks like an empty week rather than a broken one.
 */
import { describe, expect, it } from "vitest";
import {
  bucketEventsByCivilDate,
  civilDateOf,
  eventStartHour,
  isAllDayEvent,
  type CalendarEvent,
} from "./calendar-helpers";

function event(over: Partial<CalendarEvent> & { id: string }): CalendarEvent {
  return {
    title: "742 Evergreen Terrace",
    start: "2026-09-10T09:00:00.000Z",
    civilDate: "2026-09-10",
    ...over,
    extendedProps: { kind: "inspection", allDay: false, ...(over.extendedProps ?? {}) },
  };
}

describe("calendar event placement", () => {
  it("lands a timed event in its own hour row", () => {
    const ev = event({ id: "a", startTime: "09:00" });
    expect(isAllDayEvent(ev)).toBe(false);
    expect(eventStartHour(ev)).toBe(9);
  });

  it("keeps a minute offset inside the hour it starts in", () => {
    expect(eventStartHour(event({ id: "a", startTime: "14:45" }))).toBe(14);
    expect(eventStartHour(event({ id: "b", startTime: "07:01" }))).toBe(7);
    expect(eventStartHour(event({ id: "c", startTime: "00:00" }))).toBe(0);
  });

  it("lands an all-day event in the all-day row and at no hour", () => {
    const ev = event({
      id: "holiday",
      civilDate: "2026-09-07",
      start: "2026-09-07",
      extendedProps: { kind: "company_holiday", allDay: true },
    });
    expect(isAllDayEvent(ev)).toBe(true);
    expect(Number.isNaN(eventStartHour(ev))).toBe(true);
  });

  it("treats a timed event with no startTime as all-day rather than hour zero", () => {
    // An hour row matches on `eventStartHour(ev) === h`, and NaN matches no row.
    // Claiming hour 0 would silently park the card at midnight instead.
    expect(Number.isNaN(eventStartHour(event({ id: "a" })))).toBe(true);
  });

  it("buckets an event into the cell key the grid actually looks up", () => {
    const ev = event({ id: "a", startTime: "09:00" });
    const cells = bucketEventsByCivilDate([ev]);
    // civilDateOf is what every view builds its cell key with, month 0-based.
    expect(cells.get(civilDateOf(2026, 8, 10))).toEqual([ev]);
  });

  it("NEGATIVE CONTROL — a raw timestamp as civilDate lands in no cell at all", () => {
    // This is F61's mechanism, pinned: the feed copied `inspections.date`
    // verbatim into civilDate, so the grid asked for '2026-09-10' and the bucket
    // was keyed '2026-09-10T09:00:00.000Z'. Nothing threw; nothing rendered.
    const ev = event({ id: "a", civilDate: "2026-09-10T09:00:00.000Z", startTime: "09:00" });
    const cells = bucketEventsByCivilDate([ev]);
    expect(cells.get(civilDateOf(2026, 8, 10))).toBeUndefined();
  });

  it("POSITIVE CONTROL — a correct payload does reach its cell, so 'nothing rendered' cannot pass", () => {
    const cells = bucketEventsByCivilDate([
      event({ id: "a", civilDate: "2026-09-05", startTime: "09:00" }),
      event({ id: "b", civilDate: "2026-09-10", startTime: "09:00" }),
      event({ id: "c", civilDate: "2026-09-10", startTime: "13:00" }),
    ]);
    expect(cells.get("2026-09-05")?.map((e) => e.id)).toEqual(["a"]);
    expect(cells.get("2026-09-10")?.map((e) => e.id)).toEqual(["b", "c"]);
  });

  it("does not move a DST-boundary event off its day or its hour", () => {
    // US spring-forward 2027-03-14 and fall-back 2027-11-07. The view never
    // parses an instant, so neither can shift a cell or an hour row.
    const spring = event({ id: "s", civilDate: "2027-03-14", startTime: "02:30", start: "2027-03-14T07:30:00.000Z" });
    const fall = event({ id: "f", civilDate: "2027-11-07", startTime: "01:30", start: "2027-11-07T05:30:00.000Z" });
    expect(eventStartHour(spring)).toBe(2);
    expect(eventStartHour(fall)).toBe(1);
    const cells = bucketEventsByCivilDate([spring, fall]);
    expect(cells.get(civilDateOf(2027, 2, 14))?.map((e) => e.id)).toEqual(["s"]);
    expect(cells.get(civilDateOf(2027, 10, 7))?.map((e) => e.id)).toEqual(["f"]);
  });
});
