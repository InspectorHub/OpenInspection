/**
 * Two dashboard filters were named after status values whose meaning they do
 * not share: `in_progress` actually meant "the order is done, the report is
 * not", and `unconfirmed` meant "scheduled or requested" while `cancelled` and
 * `completed` — equally unconfirmed — were excluded. Same word, opposite
 * meaning, on a screen that also shows the real status axis.
 *
 * These pin the renamed keys and, more importantly, the filtering semantics
 * they carry — the rename must not quietly change what each filter selects.
 */
import { describe, it, expect } from "vitest";
import { matchesFilter } from "./dashboard-filters";
import { INSPECTION_FILTERS, type FilterId } from "./dashboard-schema";
import type { Inspection } from "./dashboard-schema";

const NOW = new Date("2026-07-20T12:00:00Z");

function insp(status: string, reportStatus: string, date = "2026-07-20"): Inspection {
  return { id: "i1", status, reportStatus, date } as Inspection;
}

describe("dashboard filter vocabulary", () => {
  it("names the report-waiting filter for what it selects", () => {
    const ids = INSPECTION_FILTERS.map((f) => f.id as string);
    expect(ids).toContain("awaiting_report");
    expect(ids).toContain("needs_confirmation");
    // The old names collided with the status axis and are gone, not aliased.
    expect(ids).not.toContain("in_progress");
    expect(ids).not.toContain("unconfirmed");
  });

  it("awaiting_report selects a finished inspection whose report is not published", () => {
    expect(matchesFilter(insp("completed", "in_progress"), "awaiting_report" as FilterId, NOW)).toBe(true);
    expect(matchesFilter(insp("completed", "published"), "awaiting_report" as FilterId, NOW)).toBe(false);
    // On-site work still in progress is NOT awaiting a report.
    expect(matchesFilter(insp("confirmed", "in_progress"), "awaiting_report" as FilterId, NOW)).toBe(false);
  });

  it("needs_confirmation selects scheduled or requested inspections only", () => {
    expect(matchesFilter(insp("scheduled", "in_progress"), "needs_confirmation" as FilterId, NOW)).toBe(true);
    expect(matchesFilter(insp("requested", "in_progress"), "needs_confirmation" as FilterId, NOW)).toBe(true);
    expect(matchesFilter(insp("confirmed", "in_progress"), "needs_confirmation" as FilterId, NOW)).toBe(false);
    expect(matchesFilter(insp("cancelled", "in_progress"), "needs_confirmation" as FilterId, NOW)).toBe(false);
  });

  it("each filter's label comes from the catalog, not a per-page string", () => {
    for (const f of INSPECTION_FILTERS) {
      expect(f.label).toBeTruthy();
      expect(f.label).not.toBe(f.id);
    }
  });
});
