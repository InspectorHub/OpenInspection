import { eq, and, or, lt, gte, lte, sql, inArray } from 'drizzle-orm';
import { inspections, contactRoleProfiles, inspectionPeople } from '../../lib/db/schema';
import { contacts } from '../../lib/db/schema/contact';
import { PRIMARY_CLIENT_KEY } from '../../lib/people/default-role-profiles';
import { Errors } from '../../lib/errors';
import { escapeLikePattern } from '../../lib/db/like-escape';
import { safeISODate, safeTimestamp } from '../../lib/date';
import { INSPECTION_STATUS } from '../../lib/status/inspection-status';
import { REPORT_STATUS } from '../../lib/status/report-status';
import type { Inspection, InspectionListParams } from './shared';
import { InspectionSubService } from './base';

/**
 * READING MANY inspections: the dashboard list and its status counts.
 *
 * The seam is cardinality. Everything here answers a question about a SET —
 * which inspections match these filters, how many are in each status — and
 * pays for it with cursor pagination, a LEFT JOIN chain for the client name
 * and a batched roster lookup. Reading ONE inspection (`getInspection`,
 * `computePreflight`) stays on the core service, because it is a different
 * problem: it loads the template and the results payload, which no list can
 * afford to do per row.
 *
 * `clientName` comes from the client-role `inspection_people` join, never from
 * `inspections.client_name` — that column survives GDPR erasure as a stale
 * cache. The role filter joins FIRST so the join does not fan out over every
 * role on the inspection.
 */
export class InspectionQueryService extends InspectionSubService {
    /**
     * Lists inspections with pagination and filtering.
     */
    async listInspections(tenantId: string, params: InspectionListParams) {
        const db = this.getDrizzle();
        const conditions = [eq(inspections.tenantId, tenantId)];

        if (params.status) conditions.push(eq(inspections.status, params.status));
        if (params.inspectorId) conditions.push(eq(inspections.inspectorId, params.inspectorId));
        if (params.dateFrom) conditions.push(gte(inspections.date, params.dateFrom));
        if (params.dateTo) conditions.push(lte(inspections.date, params.dateTo));
        
        if (params.search) {
            const term = `%${escapeLikePattern(params.search)}%`;
            conditions.push(or(
                sql`lower(${inspections.propertyAddress}) like lower(${term})`,
                sql`lower(${contacts.name}) like lower(${term})` // primary-client join below, not the frozen legacy inspections.client_name
            )!);
        }

        const tabParam = (params as { tab?: string }).tab;
        if (tabParam && tabParam !== 'all') {
            const todayStr = new Date().toISOString().slice(0, 10);
            switch (tabParam) {
                case 'today':
                    conditions.push(sql`date(${inspections.date}) = ${todayStr}`);
                    break;
                case 'upcoming':
                    conditions.push(sql`${inspections.date} > ${todayStr}`);
                    conditions.push(sql`${inspections.status} not in ('completed','cancelled')`);
                    break;
                case 'past':
                    conditions.push(or(
                        sql`${inspections.date} < ${todayStr}`,
                        inArray(inspections.status, ['completed', 'cancelled'])
                    )!);
                    break;
                // Same two definitions the workspace filters use — one word, one
                // meaning, whichever tier asks.
                case 'needs_confirmation':
                    conditions.push(inArray(inspections.status, [INSPECTION_STATUS.SCHEDULED, INSPECTION_STATUS.REQUESTED]));
                    break;
                case 'awaiting_report':
                    conditions.push(eq(inspections.status, INSPECTION_STATUS.COMPLETED));
                    conditions.push(sql`${inspections.reportStatus} <> ${REPORT_STATUS.PUBLISHED}`);
                    break;
            }
        }

        if (params.cursor) {
            try {
                const c = JSON.parse(atob(params.cursor));
                conditions.push(or(
                    lt(inspections.createdAt, new Date(c.createdAt)),
                    and(eq(inspections.createdAt, new Date(c.createdAt)), lt(inspections.id, c.id))
                )!);
            } catch { throw Errors.BadRequest('Invalid cursor'); }
        }

        // Task 9c (people-role-profiles) — clientName/clientEmail are sourced
        // from the inspection_people primary-client join, not the legacy
        // inspections.client_name/_email columns (frozen cache, dropped Task
        // 13). A single LEFT JOIN keeps this list N+1-free; contact_role_profiles
        // is joined BEFORE inspection_people (filtered to the 'client' role)
        // so the join stays scoped to the primary client, mirroring the join
        // order already used for top-agents in api/metrics.ts.
        // Project the NINE columns `InspectionSchema` publishes, not the row.
        //
        // This used to pass the whole `inspections` table object, which drizzle
        // expands to every column — all seventy-six, including
        // `template_snapshot` (an entire template document), `pca_narrative`,
        // `deviations`, `location_options` and `property_facts`. The response
        // contract declares nine fields; the handler spread the row into it, and
        // TypeScript's structural typing does not object to extra properties, so
        // the list shipped documents nobody asked for on every page.
        const rows = await db.select({
            id:              inspections.id,
            propertyAddress: inspections.propertyAddress,
            status:          inspections.status,
            date:            inspections.date,
            inspectorId:     inspections.inspectorId,
            templateId:      inspections.templateId,
            createdAt:       inspections.createdAt,
            primaryClientName: contacts.name,
            primaryClientEmail: contacts.email,
        })
            .from(inspections)
            .leftJoin(contactRoleProfiles, and(
                eq(contactRoleProfiles.tenantId, inspections.tenantId),
                eq(contactRoleProfiles.key, PRIMARY_CLIENT_KEY),
                eq(contactRoleProfiles.active, true),
            ))
            .leftJoin(inspectionPeople, and(
                eq(inspectionPeople.roleProfileId, contactRoleProfiles.id),
                eq(inspectionPeople.inspectionId, inspections.id),
                eq(inspectionPeople.tenantId, inspections.tenantId),
            ))
            .leftJoin(contacts, and(
                eq(contacts.id, inspectionPeople.contactId),
                eq(contacts.tenantId, inspections.tenantId),
            ))
            .where(and(...conditions))
            .orderBy(sql`${inspections.createdAt} desc, ${inspections.id} desc`)
            .limit(params.limit + 1);

        const hasMore = rows.length > params.limit;
        const page = hasMore ? rows.slice(0, params.limit) : rows;

        let nextCursor: string | null = null;
        if (hasMore) {
            const last = page[page.length - 1];
            nextCursor = btoa(JSON.stringify({ createdAt: safeTimestamp(last.createdAt), id: last.id }));
        }

        const inspectionsFormatted: Inspection[] = page.map((row) => ({
            id: row.id as string,
            propertyAddress: row.propertyAddress as string,
            clientName: row.primaryClientName ?? null,
            clientEmail: row.primaryClientEmail ?? null,
            status: row.status,
            date: row.date as string,
            inspectorId: row.inspectorId as string | null,
            templateId: row.templateId as string | null,
            createdAt: safeISODate(row.createdAt),
        }));

        return { inspections: inspectionsFormatted, nextCursor, hasMore };
    }

    /**
     * Fetches counts for the dashboard.
     */
    async getStats(tenantId: string) {
        const db = this.getDrizzle();
        const counts = await db.select({ status: inspections.status, count: sql<number>`count(*)` })
            .from(inspections)
            .where(eq(inspections.tenantId, tenantId))
            .groupBy(inspections.status);

        const stats = { total: 0, requested: 0, completed: 0, published: 0 };
        for (const row of counts) {
            const n = Number(row.count);
            stats.total += n;
            if (row.status === INSPECTION_STATUS.REQUESTED) stats.requested = n;
            else if (row.status === INSPECTION_STATUS.COMPLETED) stats.completed = n;
        }
        return stats;
    }
}
