/**
 * The bulk service reads must never bind more parameters than D1 accepts.
 *
 * D1 allows 100 bound parameters per statement. Each bulk statement binds the
 * tenant id plus one parameter per service id, so the per-request id limit has
 * to leave room for the tenant id. A recording driver reports how many
 * parameters each statement bound, which a permissive SQLite cannot tell us.
 */
import { describe, it, expect } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { getServiceInspectorsBulk } from '../../../server/services/service/qualification';
import { listPayRulesBulk } from '../../../server/services/service/pay-rules';
import { MAX_BULK_SERVICE_IDS, BulkServiceIdsQuerySchema } from '../../../server/lib/validations/service.schema';

/** D1's documented ceiling, stated here independently of the source constant. */
const D1_MAX_BOUND_PARAMS = 100;

function recordingD1(ownedIds: string[]) {
    const statements: Array<{ sql: string; params: number }> = [];
    const binding = {
        prepare(sql: string) {
            return {
                bind(...params: unknown[]) {
                    statements.push({ sql, params: params.length });
                    const isServices = /from "services"/i.test(sql);
                    return {
                        all: async () => ({ results: [], success: true, meta: {} }),
                        run: async () => ({ results: [], success: true, meta: {} }),
                        raw: async () => (isServices ? ownedIds.map((id) => [id]) : []),
                    };
                },
            };
        },
    };
    return { db: drizzle(binding as never), statements };
}

const ids = (n: number) => Array.from({ length: n }, (_, i) => `svc-${i}`);

describe('bulk service reads and the D1 bound-parameter limit', () => {
    it('the per-request id limit leaves room for the tenant id', () => {
        expect(MAX_BULK_SERVICE_IDS + 1).toBeLessThanOrEqual(D1_MAX_BOUND_PARAMS);
    });

    it('inspectors-by-service at the real cap binds at most 100 parameters per statement', async () => {
        const wanted = ids(MAX_BULK_SERVICE_IDS);
        const { db, statements } = recordingD1(wanted);
        await getServiceInspectorsBulk(db, 'tenant-1', wanted);
        expect(statements.length).toBeGreaterThanOrEqual(2);
        for (const s of statements) expect(s.params, s.sql).toBeLessThanOrEqual(D1_MAX_BOUND_PARAMS);
        expect(Math.max(...statements.map((s) => s.params))).toBe(MAX_BULK_SERVICE_IDS + 1);
    });

    it('pay-rules-by-service at the real cap binds at most 100 parameters per statement', async () => {
        const wanted = ids(MAX_BULK_SERVICE_IDS);
        const { db, statements } = recordingD1(wanted);
        await listPayRulesBulk(db, 'tenant-1', wanted);
        for (const s of statements) expect(s.params, s.sql).toBeLessThanOrEqual(D1_MAX_BOUND_PARAMS);
        expect(Math.max(...statements.map((s) => s.params))).toBe(MAX_BULK_SERVICE_IDS + 1);
    });

    it('the request schema refuses one id more than the cap and accepts exactly the cap', () => {
        expect(BulkServiceIdsQuerySchema.safeParse({ ids: ids(MAX_BULK_SERVICE_IDS).join(',') }).success).toBe(true);
        expect(BulkServiceIdsQuerySchema.safeParse({ ids: ids(MAX_BULK_SERVICE_IDS + 1).join(',') }).success).toBe(false);
    });
});
