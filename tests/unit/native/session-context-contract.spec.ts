/**
 * GET /api/session/context is called by installed native apps, so it is part of the native contract.
 *
 * It is a declared OpenAPI operation now. These specs drive the REAL application (real middleware,
 * real JWT auth) and pin what a caller observes: the route answers 401 without a session, answers
 * the same body shape with one, and the declared response schema accepts what the handler returns
 * (a schema narrower than the handler would be a lie the contract file tells installed apps).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { app } from '../../../server/index';
import { makeExecutionContext } from '../helpers/exec-ctx';
import { createHarness, TENANT_ID, OWNER_ID, type Harness } from '../helpers/tenant-email-harness';
import { buildKeyring, signJwt } from '../../../server/lib/jwt-keyring';
import { buildOpenApiDocument } from '../../../server/lib/openapi/build-document';
import { SessionContextResponseSchema } from '../../../server/lib/validations/session-context.schema';
import { TOGGLEABLE } from '../../../server/lib/auth/capabilities';

describe('GET /api/session/context (native contract)', () => {
    let h: Harness | undefined;
    afterEach(() => { h?.close(); h = undefined; });

    async function call(signedIn: boolean) {
        h ??= await createHarness('standalone');
        const exec = makeExecutionContext({ label: 'session-context-contract' });
        const env = h.env;
        const headers: Record<string, string> = {};
        if (signedIn) {
            const keyring = await buildKeyring(env as unknown as Record<string, string | undefined>);
            const now = Math.floor(Date.now() / 1000);
            const token = await signJwt({ sub: OWNER_ID, 'custom:tenantId': TENANT_ID, 'custom:userRole': 'owner', iat: now, exp: now + 3600 }, keyring);
            headers.authorization = `Bearer ${token}`;
        }
        const res = await app.request('/api/session/context', { method: 'GET', headers }, env, exec.ctx);
        await exec.settle();
        return res;
    }

    it('answers 401 without a session', async () => {
        const res = await call(false);
        expect(res.status).toBe(401);
    });

    it('answers 200 for a signed-in owner, uncached, with every key the app reads', async () => {
        const res = await call(true);
        expect(res.status).toBe(200);
        expect(res.headers.get('cache-control')).toBe('private, no-store');
        const body = await res.json() as { success: true; data: Record<string, unknown> };
        expect(body.success).toBe(true);
        expect(Object.keys(body.data).sort()).toEqual([
            'branding', 'collabEditing', 'deployment', 'outboundCoolingWindow', 'seatUsage',
            'unreadMessages', 'user', 'videoProvider',
        ]);
        const user = body.data.user as Record<string, unknown>;
        expect(user.role).toBe('owner');
        expect(Object.keys(user.capabilities as object).sort()).toEqual([...TOGGLEABLE].sort());
        const branding = body.data.branding as Record<string, unknown>;
        expect(typeof branding.companyName).toBe('string');
        expect(typeof branding.defaultTimezone).toBe('string');
        expect(typeof branding.defaultLocale).toBe('string');
        expect((body.data.deployment as Record<string, unknown>).mode).toBe('standalone');
        expect(body.data.videoProvider).toBe('r2');
    });

    it('returns a body the declared response schema accepts, and the schema rejects a missing field (positive control)', async () => {
        const body: unknown = await (await call(true)).json();
        expect(SessionContextResponseSchema.safeParse(body).success).toBe(true);
        const broken = JSON.parse(JSON.stringify(body)) as { data: { branding: Record<string, unknown> } };
        delete broken.data.branding.defaultTimezone;
        expect(SessionContextResponseSchema.safeParse(broken).success).toBe(false);
    });

    it('is declared in OpenAPI as excluded from MCP with no scopes', () => {
        const doc = buildOpenApiDocument(app, { openapi: '3.0.0', info: { version: 'test', title: 'test' } });
        const op = (doc.paths?.['/api/session/context'] as Record<string, Record<string, unknown>> | undefined)?.get;
        expect(op?.operationId).toBe('getSessionContext');
        expect(op?.['x-tier']).toBe('excluded');
        expect(op?.['x-scopes']).toEqual([]);
    });
});
