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
import { eq } from 'drizzle-orm';
import { inspections, inspectionResults } from '../lib/db/schema';
import {
    groupInspectionsByMonth,
    summariseHeatmap,
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

    async findingsHeatmap(tenantId: string) {
        const db = this.getDrizzle();
        const rows = await db.select({ data: inspectionResults.data })
            .from(inspectionResults)
            .where(eq(inspectionResults.tenantId, tenantId))
            .all();
        const envelopes = rows.map(r =>
            safeJsonParse<Record<string, HeatmapItem>>(r.data, {}),
        );
        return summariseHeatmap(envelopes);
    }
}
