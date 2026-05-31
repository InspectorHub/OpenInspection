/**
 * Sprint 2 S2-2 — Inspection Request service.
 *
 * Owns the lifecycle of `inspection_requests` (parent) and the N inspections
 * (children) that share a property + schedule. All queries filter by
 * `tenantId` per the multi-tenant rules in CLAUDE.md.
 */

import { drizzle } from 'drizzle-orm/d1';
import { and, eq, gte, lte, inArray, desc } from 'drizzle-orm';
import {
    inspectionRequests,
    inspections,
    templates,
} from '../lib/db/schema';
import { Errors } from '../lib/errors';
import { safeISODate } from '../lib/date';
import { logger } from '../lib/logger';

export interface CreateRequestInput {
    clientName:      string;
    clientEmail?:    string | null;
    clientPhone?:    string | null;
    propertyAddress: string;
    propertyCity?:   string | null;
    propertyState?:  string | null;
    propertyZip?:    string | null;
    scheduledAt:     string;
    notes?:          string | null;
    inspectorId?:    string | null;
    // UC-A-1 — agent referral attribution. Resolved upstream from
    // `?ref=<agentSlug>` to a contacts.id; copied onto every child
    // inspection so dashboards + emails can credit the agent.
    referredByAgentId?: string | null;
}

export interface CreateSubInspectionInput {
    templateId: string;
    price?:     number;
    notes?:     string | null;
}

export interface UpdateRequestInput {
    clientName?:      string;
    clientEmail?:     string | null;
    clientPhone?:     string | null;
    propertyAddress?: string;
    propertyCity?:    string | null;
    propertyState?:   string | null;
    propertyZip?:     string | null;
    scheduledAt?:     string;
    notes?:           string | null;
    status?:          'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled';
    paymentStatus?:   'unpaid' | 'partial' | 'paid';
    totalAmount?:     number;
}

interface ListFilter {
    status?: 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled';
    from?:   string;
    to?:     string;
    limit?:  number;
    offset?: number;
}

type SubInspectionRow = {
    id:              string;
    templateId:      string | null;
    propertyAddress: string;
    clientName:      string | null;
    status:          string;
    date:            string;
    price:           number;
    inspectorId:     string | null;
    requestId:       string | null;
};

type RequestRow = typeof inspectionRequests.$inferSelect;

export class InspectionRequestService {
    constructor(private db: D1Database) {}

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private getDrizzle() { return drizzle(this.db as any); }

    /**
     * List parent requests for the tenant, eager-loading child inspections.
     * Filters can narrow by status / date window. Pagination is offset-based
     * (offset/limit) — cursor pagination not needed at this scale.
     */
    async list(tenantId: string, filter: ListFilter = {}) {
        const db = this.getDrizzle();
        const conds = [eq(inspectionRequests.tenantId, tenantId)];
        if (filter.status) conds.push(eq(inspectionRequests.status, filter.status));
        if (filter.from)   conds.push(gte(inspectionRequests.scheduledAt, filter.from));
        if (filter.to)     conds.push(lte(inspectionRequests.scheduledAt, filter.to));

        const limit  = filter.limit  ?? 50;
        const offset = filter.offset ?? 0;

        const reqs = await db.select().from(inspectionRequests)
            .where(and(...conds))
            .orderBy(desc(inspectionRequests.scheduledAt))
            .limit(limit)
            .offset(offset)
            .all();

        const reqIds = reqs.map(r => r.id);
        const subRows: SubInspectionRow[] = reqIds.length === 0 ? [] : await db.select({
            id:              inspections.id,
            templateId:      inspections.templateId,
            propertyAddress: inspections.propertyAddress,
            clientName:      inspections.clientName,
            status:          inspections.status,
            date:            inspections.date,
            price:           inspections.price,
            inspectorId:     inspections.inspectorId,
            requestId:       inspections.requestId,
        }).from(inspections)
            .where(and(eq(inspections.tenantId, tenantId), inArray(inspections.requestId, reqIds)))
            .all();

        return reqs.map(r => this.shapeRequest(r, subRows.filter(s => s.requestId === r.id)));
    }

    /**
     * Fetch a single parent request with its children (tenant-scoped).
     * Returns null when not found. Resolves child template names so callers
     * (e.g. the inspection-edit request switcher) can render readable chips
     * without an extra round-trip.
     */
    async get(tenantId: string, id: string) {
        const db = this.getDrizzle();
        const req = await db.select().from(inspectionRequests)
            .where(and(eq(inspectionRequests.id, id), eq(inspectionRequests.tenantId, tenantId)))
            .get();
        if (!req) return null;

        const subs: SubInspectionRow[] = await db.select({
            id:              inspections.id,
            templateId:      inspections.templateId,
            propertyAddress: inspections.propertyAddress,
            clientName:      inspections.clientName,
            status:          inspections.status,
            date:            inspections.date,
            price:           inspections.price,
            inspectorId:     inspections.inspectorId,
            requestId:       inspections.requestId,
        }).from(inspections)
            .where(and(eq(inspections.tenantId, tenantId), eq(inspections.requestId, id)))
            .all();

        const tplIds = Array.from(new Set(subs.map(s => s.templateId).filter((x): x is string => !!x)));
        const tplNameById = new Map<string, string>();
        if (tplIds.length > 0) {
            const tplRows = await db.select({ id: templates.id, name: templates.name })
                .from(templates)
                .where(and(eq(templates.tenantId, tenantId), inArray(templates.id, tplIds)))
                .all();
            for (const t of tplRows) tplNameById.set(t.id, t.name);
        }

        return this.shapeRequest(req, subs, tplNameById);
    }

    /**
     * Resolve the parent request (if any) for an inspection. Used by
     * inspection-edit and the sub-route shell to render the request switcher.
     */
    async getByInspectionId(tenantId: string, inspectionId: string) {
        const db = this.getDrizzle();
        const insp = await db.select({ requestId: inspections.requestId })
            .from(inspections)
            .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)))
            .get();
        if (!insp || !insp.requestId) return null;
        return this.get(tenantId, insp.requestId);
    }

    /**
     * Create a request and N child inspections in one logical step.
     * D1 batches are not exposed via Drizzle; we do sequential inserts and
     * rely on the calling transaction model (Cloudflare D1 auto-commit).
     */
    async create(tenantId: string, input: CreateRequestInput, subs: CreateSubInspectionInput[]) {
        if (subs.length === 0) throw Errors.BadRequest('At least one sub-inspection is required');
        if (subs.length > 10)  throw Errors.BadRequest('A request cannot exceed 10 inspections');

        const db = this.getDrizzle();
        const requestId = crypto.randomUUID();
        const now = new Date();

        // Validate all referenced templates belong to this tenant before any insert.
        const templateIds = Array.from(new Set(subs.map(s => s.templateId)));
        const tplRows = await db.select({ id: templates.id, version: templates.version, schema: templates.schema })
            .from(templates)
            .where(and(eq(templates.tenantId, tenantId), inArray(templates.id, templateIds)))
            .all();
        const tplById = new Map(tplRows.map(t => [t.id, t]));
        for (const id of templateIds) {
            if (!tplById.has(id)) throw Errors.BadRequest(`Template not found: ${id}`);
        }

        const totalAmount = subs.reduce((sum, s) => sum + (s.price ?? 0), 0);

        await db.insert(inspectionRequests).values({
            id:              requestId,
            tenantId,
            clientName:      input.clientName,
            clientEmail:     input.clientEmail ?? null,
            clientPhone:     input.clientPhone ?? null,
            propertyAddress: input.propertyAddress,
            propertyCity:    input.propertyCity ?? null,
            propertyState:   input.propertyState ?? null,
            propertyZip:     input.propertyZip ?? null,
            scheduledAt:     input.scheduledAt,
            notes:           input.notes ?? null,
            status:          'pending',
            totalAmount,
            paymentStatus:   'unpaid',
            createdAt:       now,
            updatedAt:       now,
        });

        const subRows = subs.map(s => {
            const tpl = tplById.get(s.templateId);
            return {
                id:                       crypto.randomUUID(),
                tenantId,
                inspectorId:              input.inspectorId ?? null,
                propertyAddress:          input.propertyAddress,
                clientName:               input.clientName,
                clientEmail:              input.clientEmail ?? null,
                clientPhone:              input.clientPhone ?? null,
                templateId:               s.templateId,
                templateSnapshot:         tpl ? tpl.schema : null,
                templateSnapshotVersion:  tpl ? tpl.version : 1,
                date:                     input.scheduledAt,
                status:                   'draft' as const,
                paymentStatus:            'unpaid' as const,
                price:                    s.price ?? 0,
                requestId,
                referredByAgentId:        input.referredByAgentId ?? null,
                createdAt:                now,
            };
        });

        await db.insert(inspections).values(subRows);
        logger.info('inspection-request.created', { requestId, tenantId, subCount: subs.length });

        const detail = await this.get(tenantId, requestId);
        if (!detail) throw Errors.Internal('Failed to load newly created request');
        return detail;
    }

    /**
     * Append a new sub-inspection to an existing request.
     */
    async addSubInspection(tenantId: string, requestId: string, sub: CreateSubInspectionInput) {
        const db = this.getDrizzle();
        const req = await db.select().from(inspectionRequests)
            .where(and(eq(inspectionRequests.id, requestId), eq(inspectionRequests.tenantId, tenantId)))
            .get();
        if (!req) throw Errors.NotFound('Inspection request not found');

        const tpl = await db.select({ id: templates.id, version: templates.version, schema: templates.schema })
            .from(templates)
            .where(and(eq(templates.id, sub.templateId), eq(templates.tenantId, tenantId)))
            .get();
        if (!tpl) throw Errors.BadRequest(`Template not found: ${sub.templateId}`);

        const id = crypto.randomUUID();
        const now = new Date();
        await db.insert(inspections).values({
            id,
            tenantId,
            propertyAddress:          req.propertyAddress,
            clientName:               req.clientName,
            clientEmail:              req.clientEmail ?? null,
            clientPhone:              req.clientPhone ?? null,
            templateId:               sub.templateId,
            templateSnapshot:         tpl.schema,
            templateSnapshotVersion:  tpl.version,
            date:                     req.scheduledAt,
            status:                   'draft' as const,
            paymentStatus:            'unpaid' as const,
            price:                    sub.price ?? 0,
            requestId,
            createdAt:                now,
        });

        const newTotal = (req.totalAmount ?? 0) + (sub.price ?? 0);
        await db.update(inspectionRequests)
            .set({ totalAmount: newTotal, updatedAt: now })
            .where(and(eq(inspectionRequests.id, requestId), eq(inspectionRequests.tenantId, tenantId)));

        const detail = await this.get(tenantId, requestId);
        if (!detail) throw Errors.Internal('Failed to load updated request');
        return detail;
    }

    /**
     * Patch a request's top-level fields. Sub-inspections are edited via the
     * existing inspection.service endpoints — no cascading updates here.
     */
    async update(tenantId: string, id: string, patch: UpdateRequestInput) {
        const db = this.getDrizzle();
        const existing = await db.select().from(inspectionRequests)
            .where(and(eq(inspectionRequests.id, id), eq(inspectionRequests.tenantId, tenantId)))
            .get();
        if (!existing) throw Errors.NotFound('Inspection request not found');

        // Build a typed patch object — Drizzle dislikes `undefined` keys under
        // exactOptionalPropertyTypes.
        const update: Partial<typeof inspectionRequests.$inferInsert> = { updatedAt: new Date() };
        if (patch.clientName      !== undefined) update.clientName      = patch.clientName;
        if (patch.clientEmail     !== undefined) update.clientEmail     = patch.clientEmail;
        if (patch.clientPhone     !== undefined) update.clientPhone     = patch.clientPhone;
        if (patch.propertyAddress !== undefined) update.propertyAddress = patch.propertyAddress;
        if (patch.propertyCity    !== undefined) update.propertyCity    = patch.propertyCity;
        if (patch.propertyState   !== undefined) update.propertyState   = patch.propertyState;
        if (patch.propertyZip     !== undefined) update.propertyZip     = patch.propertyZip;
        if (patch.scheduledAt     !== undefined) update.scheduledAt     = patch.scheduledAt;
        if (patch.notes           !== undefined) update.notes           = patch.notes;
        if (patch.status          !== undefined) update.status          = patch.status;
        if (patch.paymentStatus   !== undefined) update.paymentStatus   = patch.paymentStatus;
        if (patch.totalAmount     !== undefined) update.totalAmount     = patch.totalAmount;

        await db.update(inspectionRequests)
            .set(update)
            .where(and(eq(inspectionRequests.id, id), eq(inspectionRequests.tenantId, tenantId)));

        const detail = await this.get(tenantId, id);
        if (!detail) throw Errors.Internal('Failed to reload updated request');
        return detail;
    }

    private shapeRequest(req: RequestRow, subs: SubInspectionRow[], tplNameById?: Map<string, string>) {
        return {
            id:               req.id,
            tenantId:         req.tenantId,
            clientName:       req.clientName,
            clientEmail:      req.clientEmail,
            clientPhone:      req.clientPhone,
            propertyAddress:  req.propertyAddress,
            propertyCity:     req.propertyCity,
            propertyState:    req.propertyState,
            propertyZip:      req.propertyZip,
            scheduledAt:      req.scheduledAt,
            status:           req.status,
            notes:            req.notes,
            totalAmount:      req.totalAmount,
            paymentStatus:    req.paymentStatus,
            createdAt:        safeISODate(req.createdAt),
            updatedAt:        safeISODate(req.updatedAt),
            inspections:      subs.map(s => ({
                id:              s.id,
                templateId:      s.templateId,
                templateName:    (s.templateId && tplNameById?.get(s.templateId)) || null,
                propertyAddress: s.propertyAddress,
                clientName:      s.clientName,
                status:          s.status,
                date:            s.date,
                price:           s.price,
                inspectorId:     s.inspectorId,
            })),
        };
    }
}
