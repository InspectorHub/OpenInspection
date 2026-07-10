import type { RatingLevel } from './report-utils';

/**
 * Sprint 2 S2-1 — Translate a rating_systems.levels[] payload into the
 * `RatingLevel` shape consumed by computeReportStats / getRatingColor.
 *
 * Post module-F (2026-07): `rating_systems.levels` stores the canonical
 * `{ abbreviation, severity, isDefect, pausesAdvance }` shape directly —
 * no bucket→severity translation. Unknown/legacy `severity` values fall
 * back to 'minor' so a stale row never crashes the mapper.
 *
 * B-18: `pausesAdvance` is passed through — dropping it here silently killed
 * the seeds' "Defect/Monitor stop for notes" behaviour, because the editor
 * only ever sees this mapped shape.
 */
export function mapRatingSystemLevels(levels: Array<Record<string, unknown>>): RatingLevel[] {
    const CANON = new Set(['good', 'marginal', 'significant', 'minor']);
    return levels
        .slice()
        .sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0))
        .map((lvl) => {
            const severity = (CANON.has(String(lvl.severity)) ? lvl.severity : 'minor') as RatingLevel['severity'];
            const id = String(lvl.id ?? lvl.label ?? lvl.abbreviation ?? crypto.randomUUID());
            return {
                id,
                label:        String(lvl.label ?? lvl.abbreviation ?? id),
                abbreviation: String(lvl.abbreviation ?? lvl.label ?? id),
                color:        String(lvl.color ?? '#9ca3af'),
                severity,
                isDefect:     lvl.isDefect === true || severity === 'significant',
                ...(typeof lvl.description === 'string' ? { description: lvl.description } : {}),
                ...(typeof lvl.pausesAdvance === 'boolean' ? { pausesAdvance: lvl.pausesAdvance } : {}),
            };
        });
}
