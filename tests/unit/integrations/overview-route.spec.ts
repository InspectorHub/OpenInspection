/**
 * GET /api/integrations/overview: owner and manager only, scoped to the tenant
 * on the verified session, and the deployment's environment it hands the
 * builder never contains the keys the secrets middleware took from the company.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { HonoConfig } from '../../../server/types/hono';
import { getDeploymentProfile } from '../../../server/lib/deployment-profile';
import { deploymentEnvOf } from '../../../server/lib/integrations/deployment-env';

const h = vi.hoisted(() => ({ calls: [] as Array<Record<string, unknown>> }));
vi.mock('../../../server/lib/integrations/overview-data', () => ({
    loadOverviewInputs: async (args: Record<string, unknown>) => {
        h.calls.push(args);
        return { profile: args.profile, env: {}, company: {}, quickbooksConnected: false, calendarConnected: false };
    },
}));

import routes from '../../../server/api/integrations-overview';

function app(role: string | undefined, tenantId: string | undefined = 'tenant-1') {
    const a = new OpenAPIHono<HonoConfig>();
    a.onError((err, c) => c.json({ success: false }, ((err as { status?: number }).status ?? 500) as 403));
    a.use('*', async (c, next) => {
        const set = (c as unknown as { set(k: string, v: unknown): void }).set.bind(c);
        if (role) set('userRole', role);
        if (tenantId) set('tenantId', tenantId);
        set('user', { sub: 'user-1' });
        set('profile', getDeploymentProfile({}));
        set('tenantSecretKeys', ['RESEND_API_KEY']);
        await next();
    });
    a.route('/api/integrations/overview', routes);
    return a;
}
const get = (role: string | undefined, env: Record<string, unknown> = {}, tenantId?: string) =>
    app(role, tenantId).request('/api/integrations/overview', {}, { DB: {}, JWT_SECRET: 'x'.repeat(32), ...env });

beforeEach(() => { h.calls.length = 0; });

describe('GET /api/integrations/overview', () => {
    it('answers owner and manager with a list of cards', async () => {
        for (const role of ['owner', 'manager']) {
            const res = await get(role);
            expect(res.status, role).toBe(200);
            const body = await res.json() as { data: Array<{ id: string }> };
            expect(body.data.map((c) => c.id)).toContain('stripe');
        }
    });

    it('refuses every other role and a caller with no role, and reads nothing for them', async () => {
        for (const role of ['inspector', 'agent', 'client', undefined]) {
            const res = await get(role);
            expect([401, 403], String(role)).toContain(res.status);
        }
        expect(h.calls).toHaveLength(0);
    });

    it('reads the tenant and user from the session, not from the request', async () => {
        await app('owner', 'tenant-from-session').request('/api/integrations/overview?tenantId=other&userId=other', {}, { DB: {}, JWT_SECRET: 'x'.repeat(32) });
        expect(h.calls).toHaveLength(1);
        expect(h.calls[0]).toMatchObject({ tenantId: 'tenant-from-session', userId: 'user-1', tenantSecretKeys: ['RESEND_API_KEY'] });
    });

    it('refuses a session with no tenant', async () => {
        const res = await get('owner', {}, '');
        expect(res.status).toBe(401);
    });
});

describe('deploymentEnvOf', () => {
    it('drops the keys that came from the company and keeps the deployment\'s own', () => {
        const env = { RESEND_API_KEY: 'from-company', SENDER_EMAIL: 'dep@x.test', DB: 'binding' };
        expect(deploymentEnvOf(env, ['RESEND_API_KEY'])).toEqual({ SENDER_EMAIL: 'dep@x.test', DB: 'binding' });
        // control: with nothing to drop the env is unchanged, and the input is never mutated
        expect(deploymentEnvOf(env, [])).toEqual(env);
        expect(env.RESEND_API_KEY).toBe('from-company');
    });
});
