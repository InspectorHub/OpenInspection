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
import { matchesFilter, activeListFilters, emptyListReason, statFocusIds, isStatFocus, tabMatches } from "./dashboard-filters";
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

/**
 * Batch D — the list's empty state said "No inspections yet. Click + New
 * Inspection above to get started." whenever the FILTERED count hit zero, so a
 * workspace with two hundred inspections was told it had none the moment a tab,
 * a tag or a search excluded them all. And the button it named does not exist:
 * the real control reads "New Inspection", it is at the top of the page, and an
 * empty state is exactly the place to put one rather than point at one.
 *
 * These two decide which of the two situations it is, and what to offer.
 */
describe("activeListFilters", () => {
    const none = {
        tab: "all", focus: "", timeFilter: "all", tagId: "", dateFrom: "", dateTo: "", agentId: "", search: "",
    };

    it("reports nothing active when the list is unfiltered", () => {
        expect(activeListFilters(none)).toEqual([]);
    });

    it("names each narrowing control that is set", () => {
        expect(activeListFilters({ ...none, tab: "published" })).toEqual(["workflow"]);
        expect(activeListFilters({ ...none, timeFilter: "week" })).toEqual(["time"]);
        expect(activeListFilters({ ...none, tagId: "tag-1" })).toEqual(["tag"]);
        expect(activeListFilters({ ...none, dateFrom: "2026-01-01" })).toEqual(["date"]);
        expect(activeListFilters({ ...none, dateTo: "2026-01-31" })).toEqual(["date"]);
        expect(activeListFilters({ ...none, agentId: "c-1" })).toEqual(["agent"]);
        // A stat card driving the list is a filter like any other: it must count,
        // or an empty focused list tells a full workspace it has nothing.
        expect(activeListFilters({ ...none, focus: "needs_attention" })).toEqual(["focus"]);
        expect(activeListFilters({ ...none, search: "smith" })).toEqual(["search"]);
    });

    it("counts a date RANGE as one filter, not two", () => {
        expect(activeListFilters({ ...none, dateFrom: "2026-01-01", dateTo: "2026-01-31" }))
            .toEqual(["date"]);
    });

    it("ignores whitespace-only search text", () => {
        expect(activeListFilters({ ...none, search: "   " })).toEqual([]);
    });

    it("lists every active filter together", () => {
        expect(activeListFilters({ ...none, tab: "to_review", tagId: "t", search: "x" }))
            .toEqual(["workflow", "tag", "search"]);
    });
});

describe("emptyListReason", () => {
    const none = {
        tab: "all", focus: "", timeFilter: "all", tagId: "", dateFrom: "", dateTo: "", agentId: "", search: "",
    };

    it("is 'no-inspections' only for a workspace that genuinely has none", () => {
        expect(emptyListReason(0, none)).toBe("no-inspections");
    });

    it("is 'no-matches' when a filter is what emptied the list", () => {
        // The defect: 200 inspections, a tab that excludes all of them, and the
        // UI concluding the workspace was empty.
        expect(emptyListReason(200, { ...none, tab: "published" })).toBe("no-matches");
        expect(emptyListReason(200, { ...none, search: "nobody" })).toBe("no-matches");
        expect(emptyListReason(200, { ...none, focus: "needs_attention" })).toBe("no-matches");
    });

    it("is 'no-matches' when a search returns nothing, even with no rows loaded", () => {
        // Search also queries the server, so a zero local count with a query in
        // the box says nothing about whether the workspace is empty.
        expect(emptyListReason(0, { ...none, search: "nobody" })).toBe("no-matches");
    });
});

/**
 * The stat cards are bucket MEMBERSHIP, not workflow tabs.
 *
 * Making the cards clickable by pointing them at `?workflow=` was the obvious
 * move and it is wrong: each of the four counts a different population than the
 * nearest tab selects, so the number on the card and the list behind it would
 * have disagreed on arrival. These pin the four sets, and the `in_progress`
 * case carries its own counter-example against the tab that looks equivalent.
 */
describe("statFocusIds", () => {
    const item = (id: string, status: string, reportStatus: string | null = null) =>
        ({ id, status, reportStatus });

    const today = [item("a", "confirmed")];
    const thisWeek = [item("b", "scheduled")];
    const later = [item("c", "scheduled")];
    const needsAttention = [item("a", "confirmed"), item("d", "completed", "submitted")];
    const recentReports = [item("e", "completed", "published")];
    const buckets = { today, thisWeek, later, needsAttention, recentReports, cancelled: [] };
    const all = [...today, ...thisWeek, ...later, ...needsAttention, ...recentReports];

    it("unions the three date buckets for Upcoming", () => {
        expect([...statFocusIds(buckets, all).upcoming].sort()).toEqual(["a", "b", "c"]);
    });

    it("dedupes an inspection that sits in two date buckets", () => {
        const dup = { ...buckets, thisWeek: [item("a", "confirmed")] };
        expect(statFocusIds(dup, all).upcoming.size).toBe(2);
    });

    it("reads Needs Attention and Recent Reports straight off their buckets", () => {
        const sets = statFocusIds(buckets, all);
        expect([...sets.needs_attention].sort()).toEqual(["a", "d"]);
        expect([...sets.recent]).toEqual(["e"]);
    });

    it("selects In Progress by 'completed, report not published' — NOT the to_review tab", () => {
        const writing = item("f", "completed", "in_progress");
        const sets = statFocusIds(buckets, [...all, writing]);
        expect([...sets.in_progress].sort()).toEqual(["d", "f"]);
        // The counter-example: the nearest tab is a strict subset and drops the
        // report still being written, which is why this is not a tab link.
        expect(tabMatches("to_review", { status: "completed", reportStatus: "in_progress" })).toBe(false);
        expect(sets.in_progress.has("f")).toBe(true);
    });

    it("survives a bucket the payload did not send", () => {
        expect(statFocusIds({}, []).upcoming.size).toBe(0);
    });

    it("rejects a focus value the URL made up", () => {
        expect(isStatFocus("needs_attention")).toBe(true);
        expect(isStatFocus("awaiting_payment")).toBe(false);
        expect(isStatFocus(null)).toBe(false);
    });
});
