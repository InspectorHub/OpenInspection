/**
 * Import report: the per-table accounting produced by preview and apply, stored
 * as one JSON value on the job so a lost local state file can be rebuilt.
 *
 * A row is either created, skipped (already mapped / conflict), or rejected
 * (with a code). Rejected rows never create partial data. The report also
 * records settings dropped by mode, HTML fields sanitized, and non-blocking
 * advisories. It carries counts and codes only — never row content or PII.
 */
export interface RowRejection {
    table: string;
    sourceId: string;
    code: string;
}

export interface ImportReportData {
    created: Record<string, number>;
    skipped: Record<string, number>;
    rejected: RowRejection[];
    droppedSettings: string[];
    sanitizedFields: string[];
    advisories: string[];
}

export function createReport(): ImportReportData {
    return {
        created: {}, skipped: {}, rejected: [],
        droppedSettings: [], sanitizedFields: [], advisories: [],
    };
}

function bump(bucket: Record<string, number>, table: string): void {
    bucket[table] = (bucket[table] ?? 0) + 1;
}

export function recordCreated(report: ImportReportData, table: string): void {
    bump(report.created, table);
}

export function recordSkipped(report: ImportReportData, table: string): void {
    bump(report.skipped, table);
}

export function recordRejected(report: ImportReportData, rejection: RowRejection): void {
    report.rejected.push(rejection);
}

export function addUnique(report: ImportReportData, field: 'droppedSettings' | 'sanitizedFields' | 'advisories', values: readonly string[]): void {
    const set = new Set(report[field]);
    for (const v of values) set.add(v);
    report[field] = [...set];
}

/** Serialize for storage on the job row. Counts/codes only; no row values. */
export function serializeReport(report: ImportReportData): string {
    return JSON.stringify(report);
}
