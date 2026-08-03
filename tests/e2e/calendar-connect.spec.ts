/**
 * Calendar multiprovider connect — API-level E2E (no real Google calls).
 *
 * Seeds encrypted calendar_connections rows through a fail-closed test hook
 * on the running worker, then exercises capability gating + disconnect.
 */
import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDevVars } from '../helpers/dev-vars';
import { sealCredentials } from '../../server/lib/calendar/credentials';
import { csrfHeaders } from './helpers/csrf';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_DIR = resolve(__dirname, '../..');
const BASE_URL = 'http://127.0.0.1:8789';

const ADMIN_EMAIL = 'admin@autotest.com';
const ADMIN_PASSWORD = 'Password123!';

const env = loadDevVars(APP_DIR);
const JWT_SECRET = env.JWT_SECRET || 'dev-jwt-secret-change-me-in-production';

function decodeJwtPayload(token: string): { sub: string; 'custom:tenantId'?: string } {
    const payload = token.split('.')[1] ?? '';
    const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return JSON.parse(json) as { sub: string; 'custom:tenantId'?: string };
}

/** Auth cookie + matching CSRF double-submit pair for mutating API calls. */
function authedHeaders(sessionCookie: string): Record<string, string> {
    const { token, headers } = csrfHeaders();
    return {
        'X-CSRF-Token': token,
        Cookie: `${headers.Cookie}; ${sessionCookie}`,
    };
}

async function loginSession(request: import('@playwright/test').APIRequestContext): Promise<{
    cookie: string;
    token: string;
    userId: string;
    tenantId: string;
}> {
    const csrf = csrfHeaders();
    const res = await request.post(`${BASE_URL}/api/auth/login`, {
        data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
        headers: {
            'Content-Type': 'application/json',
            ...csrf.headers,
        },
    });
    expect(res.status(), `login expected 200, got ${res.status()}`).toBe(200);
    const setCookie = res.headers()['set-cookie'] ?? '';
    const match = setCookie.match(/__Host-inspector_token=([^;]+)/);
    expect(match?.[1]).toBeTruthy();
    const token = match![1];
    const claims = decodeJwtPayload(token);
    const tenantId = claims['custom:tenantId'];
    expect(tenantId).toBeTruthy();
    return {
        cookie: `__Host-inspector_token=${token}`,
        token,
        userId: claims.sub,
        tenantId: tenantId!,
    };
}

async function seedConnection(
    request: APIRequestContext,
    tenantId: string,
    userId: string,
    capability: 'availability_read' | 'events_read_write',
) {
    const sealed = await sealCredentials(
        { refreshToken: 'e2e-fake-refresh', scopes: capability === 'events_read_write' ? ['calendar.events'] : ['calendar.freebusy'] },
        tenantId,
        JWT_SECRET,
    );
    // Through the worker, not `wrangler d1 execute --local`. The CLI takes an
    // exclusive lock on the SQLite file the dev worker is serving from, which is
    // why this suite used to be pinned to workers:1 — under any real
    // concurrency the other workers' requests died with ECONNRESET.
    const res = await request.post(`${BASE_URL}/api/__test__/calendar-connection`, {
        data: {
            id: crypto.randomUUID(),
            tenantId,
            userId,
            capability,
            credentialsEnc: sealed.credentialsEnc,
            credentialsDekEnc: sealed.credentialsDekEnc,
        },
    });
    expect(res.status(), 'calendar-connection seed hook must be enabled (E2E_EMAIL_SINK=1)').toBe(200);
}

test.describe('Calendar connect — capability gating', () => {
    test('GET /api/calendar/connect?capability=availability_read includes PKCE + freebusy scope', async ({ request }) => {
        test.skip(!env.GOOGLE_CLIENT_ID || env.GOOGLE_CLIENT_ID.includes('your_'), 'GOOGLE_CLIENT_ID not configured in .dev.vars');

        const { cookie } = await loginSession(request);
        const res = await request.get(`${BASE_URL}/api/calendar/connect?capability=availability_read`, {
            headers: { Cookie: cookie },
            maxRedirects: 0,
        });
        expect([301, 302]).toContain(res.status());
        const location = res.headers().location ?? '';
        expect(location).toContain('accounts.google.com');
        expect(location).toContain('code_challenge=');
        expect(location).toContain('calendar.freebusy');
    });

    test('POST /api/calendar/sync-events returns 403 for availability_read connection', async ({ request }) => {
        const session = await loginSession(request);
        await seedConnection(request, session.tenantId, session.userId, 'availability_read');
        const res = await request.post(`${BASE_URL}/api/calendar/sync-events`, {
            headers: authedHeaders(session.cookie),
        });
        expect(res.status()).toBe(403);
    });

    test('DELETE /api/calendar/disconnect removes calendar_connections row', async ({ request }) => {
        const session = await loginSession(request);
        await seedConnection(request, session.tenantId, session.userId, 'events_read_write');
        const del = await request.delete(`${BASE_URL}/api/calendar/disconnect`, {
            headers: authedHeaders(session.cookie),
        });
        expect(del.ok()).toBe(true);

        const sync = await request.post(`${BASE_URL}/api/calendar/sync-events`, {
            headers: authedHeaders(session.cookie),
        });
        expect(sync.status()).toBe(400);
    });
});
