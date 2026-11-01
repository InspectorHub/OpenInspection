import { describe, expect, it } from "vitest";
import { currentStartMs, minuteToEpochMs, type DispatchItem } from "./dispatch-helpers";

/**
 * The board turns a dropped position into an instant. Counting minutes from the tenant's midnight is wrong on the two days a
 * year the clock changes (the day is 25 or 23 hours long), so the instant is counted from noon, which is after the change.
 * All three days below are New York.
 */
const ORDINARY = { dayStartMs: Date.UTC(2026, 5, 1, 4, 0), noonMs: Date.UTC(2026, 5, 1, 16, 0) }; // EDT all day
const FALL_BACK = { dayStartMs: Date.UTC(2026, 10, 1, 4, 0), noonMs: Date.UTC(2026, 10, 1, 17, 0) }; // midnight EDT, noon EST
const SPRING_FORWARD = { dayStartMs: Date.UTC(2027, 2, 14, 5, 0), noonMs: Date.UTC(2027, 2, 14, 16, 0) }; // midnight EST, noon EDT

describe("minuteToEpochMs", () => {
  it("an ordinary day: 09:00 is nine hours after midnight (the same answer as before)", () => {
    expect(minuteToEpochMs(ORDINARY, 9 * 60)).toBe(Date.UTC(2026, 5, 1, 13, 0));
  });

  it("the day the clock goes back: 09:00 is 09:00 EST, 14:00 UTC, and not 08:00", () => {
    expect(minuteToEpochMs(FALL_BACK, 9 * 60)).toBe(Date.UTC(2026, 10, 1, 14, 0));
  });

  it("the day the clock goes forward: 09:00 is 09:00 EDT, 13:00 UTC, and not 10:00", () => {
    expect(minuteToEpochMs(SPRING_FORWARD, 9 * 60)).toBe(Date.UTC(2027, 2, 14, 13, 0));
  });

  it("noon itself, and the two ends of the working axis, are right on both change days", () => {
    expect(minuteToEpochMs(FALL_BACK, 12 * 60)).toBe(FALL_BACK.noonMs);
    expect(minuteToEpochMs(FALL_BACK, 7 * 60)).toBe(Date.UTC(2026, 10, 1, 12, 0));
    expect(minuteToEpochMs(FALL_BACK, 19 * 60)).toBe(Date.UTC(2026, 10, 2, 0, 0));
    expect(minuteToEpochMs(SPRING_FORWARD, 7 * 60)).toBe(Date.UTC(2027, 2, 14, 11, 0));
    expect(minuteToEpochMs(SPRING_FORWARD, 19 * 60)).toBe(Date.UTC(2027, 2, 14, 23, 0));
  });
});

describe("currentStartMs", () => {
  const untimed = (startTime: string): DispatchItem => ({ id: "i", kind: "inspection", title: "x", allDay: false, startTime } as DispatchItem);

  it("a card with a stored instant carries it unchanged", () => {
    const stored = { ...untimed("09:00"), meta: { scheduledStartMs: 123_456 } } as DispatchItem;
    expect(currentStartMs(stored, FALL_BACK)).toBe(123_456);
  });

  it("a card with only a wall-clock time gets the right instant on the day the clock goes back", () => {
    expect(currentStartMs(untimed("09:00"), FALL_BACK)).toBe(Date.UTC(2026, 10, 1, 14, 0));
  });
});
