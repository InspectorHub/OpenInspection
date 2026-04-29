import { drizzle } from 'drizzle-orm/d1';
import { eq, and, or, lt, gte, lte, sql, inArray } from 'drizzle-orm';
import { inspections, inspectionResults, templates, inspectionAgreements, users, services, inspectionServices } from '../lib/db/schema';
import { Errors } from '../lib/errors';
import { computeReportStats, getRatingColor, getRatingBucket, type RatingLevel } from '../lib/report-utils';
import { z } from 'zod';
import { InspectionSchema, InspectionListQuerySchema, CreateInspectionSchema } from '../lib/validations/inspection.schema';

import { ScopedDB } from '../lib/db/scoped';
import { safeISODate, safeTimestamp } from '../lib/date';
import { AutomationService } from './automation.service';
import { logger } from '../lib/logger';

function fireAutomation(db: D1Database, tenantId: string, inspectionId: string, event: string): void {
    new AutomationService(db)
        .trigger({ tenantId, inspectionId, triggerEvent: event, companyName: '', reportBaseUrl: '' })
        .catch(err => logger.error('automation trigger failed', { event }, err instanceof Error ? err : undefined));
}

type Inspection = z.infer<typeof InspectionSchema>;
type InspectionListParams = z.infer<typeof InspectionListQuerySchema>;
type CreateInspectionData = z.infer<typeof CreateInspectionSchema>;

/**
 * Service to handle all inspection-related business logic.
 */
export class InspectionService {
    constructor(private db: D1Database, private r2?: R2Bucket, private sdb?: ScopedDB, private kv?: KVNamespace) {}

    private getDrizzle() {
        return drizzle(this.db);
    }

    /**
     * Lists inspections with pagination and filtering.
     */
    async listInspections(tenantId: string, params: InspectionListParams) {
        const db = this.getDrizzle();
        const conditions = [eq(inspections.tenantId, tenantId)];

        if (params.status) conditions.push(eq(inspections.status, params.status as 'draft' | 'completed' | 'delivered'));
        if (params.inspectorId) conditions.push(eq(inspections.inspectorId, params.inspectorId));
        if (params.dateFrom) conditions.push(gte(inspections.date, params.dateFrom));
        if (params.dateTo) conditions.push(lte(inspections.date, params.dateTo));
        
        if (params.search) {
            const term = `%${params.search}%`;
            conditions.push(or(
                sql`lower(${inspections.propertyAddress}) like lower(${term})`,
                sql`lower(${inspections.clientName}) like lower(${term})`
            )!);
        }

        if ((params as any).tab && (params as any).tab !== 'all') {
            const todayStr = new Date().toISOString().slice(0, 10);
            const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
            switch ((params as any).tab) {
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
                case 'unconfirmed':
                    conditions.push(eq(inspections.status, 'scheduled' as any));
                    conditions.push(sql`${inspections.createdAt} < ${cutoff}`);
                    break;
                case 'in_progress':
                    conditions.push(eq(inspections.status, 'in_progress' as any));
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

        const rows = await db.select().from(inspections)
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

        const inspectionsFormatted: Inspection[] = page.map(row => ({
            ...row,
            id: row.id as string,
            propertyAddress: row.propertyAddress as string,
            clientName: row.clientName as string | null,
            clientEmail: row.clientEmail as string | null,
            status: row.status as 'draft' | 'completed' | 'delivered',
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

        const stats = { total: 0, draft: 0, completed: 0, delivered: 0 };
        for (const row of counts) {
            const n = Number(row.count);
            stats.total += n;
            if (row.status === 'draft') stats.draft = n;
            else if (row.status === 'completed') stats.completed = n;
            else if (row.status === 'delivered') stats.delivered = n;
        }
        return stats;
    }

    /**
     * Fetches a single inspection with its template.
     */
    async getInspection(id: string, tenantId: string) {
        if (!this.sdb) throw new Error('ScopedDB session missing');

        const result = await this.sdb.getById(inspections, id);
        if (!result) throw Errors.NotFound('Inspection not found');

        const template = result.templateId
            ? await this.sdb.getById(templates, result.templateId as string)
            : null;
        const signed = await this.sdb.raw.select().from(inspectionAgreements)
            .where(and(eq(inspectionAgreements.inspectionId, id), eq(inspectionAgreements.tenantId, tenantId)))
            .get();

        return {
            inspection: {
                ...result,
                id: result.id as string,
                propertyAddress: result.propertyAddress as string,
                clientName: result.clientName as string | null,
                clientEmail: result.clientEmail as string | null,
                status: result.status as 'draft' | 'completed' | 'delivered',
                date: result.date as string,
                inspectorId: result.inspectorId as string | null,
                templateId: result.templateId as string | null,
                createdAt: safeISODate(result.createdAt),
                signedByClient: !!signed
            },
            template: template || null
        };
    }

    /**
     * Creates a new inspection.
     */
    async createInspection(tenantId: string, data: CreateInspectionData & { inspectorId?: string }): Promise<Inspection> {
        if (!this.sdb) throw new Error('ScopedDB session missing');
        const id = crypto.randomUUID();
        const createdAt = new Date();
        const status = 'draft' as const;
        const date = data.date || createdAt.toISOString();

        const newInspection = {
            id,
            tenantId,
            inspectorId: data.inspectorId || null,
            propertyAddress: data.propertyAddress,
            clientName: data.clientName || 'Private Client',
            clientEmail: (data.clientEmail as string | null) || null,
            clientPhone: data.clientPhone ?? null,
            templateId: data.templateId,
            status,
            date,
            referredByAgentId: (data.referredByAgentId as string | null) || null,
            createdAt
        };

        await this.sdb.insert(inspections, newInspection);
        fireAutomation(this.db, tenantId, id, 'inspection.created');

        // Link selected services
        if (data.serviceIds && data.serviceIds.length > 0) {
            const db2 = this.getDrizzle();
            const svcRows = await db2.select().from(services)
                .where(and(eq(services.tenantId, tenantId), inArray(services.id, data.serviceIds)));
            if (svcRows.length > 0) {
                await db2.insert(inspectionServices).values(svcRows.map(s => ({
                    id:            crypto.randomUUID(),
                    tenantId,
                    inspectionId:  id,
                    serviceId:     s.id,
                    priceOverride: null,
                    nameSnapshot:  s.name,
                    priceSnapshot: s.price,
                })));
            }
        }

        return {
            ...newInspection,
            clientEmail: newInspection.clientEmail as string | null,
            inspectorId: newInspection.inspectorId as string | null,
            createdAt: safeISODate(newInspection.createdAt)
        } as Inspection;
    }

    /**
     * Clones an existing inspection.
     */
    async cloneInspection(id: string, tenantId: string): Promise<Inspection> {
        const { inspection: source } = await this.getInspection(id, tenantId);

        const clone = {
            ...source,
            id: crypto.randomUUID(),
            tenantId,
            date: new Date().toISOString(),
            status: 'draft' as const,
            paymentStatus: 'unpaid' as const,
            createdAt: new Date(),
        };
        delete (clone as { signedByClient?: boolean }).signedByClient; // Remove ephemeral field

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await this.getDrizzle().insert(inspections).values(clone as any);

        return {
            ...clone,
            createdAt: safeISODate(clone.createdAt)
        };
    }

    /**
     * Updates an inspection's results.
     */
    async updateResults(id: string, tenantId: string, data: Record<string, unknown>) {
        const db = this.getDrizzle();
        const inspection = await db.select().from(inspections)
            .where(and(eq(inspections.id, id), eq(inspections.tenantId, tenantId)))
            .get();
        if (!inspection) {
            throw Errors.NotFound('Inspection not found or access denied');
        }

        const existing = await db.select().from(inspectionResults).where(and(eq(inspectionResults.inspectionId, id), eq(inspectionResults.tenantId, tenantId))).get();

        if (existing) {
            const mergedData = { ...(existing.data as Record<string, unknown>), ...data };
            await db.update(inspectionResults).set({ data: mergedData, lastSyncedAt: new Date() }).where(eq(inspectionResults.id, existing.id));
        } else {
            const insertValues = {
                id: crypto.randomUUID(),
                inspectionId: id,
                tenantId,
                data,
                lastSyncedAt: new Date()
            };
            await db.insert(inspectionResults).values(insertValues);
        }
    }

    /**
     * Multi-photo upload to R2.
     */
    async uploadPhoto(id: string, tenantId: string, itemId: string, file: File) {
        if (!this.r2) throw Errors.BadRequest('Storage not available');
        await this.getInspection(id, tenantId); // Ownership check

        const key = `${tenantId}/${id}/${itemId}_${crypto.randomUUID()}_${file.name}`;
        await this.r2.put(key, await file.arrayBuffer(), {
            httpMetadata: { contentType: file.type }
        });
        return key;
    }

    /**
     * Builds structured report data for a given inspection.
     */
    async getReportData(inspectionId: string, tenantId: string) {
        const db = this.getDrizzle();

        const inspection = await db.select().from(inspections)
            .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)))
            .get();
        if (!inspection) throw Errors.NotFound('Inspection not found');

        const template = inspection.templateId
            ? await db.select().from(templates).where(and(eq(templates.id, inspection.templateId), eq(templates.tenantId, tenantId))).get()
            : null;
        const resultsRow = await db.select().from(inspectionResults)
            .where(and(eq(inspectionResults.inspectionId, inspectionId), eq(inspectionResults.tenantId, tenantId)))
            .get();

        interface SchemaItem { id: string; label: string; icon?: string }
        interface SchemaSection { id: string; title: string; icon?: string; items: SchemaItem[] }
        interface SchemaData { sections: SchemaSection[]; ratingSystem?: { levels: RatingLevel[] } }
        interface ResultEntry { rating?: string; notes?: string; photos?: { key: string }[]; recommendation?: string; estimateMin?: number; estimateMax?: number }

        const rawSchema = template?.schema
            ? (typeof template.schema === 'string' ? JSON.parse(template.schema) : template.schema)
            : { sections: [] };
        // Support both formats: { sections: [...] } and flat array of items
        const schemaData: SchemaData = Array.isArray(rawSchema)
            ? { sections: [{ id: 'general', title: 'General', items: rawSchema }] }
            : (rawSchema as SchemaData).sections ? rawSchema as SchemaData : { sections: [] };

        const levels: RatingLevel[] = schemaData.ratingSystem?.levels ?? [];
        const resultData: Record<string, ResultEntry> = resultsRow?.data
            ? (typeof resultsRow.data === 'string' ? JSON.parse(resultsRow.data) : resultsRow.data) as Record<string, ResultEntry>
            : {};

        const stats = computeReportStats(schemaData.sections, resultData, levels);

        const sections = schemaData.sections.map((sec: SchemaSection) => ({
            id: sec.id,
            title: sec.title || (sec as unknown as Record<string, string>).name || 'Untitled',
            icon: sec.icon ?? null,
            defectCount: stats.sectionDefects[sec.id] ?? 0,
            items: sec.items.map((item: SchemaItem) => {
                const res = resultData[item.id] || {};
                const ratingId = res.rating ?? null;
                const bucket = getRatingBucket(ratingId, levels);
                const level = levels.find((l: RatingLevel) => l.id === ratingId);

                const photos = (res.photos || []).map((p: { key: string }) => ({
                    key: p.key,
                    url: `/api/inspections/${inspectionId}/photos/${encodeURIComponent(p.key)}`,
                }));

                return {
                    id: item.id,
                    label: item.label || (item as unknown as Record<string, string>).name || 'Untitled',
                    rating: ratingId,
                    ratingColor: getRatingColor(ratingId, levels),
                    ratingLabel: level?.label ?? ratingId,
                    severityBucket: bucket,
                    notes: res.notes ?? null,
                    photos,
                    recommendation: res.recommendation ?? null,
                    estimateMin: res.estimateMin ?? null,
                    estimateMax: res.estimateMax ?? null,
                };
            }),
        }));

        let inspectorName: string | null = null;
        if (inspection.inspectorId) {
            const inspector = await db.select({ name: users.name, email: users.email })
                .from(users).where(eq(users.id, inspection.inspectorId)).get();
            inspectorName = inspector?.name || (inspector?.email?.split('@')[0] ?? null);
        }

        return {
            inspection: { ...inspection, inspectorName },
            theme: 'modern' as const,
            stats: { total: stats.total, satisfactory: stats.satisfactory, monitor: stats.monitor, defect: stats.defect },
            sections,
            ratingLevels: levels.length > 0 ? levels : [
                { id: 'Satisfactory', label: 'Satisfactory', abbreviation: 'SAT', color: '#22c55e', severity: 'good', isDefect: false },
                { id: 'Monitor', label: 'Monitor', abbreviation: 'MON', color: '#f59e0b', severity: 'marginal', isDefect: false },
                { id: 'Defect', label: 'Defect', abbreviation: 'DEF', color: '#f43f5e', severity: 'significant', isDefect: true },
                { id: 'Not Inspected', label: 'Not Inspected', abbreviation: 'NI', color: '#3b82f6', severity: 'minor', isDefect: false },
            ],
        };
    }

    /**
     * Returns tab counts for the inspection list UI.
     * Single query with 6 conditional aggregates to avoid N+1.
     */
    async getCounts(tenantId: string): Promise<{
        all: number; today: number; upcoming: number;
        past: number; unconfirmed: number; inProgress: number;
    }> {
        const db = this.getDrizzle();
        const todayStr = new Date().toISOString().slice(0, 10);
        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

        const result = await db.select({
            all:         sql<number>`count(*)`,
            today:       sql<number>`sum(case when date(${inspections.date}) = ${todayStr} then 1 else 0 end)`,
            upcoming:    sql<number>`sum(case when ${inspections.date} > ${todayStr} and ${inspections.status} not in ('completed','cancelled') then 1 else 0 end)`,
            past:        sql<number>`sum(case when ${inspections.date} < ${todayStr} or ${inspections.status} in ('completed','cancelled') then 1 else 0 end)`,
            unconfirmed: sql<number>`sum(case when ${inspections.status} = 'scheduled' and ${inspections.createdAt} < ${cutoff} then 1 else 0 end)`,
            inProgress:  sql<number>`sum(case when ${inspections.status} = 'in_progress' then 1 else 0 end)`,
        }).from(inspections).where(eq(inspections.tenantId, tenantId));

        const row = result[0] ?? {};
        return {
            all:         Number(row.all ?? 0),
            today:       Number(row.today ?? 0),
            upcoming:    Number(row.upcoming ?? 0),
            past:        Number(row.past ?? 0),
            unconfirmed: Number(row.unconfirmed ?? 0),
            inProgress:  Number(row.inProgress ?? 0),
        };
    }

    /**
     * Publishes an inspection report (transitions to delivered status).
     */
    async publishInspection(inspectionId: string, tenantId: string, _options: {
        theme: string;
        notifyClient: boolean;
        notifyAgent: boolean;
        requireSignature: boolean;
        requirePayment: boolean;
    }) {
        const db = this.getDrizzle();

        const inspection = await db.select().from(inspections)
            .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)))
            .get();
        if (!inspection) throw Errors.NotFound('Inspection not found');
        if (inspection.status === 'delivered') throw Errors.BadRequest('Inspection is already published');

        await db.update(inspections)
            .set({ status: 'delivered' })
            .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)));
        fireAutomation(this.db, tenantId, inspectionId, 'report.published');

        return {
            reportUrl: `/report/${inspectionId}`,
            status: 'delivered',
        };
    }

    /**
     * Fetches an inspection row by id+tenantId, throwing NotFound if missing.
     */
    private async fetchForStatusChange(tenantId: string, id: string) {
        const db = this.getDrizzle();
        const rows = await db.select().from(inspections)
            .where(and(eq(inspections.id, id), eq(inspections.tenantId, tenantId))).limit(1);
        if (!rows[0]) throw Errors.NotFound('Inspection not found');
        return { db, inspection: rows[0] };
    }

    async confirmInspection(tenantId: string, id: string): Promise<void> {
        const { db, inspection } = await this.fetchForStatusChange(tenantId, id);
        if (inspection.status === 'cancelled') throw Errors.BadRequest('Cannot confirm a cancelled inspection');
        await db.update(inspections).set({
            status:      'confirmed' as any,
            confirmedAt: new Date().toISOString(),
        }).where(and(eq(inspections.id, id), eq(inspections.tenantId, tenantId)));
        fireAutomation(this.db, tenantId, id, 'inspection.confirmed');
    }

    async cancelInspection(tenantId: string, id: string, reason: string, notes?: string): Promise<void> {
        const { db } = await this.fetchForStatusChange(tenantId, id);
        const cancelNote = notes ? `${reason}: ${notes}` : reason;
        await db.update(inspections).set({
            status:       'cancelled' as any,
            cancelReason: cancelNote,
        }).where(and(eq(inspections.id, id), eq(inspections.tenantId, tenantId)));
        fireAutomation(this.db, tenantId, id, 'inspection.cancelled');
    }

    async uncancelInspection(tenantId: string, id: string): Promise<void> {
        const { db, inspection } = await this.fetchForStatusChange(tenantId, id);
        if (inspection.status !== 'cancelled') throw Errors.BadRequest('Inspection is not cancelled');
        await db.update(inspections).set({
            status:       'scheduled' as any,
            cancelReason: null,
        }).where(and(eq(inspections.id, id), eq(inspections.tenantId, tenantId)));
    }

    /**
     * Generates a 30-day shareable agent view token stored in KV.
     * The token grants read-only access to the report without requiring login.
     */
    async generateAgentViewToken(tenantId: string, inspectionId: string): Promise<string> {
        const db = this.getDrizzle();
        const rows = await db.select({ id: inspections.id })
            .from(inspections)
            .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)))
            .limit(1);
        if (!rows[0]) throw Errors.NotFound('Inspection not found');
        if (!this.kv) throw Errors.Internal('KV not available');

        const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
        await this.kv.put(`agent_view_token:${token}`, `${inspectionId}:${tenantId}`, {
            expirationTtl: 30 * 24 * 60 * 60,
        });
        return token;
    }

    /**
     * Resolves an agent view token from KV.
     */
    async resolveAgentViewToken(token: string): Promise<{ inspectionId: string; tenantId: string } | null> {
        if (!this.kv) return null;
        const val = await this.kv.get(`agent_view_token:${token}`);
        if (!val) return null;
        const [inspectionId, tenantId] = val.split(':');
        return { inspectionId, tenantId };
    }
}
