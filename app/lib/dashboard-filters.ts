import { INSPECTION_STATUS, REPORT_STATUS, isReportPublished } from "~/lib/status";
import type { FilterId, Inspection, TabKey } from "~/lib/dashboard-schema";

/* ------------------------------------------------------------------ */
/*  Time filter helpers                                                */
/* ------------------------------------------------------------------ */

export function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(d: Date, days: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

export function startOfWeek(d: Date) {
  const x = startOfDay(d);
  x.setDate(x.getDate() - x.getDay());
  return x;
}

export function matchesFilter(insp: Inspection, filter: FilterId, now: Date): boolean {
  if (filter === "all") return true;
  const status = (insp.status || "").toLowerCase();
  if (filter === "unconfirmed") return status === INSPECTION_STATUS.SCHEDULED || status === INSPECTION_STATUS.REQUESTED;
  if (filter === "in_progress") return status === INSPECTION_STATUS.COMPLETED && !isReportPublished(insp.reportStatus);
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
/*  Report-state badge (Published tab)                                 */
/* ------------------------------------------------------------------ */

export function reportStateLabel(reportStatus: string): string {
  if (reportStatus === "in_progress") return "In Progress";
  if (reportStatus === "submitted") return "Submitted";
  if (reportStatus === "published") return "Published";
  return reportStatus;
}
