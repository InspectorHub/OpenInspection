/**
 * Resolve the immutable archive version for a report download. Published
 * reports serve the latest published report_versions snapshot (rendered once,
 * cached forever — the #120 archive). Drafts (and any pre-publish status) return
 * null → the download renders on-demand keyed by the live dataVersion instead.
 */
import { isReportPublished, type ReportStatus } from '../lib/status/report-status';

export function resolveArchiveVersion(
    reportStatus: ReportStatus, versionsDesc: { versionNumber: number }[],
): number | null {
    if (isReportPublished(reportStatus)) return versionsDesc[0]?.versionNumber ?? null;
    return null;
}
