/**
 * Commercial PCA Phase U — pure scope resolution + units × systems condition
 * matrix. Per-unit findings already live under the composite findingKey prefix
 * (server/lib/finding-key.ts); this module slices and aggregates them for the
 * report. No DB. Severity + category rules mirror Phase F §3.4.
 */
import { findingsForUnit, parseFindingKey, DEFAULT_UNIT } from './finding-key';
import type { RatingLevel } from './report-utils';

export type Severity = 'good' | 'marginal' | 'significant' | 'minor';
const SEV_RANK: Record<Severity, number> = { significant: 3, marginal: 2, minor: 1, good: 0 };

interface MatrixCell {
    worst: Severity | null;
    counts: { safety: number; recommendation: number; maintenance: number };
}
export interface UnitMatrixRow {
    unitId: string;
    label: string;
    cells: Record<string, MatrixCell>;
    isException: boolean;
}

export function commonFindings(data: Record<string, unknown>): Record<string, unknown> {
    return findingsForUnit(data, DEFAULT_UNIT);
}

function severityOf(rating: string | undefined, levels: RatingLevel[]): Severity | null {
    if (!rating) return null;
    return (levels.find((l) => l.id === rating)?.severity as Severity | undefined) ?? null;
}

export function worstSeverityForUnit(
    unitId: string,
    data: Record<string, unknown>,
    levels: RatingLevel[],
): Severity | null {
    let worst: Severity | null = null;
    for (const v of Object.values(findingsForUnit(data, unitId))) {
        const sev = severityOf((v as { rating?: string }).rating, levels);
        if (sev && (worst === null || SEV_RANK[sev] > SEV_RANK[worst])) worst = sev;
    }
    return worst;
}

export function defectCountsByUnit(
    units: Array<{ id: string; label: string }>,
    data: Record<string, unknown>,
    levels: RatingLevel[],
): Record<string, number> {
    const out: Record<string, number> = {};
    for (const u of units) {
        let n = 0;
        for (const v of Object.values(findingsForUnit(data, u.id))) {
            const lvl = levels.find((l) => l.id === (v as { rating?: string }).rating);
            if (lvl?.isDefect) n++;
        }
        out[u.id] = n;
    }
    return out;
}

function tallyCategories(entry: unknown, cell: MatrixCell): void {
    const e = entry as {
        tabs?: { defects?: Array<{ included?: boolean; category?: string }> };
        customComments?: { defects?: Array<{ included?: boolean; category?: string }> };
    };
    for (const d of [...(e.tabs?.defects ?? []), ...(e.customComments?.defects ?? [])]) {
        if (d.included === false) continue;
        const cat = d.category === 'safety' || d.category === 'maintenance' ? d.category : 'recommendation';
        cell.counts[cat]++;
    }
}

export function buildUnitConditionMatrix(
    units: Array<{ id: string; label: string }>,
    data: Record<string, unknown>,
    levels: RatingLevel[],
    sectionIds: string[],
): UnitMatrixRow[] {
    return units.map((u) => {
        const cells: Record<string, MatrixCell> = {};
        for (const s of sectionIds) cells[s] = { worst: null, counts: { safety: 0, recommendation: 0, maintenance: 0 } };
        for (const [key, entry] of Object.entries(findingsForUnit(data, u.id))) {
            const { sectionId } = parseFindingKey(key);
            const cell = cells[sectionId];
            if (!cell) continue;
            const sev = severityOf((entry as { rating?: string }).rating, levels);
            if (sev && (cell.worst === null || SEV_RANK[sev] > SEV_RANK[cell.worst])) cell.worst = sev;
            tallyCategories(entry, cell);
        }
        const isException = Object.values(cells).some((c) => c.worst === 'significant' || c.counts.safety > 0);
        return { unitId: u.id, label: u.label, cells, isException };
    });
}
