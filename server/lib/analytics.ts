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
 *   • summariseFindings(resultsRows, ctx)
 *       Flattens the per-inspection results.data envelopes into a
 *       section × rating-level matrix. See its own doc comment for why
 *       it needs a resolution context rather than reading the envelope
 *       alone.
 *
 * Splitting these out keeps the SQL-touching service surface
 * minimal and the logic deterministic / unit-testable.
 */
import { parseFindingKey } from './finding-key';

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
    rating?: unknown;
}

/** The subset of a rating level this aggregator needs. */
export interface HeatmapLevel {
    id:           string;
    label:        string;
    abbreviation: string;
    color:        string;
    severity:     'good' | 'marginal' | 'significant' | 'minor';
    isDefect:     boolean;
    order?:       number;
}

export interface FindingsColumn {
    /** Stable slug of the level label — the key inside every row's `counts`. */
    key:   string;
    label: string;
    color: string;
}

export interface FindingsRow {
    section: string;
    counts:  Record<string, number>;
    total:   number;
}

export interface FindingsMatrix {
    columns: FindingsColumn[];
    rows:    FindingsRow[];
    /** Rated items counted into the matrix (excludes the NI/NP levels). */
    total:   number;
    /** Rated items dropped because their rating matched no known level. */
    unresolved: number;
}

export const UNKNOWN_SECTION = 'Unknown';

/** Level label → the `counts` key. Lowercase, non-alphanumerics collapsed. */
export function findingsColumnKey(label: string): string {
    return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'unlabelled';
}

/**
 * Is this level a "not a condition" level — Not Inspected / Not Present?
 *
 * Mirrors `getNaKind` in report-utils (same abbreviation-then-label test) but
 * takes the level directly instead of an id + list, because this aggregator has
 * already resolved the level and importing report-utils would drag the whole
 * report stats surface into the analytics path.
 */
function isNonCondition(level: HeatmapLevel): boolean {
    if (level.isDefect || level.severity !== 'minor') return false;
    const abbr = level.abbreviation.trim().toUpperCase();
    if (abbr === 'NP' || abbr === 'NI') return true;
    const label = level.label.trim().toLowerCase();
    return /not\s*present/.test(label) || /not\s*inspected/.test(label);
}

/**
 * Build the section × rating-level matrix behind the /metrics findings card.
 *
 * **Why this needs a resolution context.** The persisted envelope
 * (`inspection_results.data`) is keyed by composite findingKey and each entry
 * holds only the fields the editor writes — `rating`, `notes`, `value`,
 * `canned`, `defectFields`, `itemAttribute`. It carries neither a section name
 * nor a human-readable rating: `rating` is a rating-level **id**. So the section
 * comes from parsing the key and looking the id up in `sectionTitles`, and the
 * column vocabulary comes from the tenant's own rating levels.
 *
 * **Why the columns are the tenant's levels rather than a fixed set.** Rating
 * systems are per-tenant and differ in arity — the residential seed has
 * Satisfactory/Monitor/Defect, the commercial one adds Marginal, Low
 * Maintenance and Hazard. Folding those onto a fixed 3- or 4-column scale would
 * silently merge distinct levels (Monitor and Marginal both carry severity
 * `marginal`, so a severity-keyed fold loses one of them outright). Competitors
 * publish 4–5 levels for the same reason. Levels that describe the absence of a
 * condition — Not Inspected / Not Present — are excluded: they are not findings.
 *
 * Legacy envelopes wrote the level's label (`"Satisfactory"`) rather than its
 * id, so a rating is matched against id, then label, then abbreviation.
 * Anything still unmatched is counted in `unresolved` rather than invented into
 * a column of its own.
 */
export function summariseFindings(
    inspectionResultsRows: Array<Record<string, HeatmapItem>>,
    ctx: { sectionTitles: Record<string, string>; levels: HeatmapLevel[] },
): FindingsMatrix {
    const conditionLevels = ctx.levels.filter((l) => !isNonCondition(l));

    // One column per distinct label. Two rating systems in the same tenant can
    // both define "Monitor"; they are the same column to a reader.
    const columns: FindingsColumn[] = [];
    const columnKeyByLabel = new Map<string, string>();
    for (const level of [...conditionLevels].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
        const label = level.label.trim();
        if (columnKeyByLabel.has(label.toLowerCase())) continue;
        const key = findingsColumnKey(label);
        columnKeyByLabel.set(label.toLowerCase(), key);
        columns.push({ key, label, color: level.color });
    }

    // rating value (id | label | abbreviation) -> column key. Non-condition
    // levels map to null so their ratings are dropped, not counted as unresolved.
    const columnByRating = new Map<string, string | null>();
    for (const level of ctx.levels) {
        const key = isNonCondition(level) ? null : (columnKeyByLabel.get(level.label.trim().toLowerCase()) ?? null);
        for (const alias of [level.id, level.label, level.abbreviation]) {
            const norm = String(alias ?? '').trim().toLowerCase();
            if (norm && !columnByRating.has(norm)) columnByRating.set(norm, key);
        }
    }

    const bySection = new Map<string, Record<string, number>>();
    let total = 0;
    let unresolved = 0;

    for (const row of inspectionResultsRows) {
        for (const [key, item] of Object.entries(row)) {
            const rating = typeof item?.rating === 'string' ? item.rating.trim() : '';
            if (!rating) continue;
            const column = columnByRating.get(rating.toLowerCase());
            if (column === undefined) { unresolved++; continue; } // no such level
            if (column === null) continue; // Not Inspected / Not Present — not a finding.

            const { sectionId } = parseFindingKey(key);
            const section = ctx.sectionTitles[sectionId] ?? UNKNOWN_SECTION;
            const counts = bySection.get(section) ?? {};
            counts[column] = (counts[column] ?? 0) + 1;
            bySection.set(section, counts);
            total++;
        }
    }

    const rows: FindingsRow[] = [...bySection.entries()]
        .map(([section, counts]) => ({
            section,
            counts,
            total: Object.values(counts).reduce((s, n) => s + n, 0),
        }))
        .sort((a, b) => b.total - a.total || a.section.localeCompare(b.section));

    return { columns, rows, total, unresolved };
}
