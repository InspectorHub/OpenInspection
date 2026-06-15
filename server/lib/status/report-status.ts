/**
 * Single source of truth for the REPORT (deliverable) axis. Independent of the
 * inspection lifecycle axis. Mirrors server/lib/auth/roles.ts. No bare literals.
 */
export const REPORT_STATUSES = ['in_progress', 'submitted', 'published'] as const;

export type ReportStatus = typeof REPORT_STATUSES[number];

export const REPORT_STATUS = {
  IN_PROGRESS: 'in_progress',
  SUBMITTED: 'submitted',
  PUBLISHED: 'published',
} as const satisfies Record<string, ReportStatus>;

export const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
  in_progress: 'In Progress',
  submitted: 'Submitted',
  published: 'Published',
};

export function isReportStatus(value: unknown): value is ReportStatus {
  return typeof value === 'string' && (REPORT_STATUSES as readonly string[]).includes(value);
}

/** The single canonical "is this report published?" predicate. */
export function isReportPublished(value: unknown): boolean {
  return value === REPORT_STATUS.PUBLISHED;
}
