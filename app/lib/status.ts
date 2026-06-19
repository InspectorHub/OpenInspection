// Re-export everything from both server status modules for app-side use.
// No bare status string literals in app code — import from here.
export {
  INSPECTION_STATUSES,
  INSPECTION_STATUS,
  INSPECTION_STATUS_LABELS,
  type InspectionStatus,
  isInspectionStatus,
} from '../../server/lib/status/inspection-status';

export {
  REPORT_STATUSES,
  REPORT_STATUS,
  REPORT_STATUS_LABELS,
  type ReportStatus,
  isReportStatus,
  isReportPublished,
} from '../../server/lib/status/report-status';

// ------------------------------------------------------------------
//  Shared status display helpers (single source — no per-route copies)
// ------------------------------------------------------------------

import type { ComponentProps } from 'react';
import type { Pill } from '@core/shared-ui';

/** Pill tone union, sourced from the Pill component (no hand-kept literal union). */
type PillTone = NonNullable<ComponentProps<typeof Pill>['tone']>;

/** snake_case status → Title Case (e.g. "in_progress" → "In Progress"). */
export function humanizeStatus(status: string): string {
  return status
    .split('_')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/**
 * Inspection-lifecycle status → Pill tone. Mirrors the former dashboard.tsx
 * `statusTone` const exactly; unknown statuses fall back to neutral.
 */
const STATUS_TONE: Record<string, PillTone> = {
  requested: 'ni',
  scheduled: 'info',
  confirmed: 'info',
  completed: 'sat',
  cancelled: 'gen',
};

export function statusTone(status: string): PillTone {
  return STATUS_TONE[status] ?? 'neutral';
}

/** Capitalize the first letter only ("client" → "Client"). */
export function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
