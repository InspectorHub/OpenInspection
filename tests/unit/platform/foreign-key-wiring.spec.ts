/**
 * The foreign-key answer is WIRED into the real application.
 *
 * `foreign-key-violation.spec.ts` proves the mapping function, but it builds its
 * own app and its own `onError`, so removing the call from the global handler in
 * `server/index.ts` left every one of those tests green and put the 500s back.
 * These tests drive the handler the application really registered:
 *
 *  - a REAL route, through the real middleware chain and a real database whose
 *    refusal is worded the way SQLite words it, answers 400 / 409;
 *  - the real handler (`app.errorHandler`, not a copy) leaves the families whose
 *    callers retry on a 5xx alone, and maps an ordinary path (positive control).
 *
 * Proven red by removing the `foreignKeyResponse` line from `server/index.ts`.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Hono } from 'hono';
import { app } from '../../../server/index';
import { buildKeyring, signJwt } from '../../../server/lib/jwt-keyring';
import { logger } from '../../../server/lib/logger';
import type { HonoConfig } from '../../../server/types/hono';
import { makeExecutionContext } from '../helpers/exec-ctx';
import { createHarness, OWNER_ID, TENANT_ID, type Harness } from '../helpers/tenant-email-harness';

const REFUSAL = 'FOREIGN KEY constraint failed';

async function ownerToken(h: Harness): Promise<string> {
    const keyring = await buildKeyring(h.env as unknown as Record<string, string | undefined>);
    const now = Math.floor(Date.now() / 1000);
    return signJwt(
        { sub: OWNER_ID, 'custom:tenantId': TENANT_ID, 'custom:userRole': 'owner', iat: now, exp: now + 3600 },
        keyring,
    );
}

async function call(h: Harness, token: string, method: string, path: string, body?: unknown) {
    const exec = makeExecutionContext({ label: 'fk-wiring' });
    const res = await app.request(path, {
        method,
        headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
    }, h.env, exec.ctx);
    await exec.settle();
    return res;
}

afterEach(() => { vi.restoreAllMocks(); });

describe('the real application maps a foreign-key refusal from a real route', () => {
    it('answers 400 when an insert is refused, and 409 when a delete is', async () => {
        vi.spyOn(logger, 'error').mockImplementation(() => undefined);
        const h = await createHarness('standalone');
        try {
            const token = await ownerToken(h);

            // Control first: with no trigger the very same requests succeed, so the
            // statuses below can only come from the refusal.
            const created = await call(h, token, 'POST', '/api/contacts', { name: 'Control Person', type: 'client' });
            expect(created.status).toBe(201);
            const createdId = ((await created.json()) as { data: { contact: { id: string } } }).data.contact.id;

            // The database now refuses writes to contacts the way SQLite words a foreign-key refusal.
            h.sqlite.exec(`CREATE TRIGGER refuse_contact_insert BEFORE INSERT ON contacts BEGIN SELECT RAISE(ABORT, '${REFUSAL}'); END;`);
            h.sqlite.exec(`CREATE TRIGGER refuse_contact_delete BEFORE DELETE ON contacts BEGIN SELECT RAISE(ABORT, '${REFUSAL}'); END;`);

            const insert = await call(h, token, 'POST', '/api/contacts', { name: 'Refused Person', type: 'client' });
            expect(insert.status).toBe(400);
            expect(JSON.stringify(await insert.json())).toContain('does not exist');

            const del = await call(h, token, 'DELETE', `/api/contacts/${createdId}`);
            expect(del.status).toBe(409);
            expect(JSON.stringify(await del.json())).toContain('still in use');
        } finally { h.close(); }
    }, 60_000);

    it('control: a database failure that is not a foreign-key refusal is still a 500', async () => {
        vi.spyOn(logger, 'error').mockImplementation(() => undefined);
        const h = await createHarness('standalone');
        try {
            const token = await ownerToken(h);
            h.sqlite.exec(`CREATE TRIGGER refuse_contact_insert BEFORE INSERT ON contacts BEGIN SELECT RAISE(ABORT, 'disk is on fire'); END;`);
            const res = await call(h, token, 'POST', '/api/contacts', { name: 'Refused Person', type: 'client' });
            expect(res.status).toBe(500);
        } finally { h.close(); }
    }, 60_000);
});

describe('the application\'s own error handler, by path family', () => {
    // The handler is read off the real app, so this is the registered function and not a copy of it.
    // Hono keeps it on a private field; reading it is the only way to hand the very same function to a
    // minimal app that can throw from any path.
    const registered = (app as unknown as { errorHandler: Parameters<typeof app.onError>[0] }).errorHandler;
    const probe = (path: string) => {
        const mini = new Hono<HonoConfig>();
        mini.onError(registered);
        mini.all('/*', () => { throw new Error(REFUSAL); });
        vi.spyOn(logger, 'error').mockImplementation(() => undefined);
        return mini.request(path, { method: 'POST' });
    };

    it.each(['/api/contacts', '/api/inspections/abc'])('maps a refusal on %s (positive control)', async (path) => {
        expect((await probe(path)).status).toBe(400);
    });

    it.each([
        '/webhooks/stripe/acme',
        '/m2m/agreements/render',
        '/api/platform/tenants',
        '/api/integrations/qbo/callback',
        '/.well-known/oauth-authorization-server',
    ])('leaves %s as a 500, so its caller still retries', async (path) => {
        expect((await probe(path)).status).toBe(500);
    });
});
