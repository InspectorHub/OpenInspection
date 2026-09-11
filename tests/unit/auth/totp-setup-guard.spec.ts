/**
 * /2fa/setup on an account that already has a second factor.
 *
 * Setup overwrites the TOTP secret and clears `totpEnabled` until /2fa/verify
 * proves the new one. Run against an ENROLLED account that is a disable — and
 * /2fa/disable demands password + code precisely so a session alone cannot
 * strip the second factor. Setup demanded nothing, so one POST with a stolen
 * or shared-device session turned 2FA off. It now refuses with 409.
 *
 * Also: the authenticated code endpoints never called the rate limiter, so a
 * six-digit code could be brute-forced at full speed by anyone holding a
 * session and password. They share the login limiter's shape now.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { eq } from 'drizzle-orm';
import { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import totpRoutes from '../../../server/api/auth/totp';
import type { HonoConfig } from '../../../server/types/hono';
import { AppError } from '../../../server/lib/errors';
import { createTestDb, setupSchema } from '../db';
import { users, tenants } from '../../../server/lib/db/schema';
import * as schema from '../../../server/lib/db/schema';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const USER = 'u-enrolled';

describe('POST /api/auth/2fa/setup — an enrolled account', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let sqlite: { close(): void };

    function buildApp() {
        const app = new OpenAPIHono<HonoConfig>();
        app.use('*', async (c, next) => {
            c.set('user', { sub: USER, tenantId: 't1', role: 'owner' } as never);
            c.set('services', {
                totp: {
                    generateSecret: () => 'NEWSECRET',
                    generateRecoveryCodes: () => ['a', 'b'],
                    hashCode: async (s: string) => `h:${s}`,
                    buildOtpAuthUrl: () => 'otpauth://x',
                    qrCodeDataUri: async () => 'data:,',
                    verifyCode: () => false,
                },
            } as unknown as HonoConfig['Variables']['services']);
            await next();
        });
        app.route('/api/auth', totpRoutes);
        // Mirrors server/index.ts's global onError, as the agent route specs do.
        app.onError((err, c) => {
            if (err instanceof AppError) return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status);
            return c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500);
        });
        return app;
    }

    beforeEach(async () => {
        const setup = createTestDb();
        testDb = setup.db;
        sqlite = setup.sqlite;
        await setupSchema(setup.sqlite);
        (mockDrizzle as unknown as { mockReturnValue(v: unknown): void }).mockReturnValue(testDb);
        await testDb.insert(tenants).values({ id: 't1', slug: 'test', createdAt: new Date() });
        await testDb.insert(users).values({
            id: USER, tenantId: 't1', email: 'e@x.com', passwordHash: 'H', role: 'owner',
            createdAt: new Date(), totpSecret: 'LIVESECRET', totpEnabled: true, totpVerifiedAt: new Date(),
        });
    });
    afterEach(() => { sqlite.close(); vi.clearAllMocks(); });

    it('refuses with 409 and leaves the live secret untouched', async () => {
        const res = await buildApp().request('/api/auth/2fa/setup', { method: 'POST' }, { DB: {} });
        expect(res.status).toBe(409);
        const row = await testDb.select().from(users).where(eq(users.id, USER)).get();
        expect(row?.totpEnabled).toBe(true);
        expect(row?.totpSecret).toBe('LIVESECRET');
    });

    it('rate-limits code entry on /2fa/verify like login does', async () => {
        const env = { DB: {}, RATE_LIMITER: { limit: async () => ({ success: false }) } };
        const res = await buildApp().request(
            '/api/auth/2fa/verify',
            { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: '000000' }) },
            env,
        );
        expect(res.status).toBe(429);
    });
});
