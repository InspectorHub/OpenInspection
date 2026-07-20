/**
 * Round-2 backlog #2 — Dashboard preferences service (Spectora §5.1 / §E.7).
 *
 * Owns the per-tenant dashboard column visibility default. Stored as a JSON
 * array of column ids on `tenant_configs.dashboard_column_prefs`.
 *
 * The CLIENT keeps its own copy in localStorage (`oi.dashboard.columns`) —
 * that user-level override always wins on the dashboard. The tenant value
 * served by this service acts as the seed for new users on a brand-new
 * device, so admins can ship a sensible default to their team.
 *
 * Validation lives in server/lib/dashboard-columns.ts: every read is normalised
 * through `normalizeDashboardColumns()` so unknown / removed ids drop safely
 * without breaking older data.
 */

import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { tenantConfigs } from '../lib/db/schema';
import {
    DEFAULT_DASHBOARD_COLUMNS,
    normalizeDashboardColumns,
} from '../lib/dashboard-columns';

export class DashboardPrefsService {
    constructor(private db: D1Database) {}

    private getDrizzle() {
        return drizzle(this.db);
    }

    /**
     * Returns the tenant default column id list. Falls back to the registry
     * default-on set when the tenant has no row, no value, or has stored an
     * invalid blob (e.g. ids removed in a later release).
     */
    async getColumnPrefs(tenantId: string): Promise<string[]> {
        const db = this.getDrizzle();
        const row = await db
            .select({ prefs: tenantConfigs.dashboardColumnPrefs })
            .from(tenantConfigs)
            .where(eq(tenantConfigs.tenantId, tenantId))
            .limit(1);

        if (!row[0] || !row[0].prefs) {
            return [...DEFAULT_DASHBOARD_COLUMNS];
        }
        return normalizeDashboardColumns(row[0].prefs);
    }

    /**
     * Writes the tenant default. The caller (an OpenAPI route guarded by
     * `requireRole('owner','manager')`) is responsible for permission checks.
     * Performs an upsert against `tenant_configs`.
     */
    async setColumnPrefs(tenantId: string, columns: string[]): Promise<string[]> {
        const normalized = normalizeDashboardColumns(columns);
        const db = this.getDrizzle();

        const existing = await db
            .select({ tenantId: tenantConfigs.tenantId })
            .from(tenantConfigs)
            .where(eq(tenantConfigs.tenantId, tenantId))
            .limit(1);

        if (existing.length === 0) {
            await db.insert(tenantConfigs).values({
                tenantId,
                dashboardColumnPrefs: normalized,
                updatedAt: new Date(),
            });
        } else {
            await db
                .update(tenantConfigs)
                .set({ dashboardColumnPrefs: normalized, updatedAt: new Date() })
                .where(eq(tenantConfigs.tenantId, tenantId));
        }
        return normalized;
    }
}
