/**
 * The platform routes that act on collaborative-document Durable Objects: the batched migration into the jurisdiction-pinned
 * namespace, and the one-object purge for an object whose report row is already gone.
 *
 * Both are guarded by `requireServiceBinding`, the `x-portal-m2m` MAC over the shared keyring, and both are 404 unless the
 * worker exposes the platform seam (see `workers/app.ts`). The procedure an operator follows is the header of
 * `server/lib/collab/do-jurisdiction-migrate.ts`; the deployment-level explanation is `docs/operate/durable-object-jurisdiction.md`.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { drizzle } from 'drizzle-orm/d1';
import { and, eq } from 'drizzle-orm';
import type { HonoConfig } from '../types/hono';
import { tenants } from '../lib/db/schema';
import { logger } from '../lib/logger';
import { requireServiceBinding } from './service-binding-guard';
import { collabNamespaces } from '../lib/collab/collab-namespaces';
import { DEFAULT_BATCH, MAX_BATCH, listCollabDocRefs, loadResultsBlobs, migrateCollabDocs, restoreDerivedBackup } from '../lib/collab/do-jurisdiction-migrate';
import { purgeMigratedSources } from '../lib/collab/do-jurisdiction-purge';
import { inspectionResults } from '../lib/db/schema';
import { PURGE_TENANT_HEADER } from '../durable-objects/purge-path';

const api = new Hono<HonoConfig>();

/**
 * `dryRun` is TRUE unless the caller says otherwise, and a replacement can never be asked for in a dry run. `purgeSource` turns
 * the batch into the verified removal of already-copied old objects (it copies nothing, so it cannot be combined with `replaceDerived`).
 */
const BatchSchema = z.object({
    cursor:         z.string().min(1).max(200).optional(),
    limit:          z.number().int().min(1).max(MAX_BATCH).default(DEFAULT_BATCH),
    dryRun:         z.boolean().default(true),
    replaceDerived: z.boolean().default(false),
    purgeSource:    z.boolean().default(false),
}).strict()
    .refine((b) => !(b.replaceDerived && b.dryRun), { message: 'replaceDerived needs dryRun: false' })
    .refine((b) => !(b.purgeSource && b.replaceDerived), { message: 'purgeSource cannot be combined with replaceDerived' });

/** Undo one replacement. Nothing else may ride along: a restore is never combined with a batch. */
const RestoreSchema = z.object({ restoreBackupFor: z.string().min(1).max(200) }).strict();

/**
 * POST /api/platform/collab-migrate
 * One batch of the copy from the pre-pinning collab namespace into the pinned one. Resumable (`cursor` in, `nextCursor` out),
 * idempotent, and it never changes the source. With `purgeSource: true` the same paging instead removes the old objects of
 * documents whose copy is verified (see do-jurisdiction-purge.ts); it copies nothing. A body of `{ restoreBackupFor: <row id> }` instead undoes one replacement.
 * Procedure and counters: server/lib/collab/do-jurisdiction-migrate.ts.
 */
api.post('/collab-migrate', requireServiceBinding, async (c) => {
    let raw: object;
    try {
        raw = await c.req.json<object>();
    } catch {
        return c.json({ success: false, error: { message: 'Invalid input' } }, 400);
    }
    const namespaces = collabNamespaces(c.env);
    const restore = RestoreSchema.safeParse(raw);
    if (restore.success) {
        if (!namespaces) return c.json({ success: false, error: { message: 'Inspection documents are not enabled' } }, 503);
        const [row] = await drizzle(c.env.DB)
            .select({ tenantId: inspectionResults.tenantId, inspectionId: inspectionResults.inspectionId, reportId: inspectionResults.reportId })
            .from(inspectionResults)
            .where(and(eq(inspectionResults.id, restore.data.restoreBackupFor)))
            .limit(1);
        if (!row?.reportId) return c.json({ success: false, error: { message: 'No such document' } }, 404);
        // The backup was built when the object opened: it must still agree with what the database holds now.
        const blob = (await loadResultsBlobs(c.env.DB, [{ rowId: restore.data.restoreBackupFor, ...row }])).get(restore.data.restoreBackupFor) ?? null;
        const outcome = await restoreDerivedBackup({ tenantId: row.tenantId, reportId: row.reportId }, namespaces.pinned, blob);
        logger.info('collab migrate restore', { rowId: restore.data.restoreBackupFor, outcome, ...(c.get('platformActor') ? { actor: c.get('platformActor') } : {}) });
        if (outcome === 'restored') return c.json({ success: true, data: { restored: true } });
        const refusals = {
            'no-backup': [404, 'No backup to restore'],
            'live': [409, 'The document is open or has unsaved changes'],
            'edited': [409, 'The replacement has been edited since; restoring would discard that edit'],
            'backup-differs-from-database': [409, 'The backup no longer matches the database, which has changed since it was made'],
            'database-row-unreadable': [409, 'The database row could not be read'],
            'failed': [502, 'Restore failed'],
        } as const;
        const [status, message] = refusals[outcome];
        return c.json({ success: false, error: { message } }, status);
    }
    const parsed = BatchSchema.safeParse(raw);
    if (!parsed.success) return c.json({ success: false, error: { message: 'Invalid input' } }, 400);
    const { cursor, limit, dryRun, replaceDerived, purgeSource } = parsed.data;

    if (!namespaces?.legacy) {
        return c.json({ success: false, error: { message: 'Nothing to migrate: Durable Object jurisdiction pinning is not on' } }, 409);
    }
    try {
        const { refs, nextCursor } = await listCollabDocRefs(c.env.DB, { limit, after: cursor ?? null });
        if (purgeSource) {
            const purge = await purgeMigratedSources(refs, namespaces.legacy, namespaces.pinned, { dryRun });
            const purgeActor = c.get('platformActor');
            logger.info('collab purge batch', {
                cursor: cursor ?? null, nextCursor, limit, dryRun,
                total: purge.total, purged: purge.purged, alreadyPurged: purge.alreadyPurged, wouldPurge: purge.wouldPurge,
                kept: purge.kept.length, keptByReason: purge.keptByReason, failed: purge.failed.length,
                rows: purge.rows.map(({ rowId, outcome, reason }) => ({ rowId, outcome, ...(reason ? { reason } : {}) })), ...(purgeActor ? { actor: purgeActor } : {}),
            });
            return c.json({ success: true, data: { ...purge, nextCursor, dryRun, purgeSource: true } });
        }
        // One query for the whole batch: what the database holds, so a copy that would take a direct write away is refused.
        const blobs = dryRun ? new Map() : await loadResultsBlobs(c.env.DB, refs);
        const report = await migrateCollabDocs(refs, namespaces.legacy, namespaces.pinned, { dryRun, replaceDerived, databaseBlob: (rowId) => blobs.get(rowId) ?? null });
        const actor = c.get('platformActor');
        logger.info('collab migrate batch', {
            cursor: cursor ?? null, nextCursor, limit, dryRun, replaceDerived,
            total: report.total, copied: report.copied, wouldCopy: report.wouldCopy, alreadyThere: report.alreadyThere,
            empty: report.empty, replaced: report.replaced, conflicts: report.conflicts.length, skipped: report.skipped.length,
            failed: report.failed.length, rows: report.rows.map(({ rowId, outcome }) => ({ rowId, outcome })), ...(actor ? { actor } : {}),
        });
        return c.json({ success: true, data: { ...report, nextCursor, dryRun, replaceDerived } });
    } catch (error: unknown) {
        logger.error('collab migrate batch failed', { cursor: cursor ?? null, limit, dryRun }, error instanceof Error ? error : undefined);
        return c.json({ success: false, error: { message: 'Migration batch failed' } }, 500);
    }
});

/** Body for the one-object cleanup used when a report row is already gone. */
const InspectionDocPurgeSchema = z.object({
    durableObjectId: z.string().regex(/^[0-9a-f]{64}$/i),
});

/**
 * POST /api/platform/tenants/:slug/inspection-doc/purge
 * Clear one orphaned InspectionDocDO by its Cloudflare durable object id.
 *
 * This is deliberately narrower than tenant purge: it does not touch D1, R2,
 * KV, or any other Durable Object. The exact DO id comes from Workers Logs because an id cannot
 * be reversed into the report name after that report has been deleted.
 *
 * Ownership: because an id cannot be mapped back to a name, the route sends the tenant's id with the purge and the OBJECT
 * checks it against the identity it stored. An object that stores another tenant's identity answers 403 and nothing is
 * deleted; so does one that holds a document but never stored an identity (it cannot be attributed). An empty object is purged.
 * A refusal ends the request: the other namespace is not tried.
 *
 * The id may belong to the pinned namespace or, for an object created before pinning, to the old one: a pinned namespace
 * refuses an id minted outside its jurisdiction. The pinned namespace is tried first, then the old one, and the answer says
 * which took it. An id neither recognises is a 404; an id that was recognised but could not be purged is a 502.
 */
api.post('/tenants/:slug/inspection-doc/purge', requireServiceBinding, async (c) => {
    const slug = c.req.param('slug');
    if (!slug) return c.json({ success: false, error: { message: 'Tenant slug is required' } }, 400);
    let body: object;
    try {
        body = await c.req.json<object>();
    } catch {
        return c.json({ success: false, error: { message: 'Invalid input' } }, 400);
    }
    const parsed = InspectionDocPurgeSchema.safeParse(body);
    if (!parsed.success) {
        return c.json({ success: false, error: { message: 'Invalid input' } }, 400);
    }

    const d = drizzle(c.env.DB);
    const t = await d.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug)).get();
    if (!t) return c.json({ success: false, error: { message: 'Tenant not found' } }, 404);

    const namespaces = collabNamespaces(c.env);
    if (!namespaces) return c.json({ success: false, error: { message: 'Inspection documents are not enabled' } }, 503);

    const { durableObjectId } = parsed.data;
    const candidates = [
        { namespace: 'pinned' as const, ns: namespaces.pinned },
        ...(namespaces.legacy ? [{ namespace: 'legacy' as const, ns: namespaces.legacy }] : []),
    ];
    let recognised = false;
    for (const { namespace, ns } of candidates) {
        try {
            const stub = ns.get(ns.idFromString(durableObjectId));
            recognised = true;
            const response = await stub.fetch('https://do/purge', { method: 'POST', headers: { [PURGE_TENANT_HEADER]: t.id } });
            if (response.status === 403) {
                logger.warn('Inspection document purge refused: the object does not belong to the tenant', { slug, durableObjectId, namespace });
                return c.json({ success: false, error: { message: 'The object does not belong to this tenant, or cannot be attributed to one' } }, 403);
            }
            if (!response.ok) throw new Error(`purge returned ${response.status}`);
            return c.json({ success: true, data: { purged: true, durableObjectId, namespace } });
        } catch (error: unknown) {
            logger.error('Inspection document purge failed', { slug, durableObjectId, namespace }, error instanceof Error ? error : undefined);
        }
    }
    return recognised
        ? c.json({ success: false, error: { message: 'Purge failed' } }, 502)
        : c.json({ success: false, error: { message: 'Durable object id not recognised' } }, 404);
});

export default api;
