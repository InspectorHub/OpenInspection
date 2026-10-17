import { describe, it, expect } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import analyticsRoutes from '../../../server/api/analytics';
import usageRoutes from '../../../server/api/usage';
import billingRoutes from '../../../server/api/billing';
import integrationsRoutes from '../../../server/api/integrations';
import agentRoutes from '../../../server/api/agent';
import { AppError } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';

type Persona = 'anonymous' | 'agent' | 'inspector' | 'staff' | 'manager' | 'owner';
const PERSONAS: Persona[] = ['anonymous', 'agent', 'inspector', 'staff', 'manager', 'owner'];
const STAFF_TIER = ['owner', 'manager', 'inspector', 'staff'] as const;
const ADMIN = ['owner', 'manager'] as const;

interface Case { method: string; path: string; mount: string; router: OpenAPIHono<HonoConfig>; allowed: readonly Persona[] }
const CASES: Case[] = [
    { method: 'GET', mount: '/api/analytics', path: '/api/analytics/growth', router: analyticsRoutes as never, allowed: STAFF_TIER },
    { method: 'GET', mount: '/api/analytics', path: '/api/analytics/findings-heatmap', router: analyticsRoutes as never, allowed: STAFF_TIER },
    { method: 'GET', mount: '/api/usage', path: '/api/usage/summary', router: usageRoutes as never, allowed: STAFF_TIER },
    { method: 'GET', mount: '/api/billing', path: '/api/billing/summary', router: billingRoutes as never, allowed: ADMIN },
    { method: 'GET', mount: '/api/integrations', path: '/api/integrations/status', router: integrationsRoutes as never, allowed: STAFF_TIER },
    { method: 'GET', mount: '/api/agent', path: '/api/agent/leaderboard', router: agentRoutes as never, allowed: ADMIN },
];

function buildApp(c: Case, persona: Persona) {
    const app = new OpenAPIHono<HonoConfig>();
    app.onError((err, ctx) => err instanceof AppError
        ? ctx.json({ success: false, error: { code: err.code, message: err.message } }, err.status)
        : ctx.json({ success: false, error: { message: String(err) } }, 500));
    app.use('*', async (ctx, next) => {
        if (persona !== 'anonymous') {
            ctx.set('userRole', persona);
            ctx.set('user', { sub: 'u1', role: persona, tenantId: 't1' });
            ctx.set('tenantId', 't1');
        }
        await next();
    });
    app.route(c.mount, c.router);
    return app;
}

describe('previously ungated staff endpoints', { timeout: 30_000 }, () => {
    for (const c of CASES) {
        describe(`${c.method} ${c.path}`, () => {
            for (const persona of PERSONAS) {
                const allowed = c.allowed.includes(persona);
                it(`${persona} is ${allowed ? 'let through to the handler' : 'refused'}`, async () => {
                    const res = await buildApp(c, persona).request(c.path, { method: c.method });
                    if (allowed) {
                        expect([401, 403], `${persona} -> ${res.status}`).not.toContain(res.status);
                    } else {
                        expect(res.status).toBe(persona === 'anonymous' ? 401 : 403);
                    }
                });
            }
        });
    }
});
