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
import { and, eq, gte } from 'drizzle-orm';
import { inspections, inspectionResults, ratingSystems, templates } from '../lib/db/schema';
import {
    groupInspectionsByMonth,
    summariseFindings,
    type FindingsMatrix,
    type HeatmapLevel,
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
     * `fromDate` bounds them to the requested window.
     *
     * Section titles come from the live templates rather than each inspection's
     * `template_snapshot`: section ids survive the snapshot copy, so the live
     * template resolves the same ids without loading one large JSON blob per
     * inspection. An inspection whose section was since deleted from its
     * template falls into the "Unknown" row.
     */
    async findingsHeatmap(tenantId: string, fromDate?: string): Promise<FindingsMatrix> {
        const db = this.getDrizzle();

        const resultRows = await db.select({ data: inspectionResults.data })
            .from(inspectionResults)
            .innerJoin(inspections, and(
                eq(inspections.id, inspectionResults.inspectionId),
                eq(inspections.tenantId, inspectionResults.tenantId),
            ))
            .where(fromDate
                ? and(eq(inspectionResults.tenantId, tenantId), gte(inspections.date, fromDate))
                : eq(inspectionResults.tenantId, tenantId))
            .all();

        const templateRows = await db.select({ schema: templates.schema })
            .from(templates)
            .where(eq(templates.tenantId, tenantId))
            .all();

        const ratingRows = await db.select({ levels: ratingSystems.levels })
            .from(ratingSystems)
            .where(eq(ratingSystems.tenantId, tenantId))
            .all();

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

        const levels: HeatmapLevel[] = [];
        for (const row of ratingRows) {
            for (const level of safeJsonParse<HeatmapLevel[]>(row.levels, [])) {
                if (level && typeof level.id === 'string' && typeof level.label === 'string') {
                    levels.push({ ...level, abbreviation: level.abbreviation ?? '' });
                }
            }
        }

        const envelopes = resultRows.map(r =>
            safeJsonParse<Record<string, HeatmapItem>>(r.data, {}),
        );
        return summariseFindings(envelopes, { sectionTitles, levels });
    }
}
