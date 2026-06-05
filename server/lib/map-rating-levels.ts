import type { RatingLevel } from './report-utils';

/**
 * Sprint 2 S2-1 — Translate a rating_systems.levels[] payload into the
 * legacy `RatingLevel` shape consumed by computeReportStats / getRatingColor.
 *
 *   `bucket: 'satisfactory'` → severity: 'good'  / isDefect: false
 *   `bucket: 'monitor'`      → severity: 'marginal' / isDefect: false
 *   `bucket: 'defect'`       → severity: 'significant' / isDefect: true
 *   `bucket: 'na'`           → severity: 'minor' / isDefect: false
 *
 * B-18: `pausesAdvance` is passed through — dropping it here silently killed
 * the seeds' "Defect/Monitor stop for notes" behaviour, because the editor
 * only ever sees this mapped shape.
 */
export function mapRatingSystemLevels(levels: Array<Record<string, unknown>>): RatingLevel[] {
    const sevByBucket: Record<string, RatingLevel['severity']> = {
        satisfactory: 'good',
        monitor:      'marginal',
        defect:       'significant',
        na:           'minor',
    };
    return levels
        .slice()
        .sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0))
        .map((lvl) => {
            const bucket = String(lvl.bucket ?? 'na');
            const severity = sevByBucket[bucket] ?? 'minor';
            const id = String(lvl.id ?? lvl.label ?? lvl.abbr ?? crypto.randomUUID());
            return {
                id,
                label:        String(lvl.label ?? lvl.abbr ?? id),
                abbreviation: String(lvl.abbr ?? lvl.label ?? id),
                color:        String(lvl.color ?? '#9ca3af'),
                severity,
                isDefect:     bucket === 'defect',
                ...(typeof lvl.description === 'string' ? { description: lvl.description } : {}),
                ...(typeof lvl.pausesAdvance === 'boolean' ? { pausesAdvance: lvl.pausesAdvance } : {}),
            };
        });
}
