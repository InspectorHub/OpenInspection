// Re-export everything from both server status modules for app-side use.
// No bare status string literals in app code — import from here.
import { m } from '~/paraglide/messages';
import type { InspectionStatus } from '../../server/lib/status/inspection-status';
import type { ReportStatus } from '../../server/lib/status/report-status';

export {
  INSPECTION_STATUSES,
  INSPECTION_STATUS,
  type InspectionStatus,
  isInspectionStatus,
} from '../../server/lib/status/inspection-status';

export {
  REPORT_STATUSES,
  REPORT_STATUS,
  type ReportStatus,
  isReportStatus,
  isReportPublished,
} from '../../server/lib/status/report-status';

// Display labels live app-side (not in the server enum modules) so they can resolve
// under the active paraglide locale. Exposed as getters so the string resolves at
// access time, not frozen at module-import time. The enum ids/keys are unchanged.
export const INSPECTION_STATUS_LABELS: Record<InspectionStatus, string> = {
  get requested() { return m.label_status_requested(); },
  get scheduled() { return m.label_status_scheduled(); },
  get confirmed() { return m.label_status_confirmed(); },
  get completed() { return m.label_status_completed(); },
  get cancelled() { return m.label_status_cancelled(); },
};

export const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
  get in_progress() { return m.label_status_report_in_progress(); },
  get submitted() { return m.label_status_report_submitted(); },
  get published() { return m.label_status_report_published(); },
};

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
