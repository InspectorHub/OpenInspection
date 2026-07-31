/**
 * Design System 0520 subsystem E phase 7 — AnalyticsService.
 *
 * Two read endpoints powering the /metrics AnalyticsPanel:
 *   • growth(months)         monthly inspection count for the last N months
 *   • findingsHeatmap()      section × rating bucket counts
 *
 * Pure aggregation logic lives in server/lib/analytics.ts; this class is
 * the DB-aware shim that loads + delegates so the heavy lifting can
 * be unit-tested without a Hono context.
 */
import { drizzle } from 'drizzle-orm/d1';
import { and, eq, gte, lte } from 'drizzle-orm';
import { inspections, inspectionResults, ratingSystems, templates } from '../lib/db/schema';
import { inclusiveUpperBound, type MetricsWindow } from '../lib/metrics-window';
import {
    groupInspectionsByMonth,
    summariseFindings,
    type FindingsMatrix,
    type HeatmapLevel,
    type HeatmapSystem,
    type MonthBucket,
    type HeatmapItem,
} from '../lib/analytics';

function safeJsonParse<T>(raw: unknown, fallback: T): T {
    if (raw == null) return fallback;
    if (typeof raw === 'object') return raw as T;
    if (typeof raw !== 'string') return fallback;
    try { return JSON.parse(raw) as T; } catch { return fallback; }
}

function currentYm(now = new Date()): string {
    const y = now.getUTCFullYear();
    const m = (now.getUTCMonth() + 1).toString().padStart(2, '0');
    return `${y}-${m}`;
}

export class AnalyticsService {
    constructor(private db: D1Database) {}

    private getDrizzle() {
        return drizzle(this.db);
    }

    async growth(tenantId: string, months: number): Promise<{ months: MonthBucket[] }> {
        const db = this.getDrizzle();
        const rows = await db.select({ createdAt: inspections.createdAt })
            .from(inspections)
            .where(eq(inspections.tenantId, tenantId))
            .all();
        const buckets = groupInspectionsByMonth(
            rows.map(r => ({ createdAt: r.createdAt ?? new Date() })),
            currentYm(),
            months,
        );
        return { months: buckets };
    }

    /**
     * Section × rating-level counts for the /metrics findings card.
     *
     * Three reads, because the result envelope alone cannot answer the
     * question (see `summariseFindings`): the envelopes themselves, the
     * tenant's templates (section id → title), and the tenant's rating systems
     * (level id → label/colour). Templates and rating systems are both small,
     * per-tenant tables — the envelopes are the only unbounded read, and
     * `window` bounds them to the range the page is showing.
     *
     * Section titles come from the live templates rather than each inspection's
     * `template_snapshot`: section ids survive the snapshot copy, so the live
     * template resolves the same ids without loading one large JSON blob per
     * inspection. An inspection whose section was since deleted from its
     * template falls into the "Unknown" row.
     *
     * Only the rating systems a template can actually resolve to become columns:
     * the ones templates bind explicitly, plus the tenant default for templates
     * that bind none. A tenant carrying the four seeded systems has ten distinct
     * level labels between them — unioning all four produced a ten-column table
     * where seven columns could never hold a count, because no template in the
     * tenant uses those systems. Same rule the editor applies when it decides
     * which levels an inspector may pick.
     */
    async findingsHeatmap(tenantId: string, window?: MetricsWindow): Promise<FindingsMatrix> {
        const db = this.getDrizzle();

        const resultRows = await db.select({ data: inspectionResults.data })
            .from(inspectionResults)
            .innerJoin(inspections, and(
                eq(inspections.id, inspectionResults.inspectionId),
                eq(inspections.tenantId, inspectionResults.tenantId),
            ))
            .where(window
                ? and(
                    eq(inspectionResults.tenantId, tenantId),
                    gte(inspections.date, window.from),
                    lte(inspections.date, inclusiveUpperBound(window.to)),
                )
                : eq(inspectionResults.tenantId, tenantId))
            .all();

        const templateRows = await db.select({ schema: templates.schema, ratingSystemId: templates.ratingSystemId })
            .from(templates)
            .where(eq(templates.tenantId, tenantId))
            .all();

        const ratingRows = await db.select({ id: ratingSystems.id, name: ratingSystems.name, isDefault: ratingSystems.isDefault, levels: ratingSystems.levels })
            .from(ratingSystems)
            .where(eq(ratingSystems.tenantId, tenantId))
            .all();

        const boundSystemIds = new Set(
            templateRows.map(t => t.ratingSystemId).filter((id): id is string => typeof id === 'string' && id.length > 0),
        );
        const usesTenantDefault = templateRows.some(t => !t.ratingSystemId);

        const sectionTitles: Record<string, string> = {};
        for (const row of templateRows) {
            const schema = safeJsonParse<{ sections?: Array<{ id?: unknown; title?: unknown; name?: unknown }> }>(row.schema, {});
            for (const section of schema.sections ?? []) {
                const id = typeof section?.id === 'string' ? section.id : '';
                const title = typeof section?.title === 'string' && section.title
                    ? section.title
                    : typeof section?.name === 'string' ? section.name : '';
                if (id && title) sectionTitles[id] ??= title;
            }
        }

        const systems: HeatmapSystem[] = [];
        for (const row of ratingRows) {
            const inUse = boundSystemIds.has(row.id) || (usesTenantDefault && row.isDefault);
            if (!inUse) continue;
            const levels: HeatmapLevel[] = [];
            for (const level of safeJsonParse<HeatmapLevel[]>(row.levels, [])) {
                if (level && typeof level.id === 'string' && typeof level.label === 'string') {
                    levels.push({ ...level, abbreviation: level.abbreviation ?? '' });
                }
            }
            if (levels.length > 0) systems.push({ id: row.id, name: row.name, levels });
        }

        const envelopes = resultRows.map(r =>
            safeJsonParse<Record<string, HeatmapItem>>(r.data, {}),
        );
        return summariseFindings(envelopes, { sectionTitles, systems });
    }
}
