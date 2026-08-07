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

/**
 * `releaseKey` only runs from a caught exception. A CPU-limit kill, an eviction
 * or a deploy mid-request leaves the row `in_flight` with nobody coming back for
 * it, and nothing sweeps `expires_at` — so before this behaviour existed the row
 * blocked the key permanently.
 *
 * For a webhook that is not a safe refusal: the caller ACKs, the provider stops
 * retrying, and the event is lost with no signal. These tests pin the takeover
 * and, just as importantly, pin that a claim still inside its TTL is NOT stolen.
 */
describe('idempotency store — a claim whose holder never came back', () => {
    beforeEach(async () => {
        const t = createTestDb();
        await setupSchema(t.sqlite);
        db = t.db;
    });

    it('re-claims an in_flight row whose TTL has passed', async () => {
        expect(await claimKey(db as never, { ...BASE, ttlMs: 1 })).toBe('claimed');
        await new Promise((r) => setTimeout(r, 5));
        expect(await claimKey(db as never, { ...BASE, ttlMs: 86_400_000 })).toBe('claimed');
    });

    it('does NOT steal a claim that is still inside its TTL', async () => {
        expect(await claimKey(db as never, BASE)).toBe('claimed');
        expect(await claimKey(db as never, BASE)).toEqual({ state: 'in_flight' });
    });

    it('a completed row is replayed, not stolen, even past its TTL', async () => {
        await claimKey(db as never, { ...BASE, ttlMs: 1 });
        await completeKey(db as never, { tenantId: 't1', key: 'k1', status: 201, body: '{"id":"abc"}' });
        await new Promise((r) => setTimeout(r, 5));
        expect(await claimKey(db as never, { ...BASE, ttlMs: 1 }))
            .toEqual({ state: 'done', status: 201, body: '{"id":"abc"}' });
    });

    it('the takeover re-arms the deadline, so the next caller is refused', async () => {
        await claimKey(db as never, { ...BASE, ttlMs: 1 });
        await new Promise((r) => setTimeout(r, 5));
        expect(await claimKey(db as never, { ...BASE, ttlMs: 86_400_000 })).toBe('claimed');
        expect(await claimKey(db as never, { ...BASE, ttlMs: 86_400_000 })).toEqual({ state: 'in_flight' });
    });
});
