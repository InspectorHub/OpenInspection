/**
 * The read side of the three append-only assurance ledgers.
 *
 * WHY ONE MODULE FOR THREE TABLES. `tenant_destruction_records`,
 * `ai_call_provenance` and `ai_content_reviews` were each written by exactly one
 * call site and read by nothing. Three write-only ledgers is not three bugs, it
 * is one: nobody decided WHO would ever ask. So the retrieval rules are decided
 * once, here, and the HTTP layers above are thin — they choose a reader and a
 * guard, and they add nothing to the shape.
 *
 * THE RULES, AND THEY HOLD FOR ALL THREE.
 *   - READ-ONLY. Nothing in this file writes, updates or deletes. An audit
 *     record a reader can edit is not evidence of anything, so the module that
 *     serves it must not be able to change it.
 *   - EXPLICIT COLUMN PROJECTION, never `select()`. A column added to one of
 *     these tables later must be exposed deliberately — on `ai_call_provenance`
 *     that is a compliance decision (see the schema comment forbidding prompt
 *     text), and a `SELECT *` would publish it the day it lands.
 *   - EPOCH MILLISECONDS on the way out. D1 hands back Date | number | string
 *     depending on driver; callers get a number.
 *   - NEWEST FIRST, CAPPED, AND PAGEABLE BACKWARDS. A compliance request is
 *     answered from the recent end and walked back; an uncapped read of a ledger
 *     that grows per AI call is not a read path, it is an outage.
 *
 * THE TENANT FILTER IS NOT UNIFORM, AND THAT IS THE WHOLE DESIGN PROBLEM.
 * The two AI ledgers are ordinary tenant-scoped tables and are filtered by
 * `tenantId` like everything else. `tenant_destruction_records` is the durable
 * proof that a tenant was destroyed: it OUTLIVES the row it names, is excluded
 * from `tenantScopedTables()` for that reason, and therefore can never be
 * reached by a query that derives its tenant from a session belonging to that
 * tenant. Its reader is the platform operator and its filter is an argument.
 * See `readDestructionRecords` below, and the two callers in
 * `server/api/admin/admin-ai-assurance.ts` and
 * `server/portal/integration.routes.ts`.
 */
import { and, desc, eq, lt, inArray, notExists, sql } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { aiCallProvenance, aiContentReviews, tenantDestructionRecords, users } from '../db/schema';

// Accept either the D1 drizzle type (prod) or the better-sqlite3 test db, the
// same widening `erasure-orchestrator.ts` uses for the same reason: both expose
// the query-builder surface used here, and specs must be able to drive this
// module without a worker.
type AnyDb = DrizzleD1Database<Record<string, unknown>> | { [k: string]: unknown };

/** Hard ceiling on any single page, whichever caller asks. */
export const ASSURANCE_MAX_PAGE = 200;
/** Page size when a caller names none. */
export const ASSURANCE_DEFAULT_PAGE = 50;

/** D1 returns timestamps as Date, number or string depending on the driver. */
function toMs(value: unknown): number {
    if (value instanceof Date) return value.getTime();
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

function clampLimit(limit: number | undefined): number {
    if (!Number.isFinite(limit) || limit === undefined) return ASSURANCE_DEFAULT_PAGE;
    return Math.min(Math.max(Math.trunc(limit), 1), ASSURANCE_MAX_PAGE);
}

/** One human's review of the output of one AI call. */
export interface AiReviewEntry {
    id: string;
    /** Which table holds the row the text landed in. */
    artifactType: string;
    /** Primary key within `artifactType`'s table — meaningless without it. */
    artifactId: string;
    /** `users.id` of the staff reviewer. Naming the person IS the claim. */
    reviewedBy: string;
    /** Resolved display name, or null when the user row is gone. */
    reviewerName: string | null;
    reviewedAt: number;
}

/** One AI call, with every review that cites it. */
export interface AiAssuranceCall {
    id: string;
    capability: string;
    provider: string;
    /** 'managed' | 'byo' — whose credentials funded the call. */
    mode: string;
    model: string;
    promptVersion: string;
    calledAt: number;
    /**
     * Empty means NOBODY REVIEWED THE OUTPUT OF THIS CALL, which is the fact the
     * reader is usually here for. It is not padded or hidden.
     */
    reviews: AiReviewEntry[];
}

export interface AiAssurancePage {
    calls: AiAssuranceCall[];
    /**
     * Reviews for this workspace whose `ai_call_id` matches no provenance row
     * belonging to it — a citation that resolves to nothing.
     *
     * Reported rather than silently dropped. `POST /api/ai/reviews` takes
     * `aiCallId` from the request body and does not verify that the call is the
     * workspace's own, so a review CAN name a row this workspace has no
     * provenance for. Both halves of the join below are tenant-filtered, so such
     * a row can never surface another workspace's call — it just vanishes from
     * the page, and a compliance view that quietly loses evidence rows is the
     * failure this whole change exists to fix. The count is over the whole
     * ledger, not the current page: it is a health signal, not a page item.
     */
    unresolvedReviewCount: number;
    /**
     * Pass back as `before` to fetch the next older page, or null at the end.
     * The page unit is the CALL: a review always postdates the call it cites and
     * travels with it, so walking calls backwards eventually shows every review.
     */
    nextBefore: number | null;
}

/**
 * The AI assurance ledger for one workspace: recent calls, newest first, each
 * carrying the reviews that cite it.
 *
 * WHY THE TWO TABLES ARE READ TOGETHER RATHER THAN SIDE BY SIDE. Separately
 * they answer nothing a reader asked. `ai_call_provenance` alone says a model
 * ran; `ai_content_reviews` alone says a person confirmed something, citing an
 * id that resolves to nowhere. Joined, they answer the question the schema
 * comments say both were built for — which prompt and model produced this text,
 * and did a human look at it — and the join direction matches the one the schema
 * fixed: the review points AT provenance, never the other way.
 */
export async function readAiAssurance(
    rawDb: AnyDb,
    input: { tenantId: string; limit?: number; before?: number },
): Promise<AiAssurancePage> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = rawDb as any;
    const { tenantId } = input;
    const limit = clampLimit(input.limit);

    // Tenant-scoped: `tenantId` comes from the caller's verified session, never
    // from user input (Tenant Isolation Rules).
    const callWhere = input.before !== undefined
        ? and(eq(aiCallProvenance.tenantId, tenantId), lt(aiCallProvenance.createdAt, new Date(input.before)))
        : eq(aiCallProvenance.tenantId, tenantId);

    const callRows = await db.select({
        id:            aiCallProvenance.id,
        capability:    aiCallProvenance.capability,
        provider:      aiCallProvenance.provider,
        mode:          aiCallProvenance.mode,
        model:         aiCallProvenance.model,
        promptVersion: aiCallProvenance.promptVersion,
        createdAt:     aiCallProvenance.createdAt,
    })
        .from(aiCallProvenance)
        .where(callWhere)
        .orderBy(desc(aiCallProvenance.createdAt))
        .limit(limit);

    const callIds: string[] = callRows.map((r: { id: string }) => r.id);

    // Reviews for THIS page's calls. Filtered by tenant on its own account as
    // well as by the id set: the id set is already tenant-derived, but a review
    // row carries its own tenant_id and a read path must not depend on a
    // second table's filter to stay inside the workspace.
    const reviewRows = callIds.length === 0 ? [] : await db.select({
        id:           aiContentReviews.id,
        aiCallId:     aiContentReviews.aiCallId,
        artifactType: aiContentReviews.artifactType,
        artifactId:   aiContentReviews.artifactId,
        reviewedBy:   aiContentReviews.reviewedBy,
        reviewerName: users.name,
        reviewedAt:   aiContentReviews.reviewedAt,
    })
        .from(aiContentReviews)
        .leftJoin(users, eq(users.id, aiContentReviews.reviewedBy))
        .where(and(
            eq(aiContentReviews.tenantId, tenantId),
            inArray(aiContentReviews.aiCallId, callIds),
        ))
        .orderBy(desc(aiContentReviews.reviewedAt));

    const byCall = new Map<string, AiReviewEntry[]>();
    for (const r of reviewRows as Array<Record<string, unknown>>) {
        const entry: AiReviewEntry = {
            id:           String(r.id),
            artifactType: String(r.artifactType),
            artifactId:   String(r.artifactId),
            reviewedBy:   String(r.reviewedBy),
            reviewerName: r.reviewerName === null || r.reviewerName === undefined ? null : String(r.reviewerName),
            reviewedAt:   toMs(r.reviewedAt),
        };
        const key = String(r.aiCallId);
        const list = byCall.get(key);
        if (list) list.push(entry);
        else byCall.set(key, [entry]);
    }

    const unresolved = await db.select({ n: sql<number>`count(*)` })
        .from(aiContentReviews)
        .where(and(
            eq(aiContentReviews.tenantId, tenantId),
            notExists(
                db.select({ one: sql`1` })
                    .from(aiCallProvenance)
                    .where(and(
                        eq(aiCallProvenance.id, aiContentReviews.aiCallId),
                        eq(aiCallProvenance.tenantId, tenantId),
                    )),
            ),
        ));

    const calls: AiAssuranceCall[] = callRows.map((r: Record<string, unknown>) => ({
        id:            String(r.id),
        capability:    String(r.capability),
        provider:      String(r.provider),
        mode:          String(r.mode),
        model:         String(r.model),
        promptVersion: String(r.promptVersion),
        calledAt:      toMs(r.createdAt),
        reviews:       byCall.get(String(r.id)) ?? [],
    }));

    const last = calls[calls.length - 1];
    return {
        calls,
        unresolvedReviewCount: Number(unresolved?.[0]?.n ?? 0),
        nextBefore: calls.length === limit && last ? last.calledAt : null,
    };
}

/** The durable proof that one workspace's data was physically destroyed. */
export interface DestructionRecord {
    id: string;
    /** String snapshot of a tenant id that no longer exists as a row. */
    tenantId: string;
    tenantSlug: string | null;
    rowsDeleted: number;
    r2Objects: number;
    r2Bytes: number;
    kvKeys: number;
    destroyedAt: number;
}

export interface DestructionRecordPage {
    records: DestructionRecord[];
    nextBefore: number | null;
}

/**
 * Destruction records, newest first, optionally narrowed to one destroyed
 * workspace.
 *
 * ⚠️ DELIBERATELY NOT TENANT-SCOPED, and this is the one place in the codebase
 * where that sentence is not a bug report. Every other read filters on a
 * `tenantId` taken from the caller's verified session; this table describes
 * tenants that HAVE BEEN DELETED, so no session can exist for the row's subject
 * and a session-derived filter would make the record permanently unreachable —
 * which is exactly the state this change is fixing. `scoped-tables.ts` excludes
 * the table from `tenantScopedTables()` for the matching reason on the write
 * side: it must survive the purge it records.
 *
 * The safety therefore does NOT come from the query. It comes from the caller:
 * the only exposure is `GET /api/integration/destruction-records`, behind the
 * `x-portal-m2m` HMAC (`requireServiceBinding`), on a seam the worker entry 404s
 * unless `APP_MODE=saas`, and it is the sibling of the
 * `POST /api/integration/tenants/:slug/purge` that writes these rows. Do not
 * mount this function on a tenant-session route: `tenantId` here is a FILTER
 * supplied by an operator, and accepting it from an end user would be a
 * cross-tenant read by construction.
 */
export async function readDestructionRecords(
    rawDb: AnyDb,
    input: { tenantId?: string; limit?: number; before?: number } = {},
): Promise<DestructionRecordPage> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = rawDb as any;
    const limit = clampLimit(input.limit);

    const filters = [
        ...(input.tenantId ? [eq(tenantDestructionRecords.tenantId, input.tenantId)] : []),
        ...(input.before !== undefined
            ? [lt(tenantDestructionRecords.destroyedAt, new Date(input.before))]
            : []),
    ];

    const rows = await db.select({
        id:          tenantDestructionRecords.id,
        tenantId:    tenantDestructionRecords.tenantId,
        tenantSlug:  tenantDestructionRecords.tenantSlug,
        rowsDeleted: tenantDestructionRecords.rowsDeleted,
        r2Objects:   tenantDestructionRecords.r2Objects,
        r2Bytes:     tenantDestructionRecords.r2Bytes,
        kvKeys:      tenantDestructionRecords.kvKeys,
        destroyedAt: tenantDestructionRecords.destroyedAt,
    })
        .from(tenantDestructionRecords)
        .where(filters.length ? and(...filters) : undefined)
        .orderBy(desc(tenantDestructionRecords.destroyedAt))
        .limit(limit);

    const records: DestructionRecord[] = (rows as Array<Record<string, unknown>>).map((r) => ({
        id:          String(r.id),
        tenantId:    String(r.tenantId),
        tenantSlug:  r.tenantSlug === null || r.tenantSlug === undefined ? null : String(r.tenantSlug),
        rowsDeleted: Number(r.rowsDeleted ?? 0),
        r2Objects:   Number(r.r2Objects ?? 0),
        r2Bytes:     Number(r.r2Bytes ?? 0),
        kvKeys:      Number(r.kvKeys ?? 0),
        destroyedAt: toMs(r.destroyedAt),
    }));

    const last = records[records.length - 1];
    return {
        records,
        nextBefore: records.length === limit && last ? last.destroyedAt : null,
    };
}
