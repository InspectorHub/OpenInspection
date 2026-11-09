/**
 * The agent signup page needs the Turnstile site key the server will challenge with.
 *
 * `POST /api/agent-signup` enforces the bot challenge wherever the deployment mandates it
 * (SaaS always, on Cloudflare's published test key when none is configured), but the
 * signup page had no widget, so the form could never carry a token. The terms read the
 * page already makes now also carries `turnstileSiteKey`, resolved by the same function
 * that the booking and verifier pages use, so the widget key and the verifying secret
 * cannot drift. The challenge itself is unchanged: a request without a valid token is
 * still refused.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { DeploymentLegalService } from '../../../server/services/deployment-legal.service';
import { AppError } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';
import { TURNSTILE_TEST_SITE_KEY } from '../../../server/lib/middleware/bot-protection';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
vi.mock('../../../server/lib/rate-limit', () => ({ checkRateLimit: vi.fn().mockResolvedValue(undefined) }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
// eslint-disable-next-line import/order
import agentSignupRoutes from '../../../server/api/agent-signup';

type Env = HonoConfig['Bindings'];
const SAAS: Partial<Env> = { APP_MODE: 'saas' };
const STANDALONE: Partial<Env> = {};

describe('agent signup and the bot challenge', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: ReturnType<typeof createTestDb>['sqlite'];
    let signup: ReturnType<typeof vi.fn>;

    function buildApp() {
        const app = new OpenAPIHono<HonoConfig>();
        app.onError((err, c) => (err instanceof AppError
            ? c.json({ success: false, error: { code: err.code, message: err.message } }, err.status)
            : c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500)));
        app.use('*', async (c, next) => {
            c.set('services', { agent: { signup } } as never);
            await next();
        });
        app.route('/api/agent-signup', agentSignupRoutes);
        vi.mocked(mockDrizzle).mockReturnValue(db as never);
        return app;
    }

    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db as BetterSQLite3Database<typeof schema>;
        sqlite = fixture.sqlite;
        await setupSchema(sqlite);
        signup = vi.fn();
        await new DeploymentLegalService(db as never)
            .recordPublish({ doc: 'agent_terms', version: '2026-08-01', body: 'agent text' });
    });

    afterEach(() => { sqlite.close(); vi.clearAllMocks(); });

    const body = {
        email: 'a@example.com', password: 'correct horse battery staple', name: 'An Agent', termsAccepted: true,
    };
    const post = (env: Partial<Env>, extra: Record<string, string | boolean> = {}) => buildApp().request('/api/agent-signup', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, ...extra }),
    }, env);

    it('the terms read carries the test site key in SaaS when none is configured', async () => {
        const res = await buildApp().request('/api/agent-signup/terms', {}, SAAS);
        const json = await res.json() as { data: { turnstileSiteKey: string | null } };
        expect(json.data.turnstileSiteKey).toBe(TURNSTILE_TEST_SITE_KEY);
    });

    it('the terms read carries the configured site key', async () => {
        const res = await buildApp().request('/api/agent-signup/terms', {}, { ...SAAS, TURNSTILE_SITE_KEY: 'real-site-key' });
        const json = await res.json() as { data: { turnstileSiteKey: string | null } };
        expect(json.data.turnstileSiteKey).toBe('real-site-key');
    });

    it('the terms read carries null where the deployment challenges nobody (standalone default)', async () => {
        const res = await buildApp().request('/api/agent-signup/terms', {}, STANDALONE);
        const json = await res.json() as { data: { turnstileSiteKey: string | null } };
        expect(json.data.turnstileSiteKey).toBeNull();
    });

    it('refuses a SaaS signup that carries no challenge token, and creates nothing', async () => {
        const res = await post(SAAS);
        expect(res.status).toBe(400);
        expect(JSON.stringify(await res.json())).toMatch(/Bot challenge required/);
        expect(signup).not.toHaveBeenCalled();
    });

    it('refuses a SaaS signup whose token fails verification, and creates nothing', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(JSON.stringify({ success: false }), { status: 200 }));
        const res = await post(SAAS, { turnstileToken: 'bad-token' });
        fetchSpy.mockRestore();
        expect(res.status).toBe(400);
        expect(JSON.stringify(await res.json())).toMatch(/Bot challenge failed/);
        expect(signup).not.toHaveBeenCalled();
    });
});
