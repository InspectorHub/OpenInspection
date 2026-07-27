/**
 * The reason this helper exists rather than an inline `.toISOString().slice()`:
 * that one-liner renders the UTC wall clock into a control that means LOCAL
 * wall clock, so anyone not on UTC opens the schedule modal and sees a time
 * nobody scheduled.
 */
import { describe, it, expect } from "vitest";
import { toLocalInputValue, fromLocalInputValue } from "./datetime-local";

describe("datetime-local round trip", () => {
  it("survives a round trip through the control", () => {
    const iso = new Date(2026, 7, 1, 14, 30).toISOString();
    expect(fromLocalInputValue(toLocalInputValue(iso))).toBe(iso);
  });

  it("renders the LOCAL wall clock, not the UTC one", () => {
    const d = new Date(2026, 7, 1, 14, 30);
    expect(toLocalInputValue(d.toISOString())).toBe("2026-08-01T14:30");
  });

  it("keeps the time of day — the old date-only field stamped 09:00 over it", () => {
    const value = toLocalInputValue(new Date(2026, 7, 1, 14, 30).toISOString());
    expect(value.endsWith("T09:00")).toBe(false);
    expect(value.endsWith("T14:30")).toBe(true);
  });

  it("treats missing and unparseable input as empty, never as an invalid date", () => {
    expect(toLocalInputValue(null)).toBe("");
    expect(toLocalInputValue("not a date")).toBe("");
    expect(fromLocalInputValue("")).toBe("");
    expect(fromLocalInputValue("not a date")).toBe("");
  });
});
