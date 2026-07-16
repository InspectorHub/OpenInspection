/**
 * Calendar multiprovider connect — API-level E2E (no real Google calls).
 *
 * Seeds encrypted calendar_connections rows directly, then exercises
 * capability gating + disconnect against the running worker.
 */
import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';
import { existsSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
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

function wranglerCfg(): string {
    return process.env.WRANGLER_CONFIG ||
        (existsSync(resolve(APP_DIR, 'wrangler.local.jsonc')) ? 'wrangler.local.jsonc' : 'wrangler.jsonc');
}

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

function d1ExecuteSql(sql: string) {
    const file = resolve(os.tmpdir(), `cal-e2e-${Date.now()}.sql`);
    writeFileSync(file, sql, 'utf8');
    const cfg = wranglerCfg();
    try {
        execSync(`npx wrangler d1 execute DB --local -c ${cfg} --file "${file}" --yes`, {
            cwd: APP_DIR,
            stdio: 'pipe',
        });
    } finally {
        rmSync(file, { force: true });
    }
}

async function seedConnection(
    tenantId: string,
    userId: string,
    capability: 'availability_read' | 'events_read_write',
) {
    const sealed = await sealCredentials(
        { refreshToken: 'e2e-fake-refresh', scopes: capability === 'events_read_write' ? ['calendar.events'] : ['calendar.freebusy'] },
        tenantId,
        JWT_SECRET,
    );
    const now = Date.now();
    const id = crypto.randomUUID();
    // Escape single quotes in base64 blobs for SQL literal safety.
    const enc = sealed.credentialsEnc.replace(/'/g, "''");
    const dek = sealed.credentialsDekEnc.replace(/'/g, "''");
    d1ExecuteSql(`
DELETE FROM calendar_connections WHERE user_id = '${userId}';
INSERT INTO calendar_connections (
  id, tenant_id, user_id, provider, auth_type,
  credentials_enc, credentials_dek_enc, capabilities, calendar_id,
  connected_at, updated_at
) VALUES (
  '${id}', '${tenantId}', '${userId}', 'google', 'oauth',
  '${enc}', '${dek}', '${capability}', 'primary',
  ${now}, ${now}
);
`);
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
        await seedConnection(session.tenantId, session.userId, 'availability_read');
        const res = await request.post(`${BASE_URL}/api/calendar/sync-events`, {
            headers: authedHeaders(session.cookie),
        });
        expect(res.status()).toBe(403);
    });

    test('DELETE /api/calendar/disconnect removes calendar_connections row', async ({ request }) => {
        const session = await loginSession(request);
        await seedConnection(session.tenantId, session.userId, 'events_read_write');
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
