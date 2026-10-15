/**
 * GET and PUT /api/admin/integration-sources: owner and manager only, scoped to
 * the company on the verified session, validated, audited with a fixed set of
 * fields, and a write that carries no secret.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { HonoConfig } from '../../../server/types/hono';
import { getDeploymentProfile } from '../../../server/lib/deployment-profile';

const h = vi.hoisted(() => ({
    loads: [] as Array<Record<string, unknown>>,
    writes: [] as Array<unknown[]>,
    audits: [] as Array<unknown[]>,
    inputs: { current: null as unknown },
}));

vi.mock('../../../server/lib/integrations/overview-data', () => ({
    loadOverviewInputs: async (args: Record<string, unknown>) => {
        h.loads.push(args);
        return h.inputs.current;
    },
}));
vi.mock('../../../server/lib/integrations/source-change', async (importOriginal) => {
    const real = await importOriginal<typeof import('../../../server/lib/integrations/source-change')>();
    return { ...real, writeIntegrationSource: async (...args: unknown[]) => { h.writes.push(args); } };
});
vi.mock('../../../server/lib/audit', async (importOriginal) => {
    const real = await importOriginal<typeof import('../../../server/lib/audit')>();
    return { ...real, auditFromContext: (...args: unknown[]) => { h.audits.push(args); } };
});

import routes from '../../../server/api/admin/admin-integration-sources';

const HOSTED = getDeploymentProfile({ APP_MODE: 'saas' });
const ownSecrets = { RESEND_API_KEY: 're_a' };

function inputs(over: { profile?: ReturnType<typeof getDeploymentProfile>; secrets?: Record<string, string> } = {}) {
    return {
        profile: over.profile ?? HOSTED,
        env: { RESEND_API_KEY: 're_dep', SENDER_EMAIL: 'dep@x.test' },
        quickbooksConnected: false,
        calendarConnected: false,
        company: { senderEmail: 'a@a.test', ownSecrets: over.secrets ?? ownSecrets },
    };
}

function app(role: string | undefined, tenantId: string | undefined = 'tenant-1') {
    const a = new OpenAPIHono<HonoConfig>();
    a.onError((err, c) => c.json({ success: false }, ((err as { status?: number }).status ?? 500) as 403));
    a.use('*', async (c, next) => {
        const set = (c as unknown as { set(k: string, v: unknown): void }).set.bind(c);
        if (role) set('userRole', role);
        if (tenantId) set('tenantId', tenantId);
        set('user', { sub: 'user-1' });
        set('profile', HOSTED);
        set('tenantSecretKeys', ['RESEND_API_KEY']);
        await next();
    });
    a.route('/api/admin', routes);
    return a;
}
const env = { DB: {}, JWT_SECRET: 'x'.repeat(32) };
const put = (role: string | undefined, body: unknown, tenantId?: string) =>
    app(role, tenantId).request('/api/admin/integration-sources', {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }, env);
const get = (role: string | undefined) => app(role).request('/api/admin/integration-sources', {}, env);

beforeEach(() => {
    h.loads.length = 0; h.writes.length = 0; h.audits.length = 0;
    h.inputs.current = inputs();
});

describe('GET /api/admin/integration-sources', () => {
    it('answers owner and manager with a row per switchable service', async () => {
        for (const role of ['owner', 'manager']) {
            const res = await get(role);
            expect(res.status, role).toBe(200);
            const body = await res.json() as { data: Array<{ service: string; ownReady: boolean }> };
            expect(body.data.map((r) => r.service)).toEqual(['email', 'sms', 'ai']);
            expect(body.data[0]!.ownReady).toBe(true);
        }
    });

    it('refuses every other role, and reads nothing for them', async () => {
        for (const role of ['inspector', 'agent', 'client', undefined]) {
            expect([401, 403], String(role)).toContain((await get(role)).status);
        }
        expect(h.loads).toHaveLength(0);
    });

    it('never returns a key value', async () => {
        const text = await (await get('owner')).text();
        expect(text).not.toContain('re_a');
        expect(text).not.toContain('re_dep');
    });
});

describe('PUT /api/admin/integration-sources', () => {
    it('saves a valid choice for the company on the session, and audits exactly the service and source', async () => {
        const res = await put('owner', { service: 'email', source: 'own' }, 'tenant-from-session');
        expect(res.status).toBe(200);
        expect(h.writes).toEqual([[expect.anything(), 'tenant-from-session', 'email', 'own']]);
        expect(h.loads[0]).toMatchObject({ tenantId: 'tenant-from-session' });
        expect(h.audits).toHaveLength(1);
        expect(h.audits[0]!.slice(1)).toEqual(['config.integration_source.update', 'tenant_config', { metadata: { service: 'email', source: 'own' } }]);
    });

    it('lets a manager save too', async () => {
        expect((await put('manager', { service: 'email', source: 'provided' })).status).toBe(200);
    });

    it('refuses every other role without writing or auditing', async () => {
        for (const role of ['inspector', 'agent', 'client', undefined]) {
            expect([401, 403], String(role)).toContain((await put(role, { service: 'email', source: 'own' })).status);
        }
        expect(h.writes).toHaveLength(0);
        expect(h.audits).toHaveLength(0);
    });

    it('refuses an unknown service, an unknown source and the retired platform value', async () => {
        for (const body of [
            { service: 'quickbooks', source: 'own' },
            { service: 'nope', source: 'own' },
            { service: 'sms', source: 'platform' },
            { service: 'email', source: 'managed_shared' },
            {},
        ]) {
            expect((await put('owner', body)).status, JSON.stringify(body)).toBe(400);
        }
        expect(h.writes).toHaveLength(0);
    });

    it('refuses a request that tries to carry a key, and writes nothing', async () => {
        const res = await put('owner', { service: 'email', source: 'own', RESEND_API_KEY: 're_new', secrets: { a: 'b' } });
        expect(res.status).toBe(400);
        expect(h.writes).toHaveLength(0);
    });

    it('refuses Your own when the company\'s details are incomplete, with a reason a person can act on', async () => {
        h.inputs.current = inputs({ secrets: {} });
        const res = await put('owner', { service: 'email', source: 'own' });
        expect(res.status).toBe(409);
        expect(await res.json()).toMatchObject({ error: { code: 'own_credentials_incomplete' } });
        expect(h.writes).toHaveLength(0);
        expect(h.audits).toHaveLength(0);
    });

    it('refuses Built-in SMS while it is held back', async () => {
        const res = await put('owner', { service: 'sms', source: 'provided' });
        expect(res.status).toBe(409);
        expect(await res.json()).toMatchObject({ error: { code: 'not_offered' } });
        expect(h.writes).toHaveLength(0);
    });

    it('refuses a session with no company', async () => {
        expect((await put('owner', { service: 'email', source: 'own' }, '')).status).toBe(401);
        expect(h.writes).toHaveLength(0);
    });
});
