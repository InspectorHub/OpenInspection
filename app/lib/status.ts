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
