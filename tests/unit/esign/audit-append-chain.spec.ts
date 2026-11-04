/**
 * The audit chain's append path: one writer wins a position, a failed write is never reported as someone else's row, a signed event is
 * recorded only for a signer who can still sign, and a signature is refused when its audit row cannot be written.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { AuditLogService } from '../../../server/services/audit-log.service';
import { logger } from '../../../server/lib/logger';
import { SigningKeyService } from '../../../server/services/signing-key.service';

const TENANT = '00000000-0000-0000-0000-000000000001';
const REQ = '00000000-0000-0000-0000-000000000100';

describe('AuditLogService.append', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let svc: AuditLogService;

    /** The service sees the real in-memory database through this wrapper, which can make chosen statements fail. */
    function install(failWith?: () => Error | null) {
        const wrapped = new Proxy(db, {
            get(target, prop, receiver) {
                const value = Reflect.get(target, prop, receiver) as unknown;
                if ((prop === 'insert' || prop === 'run') && typeof value === 'function') {
                    return (...args: unknown[]) => {
                        const err = failWith?.();
                        if (err) throw err;
                        return (value as (...a: unknown[]) => unknown).apply(target, args);
                    };
                }
                return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
            },
        });
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(wrapped);
    }

    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        await setupSchema(fixture.sqlite);
        await db.insert(schema.tenants).values({ id: TENANT, slug: 'acme', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() });
        install();
        svc = new AuditLogService({} as D1Database, new SigningKeyService({} as D1Database, 'unit-test-key-encryption-secret-32b'));
    });
    afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

    const rows = () => db.select().from(schema.esignAuditLogs)
        .where(and(eq(schema.esignAuditLogs.tenantId, TENANT), eq(schema.esignAuditLogs.requestId, REQ))).all();

    it('C1: appends that run at the same time each take their own position, and the chain verifies', async () => {
        const retries = vi.spyOn(logger, 'info');
        await svc.append(TENANT, REQ, 'request.created', { at: 0 });
        await Promise.all(Array.from({ length: 8 }, (_v, i) => svc.append(TENANT, REQ, 'signer.signed', { signerId: `s${i}`, n: i })));
        const all = await rows();
        expect(all).toHaveLength(9);
        // No two rows share a predecessor: the chain is a line, not a tree.
        expect(new Set(all.map((r) => r.prevHash ?? 'none')).size).toBe(9);
        expect(await svc.verifyChain(TENANT, REQ)).toEqual({ valid: true, events: 9 });
        // The race really happened: some appends lost their position and took the next one (without that, this test proves nothing).
        expect(retries.mock.calls.filter((c) => c[0] === 'audit.append.position_taken').length).toBeGreaterThan(0);
    });

    it('C1 (regression pin: it passed before the fix too): appends in the same millisecond still link in the order they were written', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(1_800_000_000_000));
        for (let i = 0; i < 4; i++) await svc.append(TENANT, REQ, 'signer.reminded', { signerId: 's', n: i });
        expect(await svc.verifyChain(TENANT, REQ)).toEqual({ valid: true, events: 4 });
    });

    it('C4: a write that fails is thrown, never answered with another signer row', async () => {
        await svc.append(TENANT, REQ, 'signer.signed', { signerId: 'first' });
        install(() => new Error('D1_ERROR: network connection lost'));
        await expect(svc.append(TENANT, REQ, 'signer.signed', { signerId: 'second' })).rejects.toThrow(/network connection lost/);
        install();
        expect(await rows()).toHaveLength(1);
        // Control: an envelope-level event that really is a duplicate is still answered with the row it duplicates.
        const first = await svc.append(TENANT, REQ, 'agreement.signed', { v: 1 });
        const again = await svc.append(TENANT, REQ, 'agreement.signed', { v: 2 });
        expect(again.id).toBe(first.id);
    });

    it('C4: an envelope-level event whose write fails for another reason is thrown too', async () => {
        await svc.append(TENANT, REQ, 'agreement.signed', { v: 1 });
        install(() => new Error('D1_ERROR: database is locked'));
        await expect(svc.append(TENANT, REQ, 'workflow.complete', { v: 1 })).rejects.toThrow(/locked/);
        // Even for the event type that already has a row: only a unique-constraint failure means "already recorded".
        await expect(svc.append(TENANT, REQ, 'agreement.signed', { v: 2 })).rejects.toThrow(/locked/);
    });

    it('C3/C13: an event marked once-per-signer is not appended twice for the same signer, and is for another', async () => {
        const a = await svc.append(TENANT, REQ, 'signer.signed', { signerId: 's1', n: 1 }, { dedupe: { signerId: 's1' } });
        const again = await svc.append(TENANT, REQ, 'signer.signed', { signerId: 's1', n: 2 }, { dedupe: { signerId: 's1' } });
        expect(again.id).toBe(a.id);
        await svc.append(TENANT, REQ, 'signer.signed', { signerId: 's2', n: 3 }, { dedupe: { signerId: 's2' } });
        expect(await rows()).toHaveLength(2);
        expect(await svc.verifyChain(TENANT, REQ)).toEqual({ valid: true, events: 2 });
    });

    it('C13: a repeat presentation of the same content to the same signer inside the window adds no row; new content, another signer or a later window does', async () => {
        const window = (signerId: string, contentHash: string) => ({ dedupe: { signerId, match: { contentHash }, windowMs: 60_000 } });
        await svc.append(TENANT, REQ, 'signer.presented', { signerId: 's1', contentHash: 'h1', presentedAt: 1 }, window('s1', 'h1'));
        await svc.append(TENANT, REQ, 'signer.presented', { signerId: 's1', contentHash: 'h1', presentedAt: 2 }, window('s1', 'h1'));
        expect(await rows()).toHaveLength(1);
        await svc.append(TENANT, REQ, 'signer.presented', { signerId: 's1', contentHash: 'h2' }, window('s1', 'h2'));
        await svc.append(TENANT, REQ, 'signer.presented', { signerId: 's2', contentHash: 'h1' }, window('s2', 'h1'));
        expect(await rows()).toHaveLength(3);
        // Outside the window the same presentation is recorded again.
        await db.update(schema.esignAuditLogs).set({ createdAt: new Date(Date.now() - 120_000) }).where(eq(schema.esignAuditLogs.requestId, REQ));
        await svc.append(TENANT, REQ, 'signer.presented', { signerId: 's1', contentHash: 'h1', presentedAt: 3 }, window('s1', 'h1'));
        expect(await rows()).toHaveLength(4);
    });

    it('a newest row dated in the future (another isolate\'s clock) does not break the chain or fork the next append', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(Date.now() + 3_600_000));
        await svc.append(TENANT, REQ, 'request.created', { at: 1 });
        vi.useRealTimers();
        // This isolate's clock is an hour behind the row it is about to follow.
        await svc.append(TENANT, REQ, 'signer.presented', { signerId: 's1' });
        await svc.append(TENANT, REQ, 'signer.signed', { signerId: 's1' });
        const all = await rows();
        expect(new Set(all.map((r) => r.prevHash ?? 'none')).size).toBe(3);
        const times = all.map((r) => r.createdAt.getTime());
        expect([...times].sort((a, b) => a - b)).toEqual(times);
        expect(await svc.verifyChain(TENANT, REQ)).toEqual({ valid: true, events: 3 });
    });

    it('the once-only guard looks at the NEWEST row of the signer: A, then B, then A again records A again; B twice does not', async () => {
        const guard = (hash: string | null) => ({ dedupe: { signerId: 's1', match: { signatureImageHash: hash } } });
        await svc.append(TENANT, REQ, 'signer.signed', { signerId: 's1', signatureImageHash: 'A' }, guard('A'));
        await svc.append(TENANT, REQ, 'signer.signed', { signerId: 's1', signatureImageHash: 'B' }, guard('B'));
        await svc.append(TENANT, REQ, 'signer.signed', { signerId: 's1', signatureImageHash: 'B' }, guard('B'));
        expect(await rows()).toHaveLength(2);
        await svc.append(TENANT, REQ, 'signer.signed', { signerId: 's1', signatureImageHash: 'A' }, guard('A'));
        const images = (await rows()).map((r) => (JSON.parse(r.payloadJson) as { signatureImageHash: string }).signatureImageHash);
        expect(images).toEqual(['A', 'B', 'A']);
        // Another signer is judged on their own rows.
        await svc.append(TENANT, REQ, 'signer.signed', { signerId: 's2', signatureImageHash: 'A' }, { dedupe: { signerId: 's2', match: { signatureImageHash: 'A' } } });
        expect(await rows()).toHaveLength(4);
    });

    it('when every position is lost the append says so (503) after the allowed attempts, and does not hang', async () => {
        const taken = vi.spyOn(logger, 'info');
        const wrapped = new Proxy(db, {
            get(target, prop, receiver) {
                const value = Reflect.get(target, prop, receiver) as unknown;
                if (prop === 'run' && typeof value === 'function') return async () => ({ changes: 0 });
                return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
            },
        });
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(wrapped);
        await expect(svc.append(TENANT, REQ, 'signer.signed', { signerId: 's1' })).rejects.toMatchObject({ status: 503 });
        expect(taken.mock.calls.filter((c) => c[0] === 'audit.append.position_taken')).toHaveLength(8);
    });

    it('losing the last attempt to the once-only guard returns the row that won, not a 503', async () => {
        let runs = 0;
        const wrapped = new Proxy(db, {
            get(target, prop, receiver) {
                const value = Reflect.get(target, prop, receiver) as unknown;
                if (prop === 'run' && typeof value === 'function') {
                    return async () => {
                        runs += 1;
                        // On the last attempt the row appears (written by the other request) just before this insert is refused.
                        if (runs === 8) {
                            await target.insert(schema.esignAuditLogs).values({
                                id: 'winner', tenantId: TENANT, requestId: REQ, event: 'signer.signed', payloadJson: JSON.stringify({ signerId: 's1' }),
                                prevHash: null, hash: 'w'.repeat(64), signature: 'sig', keyFingerprint: 'fp', createdAt: new Date(),
                            });
                        }
                        return { changes: 0 };
                    };
                }
                return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
            },
        });
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(wrapped);
        const result = await svc.append(TENANT, REQ, 'signer.signed', { signerId: 's1' }, { dedupe: { signerId: 's1' } });
        expect(result.id).toBe('winner');
        expect(runs).toBe(8);
    });
});
