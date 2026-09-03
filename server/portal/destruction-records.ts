import type { Context } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import type { HonoConfig } from '../types/hono';
import { logger } from '../lib/logger';
import { readDestructionRecords } from '../lib/compliance/assurance-records';
import { DestructionRecordQuerySchema } from '../lib/validations/assurance.schema';

/**
 * GET /api/platform/destruction-records — the read side of the tenant purge.
 *
 * `tenant_destruction_records` is the durable, non-personal proof that a
 * workspace's data was physically destroyed: counts of rows, R2 objects, R2
 * bytes and KV keys, plus when. It is written by
 * `POST /api/platform/tenants/:slug/purge` and, until this handler existed,
 * was read by nothing at all — so "produce the record of tenant X's destruction"
 * could only be answered by opening D1 by hand.
 *
 * ⚠️ THIS READ IS DELIBERATELY NOT TENANT-SCOPED, and it is the sibling of the
 * write for that reason. The table is excluded from `tenantScopedTables()` so it
 * SURVIVES the purge it records, which also means the tenant it names no longer
 * exists and can hold no session — a session-derived filter would make the proof
 * permanently unreachable, which is the state this endpoint fixes. So the reader
 * is the platform operator, `tenantId` is an operator-supplied FILTER rather
 * than a scope, and the guard is the same `requireServiceBinding` M2M HMAC that
 * authorised the purge. The worker entry additionally 404s this whole seam
 * unless `APP_MODE=saas`. Do not mount `readDestructionRecords` on any route
 * reachable with a tenant JWT.
 *
 * Read-only: the module it calls contains no insert, update or delete.
 */
export async function destructionRecordsHandler(c: Context<HonoConfig>) {
    const parsed = DestructionRecordQuerySchema.safeParse({
        ...(c.req.query('tenantId') !== undefined ? { tenantId: c.req.query('tenantId') } : {}),
        ...(c.req.query('limit') !== undefined ? { limit: c.req.query('limit') } : {}),
        ...(c.req.query('before') !== undefined ? { before: c.req.query('before') } : {}),
    });
    if (!parsed.success) {
        return c.json({ success: false, error: { message: 'Invalid input' } }, 400);
    }
    try {
        const { tenantId, limit, before } = parsed.data;
        const page = await readDestructionRecords(drizzle(c.env.DB), {
            limit,
            ...(tenantId !== undefined ? { tenantId } : {}),
            ...(before !== undefined ? { before } : {}),
        });
        return c.json({ success: true, data: page });
    } catch (error: unknown) {
        logger.error('destruction-records read failed', {}, error instanceof Error ? error : undefined);
        return c.json({ success: false, error: { message: 'Internal server error' } }, 500);
    }
}
