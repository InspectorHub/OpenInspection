// Admin → Canned Comments library sub-router (Phase 1.3 split of
// server/api/admin.ts).
//
// Canned-comment CRUD + search/filter/pagination + per-user usage counter.
// Route definitions are co-located with their `.openapi()` handlers; bodies are
// byte-identical to the original admin.ts. Mounted at `/` by the admin
// aggregator, preserving the original paths.
import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../../lib/openapi-router';
import { drizzle } from 'drizzle-orm/d1';
import { eq, and, or, like, asc as ascDz, desc as descDz, sql as sqlTpl } from 'drizzle-orm';
import { buildMeta } from '../../lib/validations/pagination.schema';
import { requireRole } from '../../lib/middleware/rbac';
import { auditFromContext } from '../../lib/audit';
import { safeISODate } from '../../lib/date';
import { escapeLikePattern } from '../../lib/db/like-escape';
import { Errors } from '../../lib/errors';
import {
    CommentSchema,
    CommentResponseSchema,
    UpdateCommentSchema,
    ListCommentsQuerySchema,
    CommentTouchResponseSchema,
} from '../../lib/validations/admin.schema';
import { comments } from '../../lib/db/schema';
import { commentUsage } from '../../lib/db/schema/inspection';
import { withMcpMetadata } from "../../lib/route-metadata-standards";


// --- Comments Library ---

// Spec 2026-05-07 — narrow Drizzle's generic `string | null` for
// `ratingBucket` down to the Zod enum shape the OpenAPI response schema
// declares. The DB column is just TEXT (column constraint isn't enforced
// at the SQLite layer), so we cast at the response boundary.
type RatingBucketResp = 'satisfactory' | 'monitor' | 'defect' | null;
function commentRowToResponse(r: typeof comments.$inferSelect) {
    return {
        ...r,
        ratingBucket: (r.ratingBucket as RatingBucketResp) ?? null,
        createdAt: safeISODate(r.createdAt),
    };
}

const listCommentsRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/comments',
    tags: ["admin"],
    summary: 'List comment library entries',
    // Inspectors need read access so the inspection-edit picker (T7+1) can
    // populate. Create/delete remain admin-only further below.
    middleware: [requireRole('owner', 'manager', 'inspector')],
    request: { query: ListCommentsQuerySchema.describe('TODO describe query field for the OpenInspection MCP integration') },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'), data: z.array(CommentResponseSchema).describe('TODO describe data field for the OpenInspection MCP integration') }) } },
            description: 'Success',
        },
    },
    security: [{ bearerAuth: [] }],
    operationId: "listTenantComments",
    description: "Auto-generated placeholder for listTenantComments (GET /comments, admin domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['admin'], tier: 'extended' }));


const createCommentRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/comments',
    tags: ["admin"],
    summary: 'Create a comment library entry',
    middleware: [requireRole('owner', 'manager')],
    request: { body: { content: { 'application/json': { schema: CommentSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } } },
    responses: {
        201: {
            content: { 'application/json': { schema: z.object({ success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'), data: z.object({ comment: CommentResponseSchema.describe('TODO describe comment field for the OpenInspection MCP integration') }).describe('TODO describe data field for the OpenInspection MCP integration') }) } },
            description: 'Created',
        },
    },
    security: [{ bearerAuth: [] }],
    operationId: "createTenantComments",
    description: "Auto-generated placeholder for createTenantComments (POST /comments, admin domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['admin'], tier: 'extended' }));


const deleteCommentRoute = createRoute(withMcpMetadata({
    method: 'delete',
    path: '/comments/{id}',
    tags: ["admin"],
    summary: 'Delete a comment library entry',
    middleware: [requireRole('owner', 'manager')],
    request: { params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration') },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.boolean().describe('TODO describe success field for the OpenInspection MCP integration') }).describe('TODO describe schema field for the OpenInspection MCP integration') } },
            description: 'Deleted',
        },
        404: { description: 'Not found' },
    },
    security: [{ bearerAuth: [] }],
    operationId: "deleteTenantComment",
    description: "Auto-generated placeholder for deleteTenantComment (DELETE /comments/{id}, admin domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['admin'], tier: 'extended' }));


const updateCommentRoute = createRoute(withMcpMetadata({
    method: 'put',
    path: '/comments/{id}',
    tags: ["admin"],
    summary: 'Update a comment library entry',
    middleware: [requireRole('owner', 'manager')],
    request: {
        params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
        body: { content: { 'application/json': { schema: UpdateCommentSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'), data: z.object({ comment: CommentResponseSchema.describe('TODO describe comment field for the OpenInspection MCP integration') }).describe('TODO describe data field for the OpenInspection MCP integration') }) } },
            description: 'Updated',
        },
        404: { description: 'Not found' },
    },
    security: [{ bearerAuth: [] }],
    operationId: "updateTenantComment",
    description: "Auto-generated placeholder for updateTenantComment (PUT /comments/{id}, admin domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['admin'], tier: 'extended' }));


// Comments Library Upgrade — per-user usage counter. Inspectors call this
// after dropping a snippet into a report; the count drives the "frequent"
// sort + AUTO filter mode in the Library drawer.
const touchCommentRoute = createRoute(withMcpMetadata({
    method: 'post',
    path:   '/comments/{id}/touch',
    tags:   ['admin'],
    summary: "Record an inspector's use of a snippet (per-user counter)",
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: { params: z.object({ id: z.string().min(1).describe('Comment library entry identifier') }) },
    responses: {
        200: {
            description: 'Updated usage row',
            content: { 'application/json': { schema: CommentTouchResponseSchema } },
        },
    },
    security: [{ bearerAuth: [] }],
    operationId: "touchTenantComment",
    description: "Increment per-user usage counter for a comment library entry.",
}, { scopes: ['admin'], tier: 'extended' }));


export const adminCommentsRoutes = createApiRouter()
    .openapi(listCommentsRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const { rating, section, sectionId, triggerCode, search, sort, filterMode, itemLabel, page, pageSize } = c.req.valid('query');
        // Per-user usage join — needs the JWT subject (same convention as the
        // touch endpoint above and the rest of admin.ts).
        const userId = c.get('user')?.sub ?? '';
        const auto = filterMode === 'auto';
        const db = drizzle(c.env.DB);
        // Filters layered defensively: tenantId always first (multi-tenant
        // isolation rule from CLAUDE.md). `sectionId` / `triggerCode` are
        // explicit user-typed filters and always apply; `rating` / `section`
        // / `itemLabel` are context-derived and only apply when filterMode=auto
        // (filterMode=all means "ignore inspection context, show everything").
        const conditions = [eq(comments.tenantId, tenantId)];
        if (sectionId) {
            conditions.push(like(comments.sectionIds, `%"${escapeLikePattern(sectionId)}"%`));
        }
        if (triggerCode) {
            conditions.push(eq(comments.triggerCode, triggerCode));
        }
        // Track H: `rating` applies whenever the caller sends it — the library
        // modal's bucket chips pass it explicitly in `all` mode too (it used to
        // be auto-gated like section/itemLabel, which left the chips dead).
        if (rating) conditions.push(eq(comments.ratingBucket, rating));
        if (auto && section) conditions.push(eq(comments.section, section));
        if (auto && itemLabel) conditions.push(eq(comments.itemLabel, itemLabel));
        // Track H (IA-5): search is pushed down to SQL so pagination + count
        // are correct. (The old behavior filtered in JS AFTER the limit, so a
        // match beyond the first page silently never surfaced.) Matches text
        // OR the curated search_keywords column; SQLite LIKE is ASCII
        // case-insensitive, which is what the library content needs.
        if (search && search.trim().length >= 2) {
            const needle = `%${escapeLikePattern(search.trim())}%`;
            conditions.push(or(like(comments.text, needle), like(comments.searchKeywords, needle))!);
        }

        // ORDER BY by sort. SQLite treats NULL as smaller than any value, so
        // descDz(commentUsage.lastUsedAt) naturally puts user-touched rows first
        // and untouched rows last — matches the `recent` / `frequent` specs.
        const orderByExpr =
            sort === 'recent'   ? [descDz(commentUsage.lastUsedAt)]
          : sort === 'created'  ? [descDz(comments.createdAt)]
          : sort === 'frequent' ? [descDz(commentUsage.useCount), descDz(commentUsage.lastUsedAt)]
          : sort === 'alpha'    ? [ascDz(comments.text)]
          :                       [ascDz(comments.ratingBucket), descDz(comments.createdAt)];

        const rows = await db.select({
            id:             comments.id,
            tenantId:       comments.tenantId,
            text:           comments.text,
            category:       comments.category,
            ratingBucket:   comments.ratingBucket,
            section:        comments.section,
            sectionIds:     comments.sectionIds,
            itemLabels:     comments.itemLabels,
            itemLabel:      comments.itemLabel,
            triggerCode:    comments.triggerCode,
            searchKeywords: comments.searchKeywords,
            libraryId:      comments.libraryId,
            severity:       comments.severity,
            repairSummary:               comments.repairSummary,
            estimateMinCents:            comments.estimateMinCents,
            estimateMaxCents:            comments.estimateMaxCents,
            recommendedContractorTypeId: comments.recommendedContractorTypeId,
            createdAt:      comments.createdAt,
            useCount:       commentUsage.useCount,
            lastUsedAt:     commentUsage.lastUsedAt,
        })
            .from(comments)
            .leftJoin(commentUsage, and(
                eq(commentUsage.commentId, comments.id),
                eq(commentUsage.tenantId,  tenantId),
                eq(commentUsage.userId,    userId),
            ))
            .where(and(...conditions))
            .orderBy(...orderByExpr)
            .limit(pageSize)
            .offset((page - 1) * pageSize)
            .all();

        // Total count for pagination meta — exact now that search lives in the
        // WHERE clause (Track H).
        const totalRow = await db
            .select({ c: sqlTpl<number>`count(*)` })
            .from(comments)
            .where(and(...conditions))
            .get();
        const total = totalRow?.c ?? 0;
        // `commentRowToResponse` is exported via the local helper above and used
        // by the create / update routes — we extend in-place at the route to
        // avoid touching the create / update signatures.
        const data = rows.map(r => ({
            ...commentRowToResponse(r),
            useCount:   r.useCount ?? 0,
            // commentUsage.lastUsedAt is a UNIX seconds integer (see touch handler).
            lastUsedAt: r.lastUsedAt != null ? new Date(r.lastUsedAt * 1000).toISOString() : null,
        }));
        return c.json({
            success: true as const,
            data,
            meta: buildMeta({ total, page, pageSize }),
        }, 200);
    })
    .openapi(createCommentRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const { text, category, ratingBucket, section, repairSummary, estimateMinCents, estimateMaxCents, recommendedContractorTypeId } = c.req.valid('json');
        const db = drizzle(c.env.DB);
        const row = {
            id: crypto.randomUUID(),
            tenantId,
            text,
            category: category ?? null,
            ratingBucket: ratingBucket ?? null,
            section: section ?? null,
            // S2-7 — libraryId tracks marketplace provenance; null for tenant-authored.
            libraryId: null as string | null,
            sectionIds: null as string | null,
            itemLabels: null as string | null,
            triggerCode: null as string | null,
            searchKeywords: null as string | null,
            itemLabel: null as string | null,
            severity: null as string | null,
            repairSummary: repairSummary ?? null,
            estimateMinCents: estimateMinCents ?? null,
            estimateMaxCents: estimateMaxCents ?? null,
            recommendedContractorTypeId: recommendedContractorTypeId ?? null,
            createdAt: new Date(),
        };
        await db.insert(comments).values(row);
        auditFromContext(c, 'comment.created', 'comment', {
            entityId: row.id,
            metadata: { textPreview: text.slice(0, 80) },
        });
        return c.json({ success: true as const, data: { comment: commentRowToResponse(row) } }, 201);
    })
    .openapi(deleteCommentRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const { id } = c.req.valid('param');
        const db = drizzle(c.env.DB);
        const existing = await db.select().from(comments)
            .where(and(eq(comments.id, id), eq(comments.tenantId, tenantId))).get();
        if (!existing) throw Errors.NotFound('Comment not found');
        await db.delete(comments).where(and(eq(comments.id, id), eq(comments.tenantId, tenantId)));
        auditFromContext(c, 'comment.deleted', 'comment', {
            entityId: id,
            metadata: { textPreview: (existing.text as string).slice(0, 80) },
        });
        return c.json({ success: true }, 200);
    })
    .openapi(updateCommentRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const { id } = c.req.valid('param');
        const { text, category, ratingBucket, section, repairSummary, estimateMinCents, estimateMaxCents, recommendedContractorTypeId } = c.req.valid('json');
        const db = drizzle(c.env.DB);
        const existing = await db.select().from(comments)
            .where(and(eq(comments.id, id), eq(comments.tenantId, tenantId))).get();
        if (!existing) throw Errors.NotFound('Comment not found');
        const patch: Partial<typeof comments.$inferInsert> = {
            text,
            category: category ?? null,
            ratingBucket: ratingBucket ?? null,
            section: section ?? null,
        };
        if (repairSummary !== undefined) patch.repairSummary = repairSummary ?? null;
        if (estimateMinCents !== undefined) patch.estimateMinCents = estimateMinCents ?? null;
        if (estimateMaxCents !== undefined) patch.estimateMaxCents = estimateMaxCents ?? null;
        if (recommendedContractorTypeId !== undefined) patch.recommendedContractorTypeId = recommendedContractorTypeId ?? null;
        await db.update(comments)
            .set(patch)
            .where(and(eq(comments.id, id), eq(comments.tenantId, tenantId)));
        const updated = { ...existing, ...patch } as typeof comments.$inferSelect;
        auditFromContext(c, 'comment.updated', 'comment', {
            entityId: id,
            metadata: {
                category: category ?? null,
                ratingBucket: ratingBucket ?? null,
                section: section ?? null,
                textPreview: text.slice(0, 80),
            },
        });
        return c.json({ success: true as const, data: { comment: commentRowToResponse(updated) } }, 200);
    })
    .openapi(touchCommentRoute, async (c) => {
        const { id } = c.req.valid('param');
        const tenantId = c.get('tenantId');
        // Convention in this file: auth middleware stashes the decoded JWT under
        // the 'user' key with `.sub` as the user id (see lines ~866, ~2169).
        const userId = c.get('user')?.sub ?? '';
        if (!userId) throw Errors.Unauthorized();
        const now = Math.floor(Date.now() / 1000);
        const db = drizzle(c.env.DB);

        const existing = await db.select().from(commentUsage)
            .where(and(
                eq(commentUsage.tenantId,  tenantId),
                eq(commentUsage.userId,    userId),
                eq(commentUsage.commentId, id),
            ))
            .get();

        if (existing) {
            const nextCount = existing.useCount + 1;
            await db.update(commentUsage)
                .set({ useCount: nextCount, lastUsedAt: now })
                .where(and(
                    eq(commentUsage.tenantId,  tenantId),
                    eq(commentUsage.userId,    userId),
                    eq(commentUsage.commentId, id),
                ));
            return c.json({ success: true as const, data: { commentId: id, useCount: nextCount } }, 200);
        }

        await db.insert(commentUsage).values({
            tenantId, userId, commentId: id, useCount: 1, lastUsedAt: now,
        });
        return c.json({ success: true as const, data: { commentId: id, useCount: 1 } }, 200);
    });

export type AdminCommentsApi = typeof adminCommentsRoutes;
export default adminCommentsRoutes;
