import { drizzle } from 'drizzle-orm/d1';
import { eq, and, or, lt, gte, lte, sql } from 'drizzle-orm';
import { inspections, inspectionResults, templates, inspectionAgreements } from '../lib/db/schema';
import { Errors } from '../lib/errors';
import { z } from 'zod';
import { InspectionSchema, InspectionListQuerySchema, CreateInspectionSchema } from '../lib/validations/inspection.schema';

import { ScopedDB } from '../lib/db/scoped';
import { safeISODate, safeTimestamp } from '../lib/date';

type Inspection = z.infer<typeof InspectionSchema>;
type InspectionListParams = z.infer<typeof InspectionListQuerySchema>;
type CreateInspectionData = z.infer<typeof CreateInspectionSchema>;

/**
 * Service to handle all inspection-related business logic.
 */
export class InspectionService {
    constructor(private db: D1Database, private r2?: R2Bucket, private sdb?: ScopedDB) {}

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
            templateId: data.templateId,
            status,
            date,
            referredByAgentId: (data.referredByAgentId as string | null) || null,
            createdAt
        };

        await this.sdb.insert(inspections, newInspection);

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
}
