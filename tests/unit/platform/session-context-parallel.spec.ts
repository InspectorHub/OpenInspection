/**
 * GET /api/session/context runs on every page load of the signed-in app. Its
 * secondary reads (seat usage, video provider, cooling-window anchor, unread
 * badge) do not depend on each other, so they run as ONE wave: total time is
 * the slowest read, not the sum.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { HonoConfig } from '../../../server/types/hono';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const SLOW_MS = 150;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let startedReads = 0;
let startedAtFirstCompletion = 0;
const slowRead = async <T>(value: T): Promise<T> => {
    startedReads += 1;
    await sleep(SLOW_MS);
    if (startedAtFirstCompletion === 0) startedAtFirstCompletion = startedReads;
    return value;
};
const hooks = vi.hoisted(() => ({
    seat: vi.fn(),
    video: vi.fn(),
}));
vi.mock('../../../server/features/seat-quota', () => ({ getSeatUsage: hooks.seat }));
vi.mock('../../../server/services/video/resolve', () => ({
    resolveVideoProvider: hooks.video,
    videoStreamServiceable: (r: { provider: string }) => r.provider === 'stream',
}));

import sessionContextRoutes from '../../../server/api/session-context';

const TENANT_ID = '00000000-0000-0000-0000-000000000077';
let testDb: BetterSQLite3Database<typeof schema>;
const unread = vi.fn();

beforeEach(async () => {
    startedReads = 0;
    startedAtFirstCompletion = 0;
    const fixture = createTestDb();
    testDb = fixture.db;
    await setupSchema(fixture.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
    await testDb.insert(schema.tenants).values({ id: TENANT_ID, slug: 'co', tier: 'free', status: 'active', deploymentMode: 'shared', createdAt: new Date() });
    await testDb.insert(schema.users).values({
        id: 'u-1', tenantId: TENANT_ID, email: 'u@example.com', passwordHash: 'x', role: 'inspector', createdAt: new Date(),
    } as never);
    hooks.seat.mockReset().mockImplementation(() => slowRead({ used: 2, max: 5 }));
    hooks.video.mockReset().mockImplementation(() => slowRead({ provider: 'stream' }));
    unread.mockReset().mockImplementation(() => slowRead(7));
});

function buildApp() {
    const app = new OpenAPIHono<HonoConfig>();
    app.use('*', async (c, next) => {
        c.set('user', { sub: 'u-1', role: 'inspector' } as never);
        c.set('tenantId', TENANT_ID);
        c.set('branding', { tenantSlug: 'co' } as never);
        c.set('profile', { mode: 'saas', hasBilling: true, hasSeatQuota: true, videoBackendManaged: true } as never);
        c.set('services' as never, { message: { unreadCountForTenant: unread } } as never);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (c as any).env = { APP_MODE: 'saas', DB: {} as D1Database };
        await next();
    });
    app.route('/api/session', sessionContextRoutes);
    return app;
}

type Body = { data: { seatUsage: unknown; videoProvider: string; unreadMessages: number; outboundCoolingWindow: unknown } };

describe('session context secondary reads', () => {
    it('finish in about the time of the slowest read, not the sum of all of them', async () => {
        const res = await buildApp().request('/api/session/context');
        expect(res.status).toBe(200);
        const body = await res.json() as Body;
        expect(body.data.seatUsage).toEqual({ used: 2, limit: 5 });
        expect(body.data.videoProvider).toBe('stream');
        expect(body.data.unreadMessages).toBe(7);
        // A serial implementation would finish its first read before starting the other two.
        // Concurrent reads all start before any of the delayed reads can finish.
        expect(startedAtFirstCompletion).toBe(3);
    });

    it('a video provider failure still falls back to r2 and leaves the other answers intact', async () => {
        hooks.video.mockReset().mockRejectedValue(new Error('boom'));
        const res = await buildApp().request('/api/session/context');
        const body = await res.json() as Body;
        expect(body.data.videoProvider).toBe('r2');
        expect(body.data.seatUsage).toEqual({ used: 2, limit: 5 });
        expect(body.data.unreadMessages).toBe(7);
    });

    it('a seat usage or unread failure degrades only that field', async () => {
        hooks.seat.mockReset().mockRejectedValue(new Error('seat down'));
        unread.mockReset().mockRejectedValue(new Error('unread down'));
        const body = await (await buildApp().request('/api/session/context')).json() as Body;
        expect(body.data.seatUsage).toBeNull();
        expect(body.data.unreadMessages).toBe(0);
        expect(body.data.videoProvider).toBe('stream');
    });

    it('the unread count is scoped from the capabilities the user row yields', async () => {
        await buildApp().request('/api/session/context');
        expect(unread).toHaveBeenCalledTimes(1);
        const [tenant, scope] = unread.mock.calls[0] as [string, unknown];
        expect(tenant).toBe(TENANT_ID);
        expect(scope).toBeTruthy();
    });
});
