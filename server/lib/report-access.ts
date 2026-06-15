// server/lib/report-access.ts
import { isReportPublished } from './status/report-status';

/**
 * Decide whether a PUBLIC report-access request may proceed.
 * Client/token access is allowed only while the report is currently published.
 * Owner-preview and headless render-token access always bypass (they must be
 * able to load in-progress/unpublished reports for editing/preview/rendering).
 * Reads CURRENT report_status — re-publishing restores access automatically.
 */
export function publicReportAccessAllowed(opts: {
  renderMode: boolean;
  ownerPreview: boolean;
  reportStatus: string | null | undefined;
}): boolean {
  if (opts.renderMode || opts.ownerPreview) return true;
  return isReportPublished(opts.reportStatus);
}
