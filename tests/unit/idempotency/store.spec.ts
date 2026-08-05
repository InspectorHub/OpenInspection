import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, setupSchema } from '../db';
import { claimKey, completeKey } from '../../../server/lib/idempotency/store';

const BASE = { tenantId: 't1', key: 'k1', fingerprint: 'fp1', ttlMs: 86_400_000 };
let db: ReturnType<typeof createTestDb>['db'];

describe('idempotency store', () => {
    beforeEach(async () => {
        const t = createTestDb();
        await setupSchema(t.sqlite);
        db = t.db;
    });

    it('first claim wins', async () => {
        expect(await claimKey(db as never, BASE)).toBe('claimed');
    });

    it('a second claim while in flight does NOT execute — it reports in_flight', async () => {
        await claimKey(db as never, BASE);
        expect(await claimKey(db as never, BASE)).toEqual({ state: 'in_flight' });
    });

    it('after completion the stored response is replayed verbatim', async () => {
        await claimKey(db as never, BASE);
        await completeKey(db as never, { tenantId: 't1', key: 'k1', status: 201, body: '{"id":"abc"}' });
        expect(await claimKey(db as never, BASE)).toEqual({ state: 'done', status: 201, body: '{"id":"abc"}' });
    });

    it('same key + different fingerprint is a mismatch, never a replay', async () => {
        await claimKey(db as never, BASE);
        await completeKey(db as never, { tenantId: 't1', key: 'k1', status: 201, body: '{}' });
        expect(await claimKey(db as never, { ...BASE, fingerprint: 'DIFFERENT' }))
            .toEqual({ state: 'fingerprint_mismatch' });
    });

    it('the same key under a different tenant is a different key', async () => {
        await claimKey(db as never, BASE);
        expect(await claimKey(db as never, { ...BASE, tenantId: 't2' })).toBe('claimed');
    });
});
