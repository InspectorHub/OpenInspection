/**
 * Design System 0520 subsystem E P7.1 — analytics pure aggregators.
 *
 * Two helpers backing AnalyticsService:
 *
 *   • groupInspectionsByMonth(rows, anchorYm, count)
 *       Buckets the input rows into `count` monthly slots ending at
 *       `anchorYm` (YYYY-MM). Missing months are surfaced as zero
 *       counts so the chart renders continuous gridlines.
 *
 *   • summariseHeatmap(resultsRows)
 *       Flattens the per-inspection results.data envelope into
 *       (section, category, count) cells. Missing sectionName lands
 *       under "Unknown"; missing rating is skipped entirely.
 *
 * Splitting these out keeps the SQL-touching service surface
 * minimal and the logic deterministic / unit-testable.
 */

export interface InspectionRow {
    createdAt: string | Date;
}

export interface MonthBucket {
    ym:    string;   // 'YYYY-MM'
    count: number;
}

/** Convert any timestamp-ish into a 'YYYY-MM' string. */
function ymOf(t: string | Date): string {
    const d = typeof t === 'string' ? new Date(t) : t;
    if (Number.isNaN(d.getTime())) return '';
    const y = d.getUTCFullYear();
    const m = (d.getUTCMonth() + 1).toString().padStart(2, '0');
    return `${y}-${m}`;
}

/** Walk back `count` months from `anchorYm` inclusive. */
function lastNMonths(anchorYm: string, count: number): string[] {
    const [yStr, mStr] = anchorYm.split('-');
    if (!yStr || !mStr) return [];
    let y = parseInt(yStr, 10);
    let m = parseInt(mStr, 10);
    const out: string[] = [];
    for (let i = 0; i < count; i++) {
        out.unshift(`${y}-${m.toString().padStart(2, '0')}`);
        m -= 1;
        if (m === 0) { m = 12; y -= 1; }
    }
    return out;
}

export function groupInspectionsByMonth(
    rows:    InspectionRow[],
    anchorYm: string,
    count:    number,
): MonthBucket[] {
    const window = new Set(lastNMonths(anchorYm, count));
    const counts = new Map<string, number>();
    for (const ym of window) counts.set(ym, 0);

    for (const r of rows) {
        const ym = ymOf(r.createdAt);
        if (!window.has(ym)) continue;
        counts.set(ym, (counts.get(ym) ?? 0) + 1);
    }

    return [...counts.entries()]
        .map(([ym, count]) => ({ ym, count }))
        .sort((a, b) => a.ym.localeCompare(b.ym));
}

export interface HeatmapItem {
    sectionName?: string;
    rating?:      string;
}

export interface HeatmapCell {
    section:  string;
    category: string;
    count:    number;
}

export function summariseHeatmap(
    inspectionResultsRows: Array<Record<string, HeatmapItem>>,
): { cells: HeatmapCell[] } {
    const counts: Record<string, Record<string, number>> = {};

    for (const row of inspectionResultsRows) {
        for (const item of Object.values(row)) {
            const section = item.sectionName ?? 'Unknown';
            const cat     = item.rating;
            if (!cat) continue;
            counts[section] ??= {};
            counts[section][cat] = (counts[section][cat] ?? 0) + 1;
        }
    }

    const cells: HeatmapCell[] = [];
    for (const [section, byCat] of Object.entries(counts)) {
        for (const [category, count] of Object.entries(byCat)) {
            cells.push({ section, category, count });
        }
    }
    return { cells };
}
