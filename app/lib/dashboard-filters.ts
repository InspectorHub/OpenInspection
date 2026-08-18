import { INSPECTION_STATUS, REPORT_STATUS, isReportPublished } from "~/lib/status";
import type { FilterId, Inspection, TabKey } from "~/lib/dashboard-schema";

/* ------------------------------------------------------------------ */
/*  Time filter helpers                                                */
/* ------------------------------------------------------------------ */

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, days: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

function startOfWeek(d: Date) {
  const x = startOfDay(d);
  x.setDate(x.getDate() - x.getDay());
  return x;
}

export function matchesFilter(insp: Inspection, filter: FilterId, now: Date): boolean {
  if (filter === "all") return true;
  const status = (insp.status || "").toLowerCase();
  // Named for what they select, not for a status value they do not share:
  // "needs confirmation" is booked-but-unconfirmed, and "awaiting report" is
  // the work done with the report not yet out.
  if (filter === "needs_confirmation") return status === INSPECTION_STATUS.SCHEDULED || status === INSPECTION_STATUS.REQUESTED;
  if (filter === "awaiting_report") return status === INSPECTION_STATUS.COMPLETED && !isReportPublished(insp.reportStatus);
  if (!insp.date) return false;
  const date = new Date(insp.date);
  if (isNaN(date.getTime())) return false;
  const today = startOfDay(now);
  const yesterday = addDays(today, -1);
  const tomorrow = addDays(today, 1);
  const wkStart = startOfWeek(today);
  const wkEnd = addDays(wkStart, 7);
  const dayStart = startOfDay(date);
  switch (filter) {
    case "past": return dayStart.getTime() < today.getTime();
    case "yesterday": return dayStart.getTime() === yesterday.getTime();
    case "today": return dayStart.getTime() === today.getTime();
    case "tomorrow": return dayStart.getTime() === tomorrow.getTime();
    case "this_week": return dayStart.getTime() >= wkStart.getTime() && dayStart.getTime() < wkEnd.getTime();
    case "future": return dayStart.getTime() >= wkEnd.getTime();
  }
  return false;
}

/* ------------------------------------------------------------------ */
/*  Workflow tabs                                                       */
/* ------------------------------------------------------------------ */

/**
 * Pure tab matching function for both inspection lifecycle and report axes.
 * Exported for unit testing.
 */
export function tabMatches(
  tab: string,
  i: { status: string; reportStatus?: string; paymentStatus?: string | null },
): boolean {
  if (tab === "all") return true;
  switch (tab) {
    case "active": return (
        i.status === INSPECTION_STATUS.REQUESTED ||
        i.status === INSPECTION_STATUS.SCHEDULED ||
        i.status === INSPECTION_STATUS.CONFIRMED
      );
    case "requested": return i.status === INSPECTION_STATUS.REQUESTED;
    case "to_review": return i.reportStatus === REPORT_STATUS.SUBMITTED;
    case "published": return isReportPublished(i.reportStatus);
    case "awaiting_payment": return isReportPublished(i.reportStatus) && i.paymentStatus !== "paid";
    case "cancelled": return i.status === INSPECTION_STATUS.CANCELLED;
    default: return true;
  }
}

/** @deprecated Use tabMatches instead. Kept for backward compat. */
export function matchesWorkflow(i: Inspection, tab: TabKey): boolean {
  return tabMatches(tab, i);
}

/* ------------------------------------------------------------------ */
/*  Stat-card focus                                                     */
/* ------------------------------------------------------------------ */

/** The four stat cards, as URL values for `?focus=`. */
// Not exported: `StatFocus` and `isStatFocus` are the surface consumers need,
// and an export nothing imports is dead surface the deadcode gate flags.
const STAT_FOCUS = ["upcoming", "in_progress", "needs_attention", "recent"] as const;

export type StatFocus = (typeof STAT_FOCUS)[number];

export function isStatFocus(value: string | null | undefined): value is StatFocus {
  return value != null && (STAT_FOCUS as readonly string[]).includes(value);
}

/** The minimum an inspection has to be for a stat card to sort it. */
interface StatItem {
  id: string;
  status: string;
  reportStatus?: string | null;
}

/**
 * The four stat cards as ID SETS.
 *
 * None of the four is a workflow tab, and reaching for `?workflow=` to make the
 * cards clickable would quietly link each number to a different population than
 * the one it counted:
 *
 *   - Upcoming is a DATE WINDOW (today ∪ this week ∪ later); the nearest tab,
 *     `active`, is a STATUS set.
 *   - In Progress is "completed, report not out"; the nearest tab, `to_review`,
 *     is `reportStatus === submitted` — a strict subset that misses every
 *     report still being written.
 *   - Needs Attention is a five-clause server-side threshold rule that joins
 *     agreement_requests and invoices. No tab expresses it, and
 *     `awaiting_payment` only looks close.
 *   - Recent Reports is `published` minus one conjunct.
 *
 * So the membership itself is the filter. The counts on the cards and the list
 * a card opens are this one function read twice, which is what makes the number
 * and the list unable to disagree.
 */
export function statFocusIds<T extends StatItem>(
  buckets: Partial<Record<string, T[]>>,
  all: T[],
): Record<StatFocus, Set<string>> {
  const ids = (items: T[] | undefined) => (items ?? []).map((i) => i.id);
  return {
    upcoming: new Set([
      ...ids(buckets.today),
      ...ids(buckets.thisWeek),
      ...ids(buckets.later),
    ]),
    // Not a bucket — the same predicate the card's count has always used.
    in_progress: new Set(
      all
        .filter((i) => i.status === INSPECTION_STATUS.COMPLETED && !isReportPublished(i.reportStatus))
        .map((i) => i.id),
    ),
    needs_attention: new Set(ids(buckets.needsAttention)),
    recent: new Set(ids(buckets.recentReports)),
  };
}

/* ------------------------------------------------------------------ */
/*  Report-state badge (Published tab)                                 */
/* ------------------------------------------------------------------ */

export function reportStateLabel(reportStatus: string): string {
  if (reportStatus === "in_progress") return "In Progress";
  if (reportStatus === "submitted") return "Submitted";
  if (reportStatus === "published") return "Published";
  return reportStatus;
}

/* ------------------------------------------------------------------ */
/*  Empty list: nothing here, or nothing matching?                     */
/* ------------------------------------------------------------------ */

/** Every control that can narrow the inspection list. `"all"` means "not narrowing". */
export interface ListFilterState {
    tab: string;
    /** `?focus=` from a stat card. `""` means no card is driving the list. */
    focus: string;
    timeFilter: string;
    tagId: string;
    dateFrom: string;
    dateTo: string;
    agentId: string;
    search: string;
}

/**
 * Which narrowing controls are currently set.
 *
 * The empty state used to be driven by the FILTERED count alone, so a workspace
 * with two hundred inspections was told it had none as soon as a tab, a tag or a
 * search excluded them all — and offered "create your first one" as the remedy
 * for a list that was merely filtered. A date range counts as ONE filter: from
 * and to are two ends of a single control.
 */
export function activeListFilters(f: ListFilterState): string[] {
    const active: string[] = [];
    if (f.tab && f.tab !== "all") active.push("workflow");
    if (f.focus) active.push("focus");
    if (f.timeFilter && f.timeFilter !== "all") active.push("time");
    if (f.tagId) active.push("tag");
    if (f.dateFrom || f.dateTo) active.push("date");
    if (f.agentId) active.push("agent");
    if (f.search.trim()) active.push("search");
    return active;
}

/**
 * Why is the list empty — because the workspace has no inspections, or because
 * the filters exclude all of them?
 *
 * `totalAll` is what the loader returned before filtering. With any filter set
 * the answer is always "no matches": search also queries the server, so a zero
 * local count with a query in the box says nothing about whether the workspace
 * is empty.
 */
export function emptyListReason(
    totalAll: number,
    f: ListFilterState,
): "no-inspections" | "no-matches" {
    if (activeListFilters(f).length > 0) return "no-matches";
    // With nothing filtering, an empty list means an empty workspace — and
    // `totalAll > 0` cannot reach here, since the caller only asks when the
    // rendered count is zero. Named anyway so the argument is not decoration.
    return totalAll > 0 ? "no-matches" : "no-inspections";
}
