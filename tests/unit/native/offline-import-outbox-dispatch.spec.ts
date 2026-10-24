// applyOutbox replays each queued write through the API app it is handed by
// getApiApp(): the registered app is the only thing that sees the replayed
// requests, and without a registration the replay fails before any write.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Context } from 'hono';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { HonoConfig } from '../../../server/types/hono';
import type { InProcessApp } from '../../../server/lib/api-app';
import type { OutboxEntry } from '@core/offline-package';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = 'tenant-outbox-1';
const USER = 'user-outbox-1';
const ctxStub = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

let testDb: BetterSQLite3Database<typeof schema>;

function fakeContext(env: Record<string, unknown>): Context<HonoConfig> {
    const headers: Record<string, string> = { authorization: 'Bearer caller-token', cookie: 'sid=1' };
    return {
        env,
        executionCtx: ctxStub,
        get: (key: string) => (key === 'tenantId' ? TENANT : key === 'user' ? { sub: USER } : undefined),
        req: { url: 'https://app.example.com/api/client/import', header: (name: string) => headers[name] },
    } as unknown as Context<HonoConfig>;
}

const entries: OutboxEntry[] = [
    { idempotencyKey: 'key-update-1', op: 'inspection.update', payload: { id: 'insp-1', notes: 'n' } },
    { idempotencyKey: 'key-complete-1', op: 'inspection.complete', payload: { id: 'insp-1' } },
];

async function load() {
    vi.resetModules();
    const registry = await import('../../../server/lib/api-app');
    const outbox = await import('../../../server/services/offline-import-outbox');
    return { ...registry, ...outbox };
}

describe('applyOutbox dispatch through the registered API app', () => {
    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        await setupSchema(fix.sqlite);
        vi.mocked(mockDrizzle).mockReturnValue(testDb as never);
    });

    it('replays every entry, in order, to the registered app with the caller credentials and records each', async () => {
        const m = await load();
        const seen: Array<{ method: string; path: string; auth: string | null; key: string | null; env: unknown; ctx: unknown }> = [];
        const app: InProcessApp = {
            fetch: async (req, env, ctx) => {
                seen.push({
                    method: req.method,
                    path: new URL(req.url).pathname,
                    auth: req.headers.get('authorization'),
                    key: req.headers.get('idempotency-key'),
                    env,
                    ctx,
                });
                return new Response('{}', { status: 200 });
            },
            getOpenAPIDocument: () => ({}),
        };
        m.registerApiAppLoader(async () => app);

        const c = fakeContext({ DB: {} });
        const result = await m.applyOutbox(c, entries, { tolerateRefusals: false });

        expect(result).toEqual({ applied: 2, skipped: 0, failed: [] });
        expect(seen.map((s) => `${s.method} ${s.path}`)).toEqual([
            'PATCH /api/inspections/insp-1',
            'POST /api/inspections/insp-1/complete',
        ]);
        expect(seen.map((s) => s.key)).toEqual(['key-update-1', 'key-complete-1']);
        expect(seen.every((s) => s.auth === 'Bearer caller-token')).toBe(true);
        expect(seen.every((s) => s.ctx === ctxStub)).toBe(true);
        const rows = await testDb.select().from(schema.offlineImportApplied);
        expect(rows.map((r) => r.idempotencyKey).sort()).toEqual(['key-complete-1', 'key-update-1']);
    });

    it('rejects before replaying anything, and records nothing, when no app loader is registered', async () => {
        const m = await load();
        await expect(m.applyOutbox(fakeContext({ DB: {} }), entries, { tolerateRefusals: false })).rejects.toThrow(/loader is not registered/);
        const rows = await testDb.select().from(schema.offlineImportApplied);
        expect(rows).toHaveLength(0);
    });

    it('does not ask for the app when there is nothing to replay', async () => {
        const m = await load();
        const loader = vi.fn(async () => ({ fetch: async () => new Response('{}'), getOpenAPIDocument: () => ({}) }));
        m.registerApiAppLoader(loader);
        const result = await m.applyOutbox(fakeContext({ DB: {} }), [], { tolerateRefusals: false });
        expect(result).toEqual({ applied: 0, skipped: 0, failed: [] });
        expect(loader).not.toHaveBeenCalled();
    });
});
