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

interface FindingsColumn {
    /** Stable slug of the level label — the key inside every row's `counts`. */
    key:   string;
    label: string;
    color: string;
}

interface FindingsRow {
    section: string;
    counts:  Record<string, number>;
    total:   number;
    /**
     * True for the catch-all row — findings whose section id resolves to no
     * section in any current template. The frontend supplies its own label for
     * it (translated, and phrased for an inspector) rather than matching on
     * `section === 'Unknown'`, which would put a magic string on both sides of
     * the API boundary.
     */
    unresolvedSection?: true;
}

/** One rating system's self-contained matrix. */
interface FindingsSystemMatrix {
    systemId:   string;
    systemName: string;
    columns:    FindingsColumn[];
    rows:       FindingsRow[];
    /** Rated items counted into THIS system's matrix. */
    total:      number;
}

export interface FindingsMatrix {
    /**
     * One matrix per rating system that produced at least one finding, ordered
     * by volume so the frontend can default to the busiest.
     *
     * Kept separate rather than unioned into one table. Rating systems are not
     * commensurable: `Defect`, `Deficient` and `Deficiency` name one severity
     * band in three vocabularies, so a union renders them as three sparse
     * columns; and column order is a per-system index, so a merged header row
     * loses the left-to-right severity gradient that makes the table readable.
     * A row total spanning two systems counts real findings but describes a
     * distribution nobody can compare.
     */
    systems:    FindingsSystemMatrix[];
    /** Rated items across every system — the denominator for "not shown". */
    total:      number;
    /** Rated items dropped because their rating matched no known level. */
    unresolved: number;
}

/** A rating system as this aggregator needs it. */
export interface HeatmapSystem {
    id:     string;
    name:   string;
    levels: HeatmapLevel[];
}

const UNKNOWN_SECTION = 'Unknown';

/** Level label → the `counts` key. Lowercase, non-alphanumerics collapsed. */
function findingsColumnKey(label: string): string {
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
 * Build the /metrics findings matrices — one per rating system in use.
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
 * **Why one matrix per system rather than one merged table.** See
 * `FindingsMatrix.systems`. Each system's matrix is internally coherent: its own
 * vocabulary, its own severity order, totals that mean something.
 *
 * A finding is attributed to a system by its rating id, which is unique across
 * systems. Legacy envelopes wrote the level's label (`"Satisfactory"`) or
 * abbreviation instead; those are ambiguous when two systems share a label, and
 * are attributed to the first system defining them — deterministic, and the
 * only available answer once the id is gone. Anything still unmatched is counted
 * in `unresolved` rather than invented into a column of its own.
 */
export function summariseFindings(
    inspectionResultsRows: Array<Record<string, HeatmapItem>>,
    ctx: { sectionTitles: Record<string, string>; systems: HeatmapSystem[] },
): FindingsMatrix {
    /** Per-system column vocabulary, built once. */
    const columnsBySystem = new Map<string, FindingsColumn[]>();
    const columnKeyByLabelPerSystem = new Map<string, Map<string, string>>();

    for (const system of ctx.systems) {
        const columns: FindingsColumn[] = [];
        const byLabel = new Map<string, string>();
        const ordered = [...system.levels.filter((l) => !isNonCondition(l))]
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        for (const level of ordered) {
            const label = level.label.trim();
            if (byLabel.has(label.toLowerCase())) continue;
            const key = findingsColumnKey(label);
            byLabel.set(label.toLowerCase(), key);
            columns.push({ key, label, color: level.color });
        }
        columnsBySystem.set(system.id, columns);
        columnKeyByLabelPerSystem.set(system.id, byLabel);
    }

    /**
     * rating value -> which system it belongs to and which column inside it.
     * `null` column = a Not Inspected / Not Present level: dropped, not counted
     * as unresolved. Ids are registered first and across every system, because
     * they are unambiguous; labels and abbreviations only fill gaps they leave.
     */
    interface Attribution { systemId: string; column: string | null }
    const attribution = new Map<string, Attribution>();

    for (const system of ctx.systems) {
        const byLabel = columnKeyByLabelPerSystem.get(system.id)!;
        for (const level of system.levels) {
            const column = isNonCondition(level) ? null : (byLabel.get(level.label.trim().toLowerCase()) ?? null);
            const id = String(level.id ?? '').trim().toLowerCase();
            if (id) attribution.set(id, { systemId: system.id, column });
        }
    }
    for (const system of ctx.systems) {
        const byLabel = columnKeyByLabelPerSystem.get(system.id)!;
        for (const level of system.levels) {
            const column = isNonCondition(level) ? null : (byLabel.get(level.label.trim().toLowerCase()) ?? null);
            for (const alias of [level.label, level.abbreviation]) {
                const norm = String(alias ?? '').trim().toLowerCase();
                if (norm && !attribution.has(norm)) attribution.set(norm, { systemId: system.id, column });
            }
        }
    }

    const bySystem = new Map<string, Map<string, Record<string, number>>>();
    let total = 0;
    let unresolved = 0;

    for (const row of inspectionResultsRows) {
        for (const key of Object.keys(row)) {
            const item = row[key];
            const rating = typeof item?.rating === 'string' ? item.rating.trim() : '';
            if (!rating) continue;
            const hit = attribution.get(rating.toLowerCase());
            if (hit === undefined) { unresolved++; continue; } // no such level
            if (hit.column === null) continue; // Not Inspected / Not Present — not a finding.

            const { sectionId } = parseFindingKey(key);
            const section = ctx.sectionTitles[sectionId] ?? UNKNOWN_SECTION;
            const sections = bySystem.get(hit.systemId) ?? new Map<string, Record<string, number>>();
            const counts = sections.get(section) ?? {};
            counts[hit.column] = (counts[hit.column] ?? 0) + 1;
            sections.set(section, counts);
            bySystem.set(hit.systemId, sections);
            total++;
        }
    }

    const systems: FindingsSystemMatrix[] = ctx.systems
        .filter((s) => bySystem.has(s.id))
        .map((s) => {
            const rows = [...bySystem.get(s.id)!.entries()]
                .map(([section, counts]) => ({
                    section,
                    counts,
                    total: Object.values(counts).reduce((acc, n) => acc + n, 0),
                    ...(section === UNKNOWN_SECTION ? { unresolvedSection: true as const } : {}),
                }))
                // Volume first, but the catch-all row always sinks to the bottom:
                // it is bookkeeping, not a section anyone inspected.
                .sort((a, b) =>
                    Number(a.unresolvedSection ?? false) - Number(b.unresolvedSection ?? false)
                    || b.total - a.total
                    || a.section.localeCompare(b.section));
            return {
                systemId:   s.id,
                systemName: s.name,
                columns:    columnsBySystem.get(s.id) ?? [],
                rows,
                total:      rows.reduce((acc, r) => acc + r.total, 0),
            };
        })
        // Busiest first, so the frontend can default to it without a second rule.
        .sort((a, b) => b.total - a.total || a.systemName.localeCompare(b.systemName));

    return { systems, total, unresolved };
}
