import { describe, it, expect, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import agentRoutes from '../../../server/api/agent';
import { AppError } from '../../../server/lib/errors';
import { ROLES } from '../../../server/lib/auth/roles';
import type { UserRole } from '../../../server/types/auth';
import type { HonoConfig } from '../../../server/types/hono';

/**
 * F69 — the decision the agent portal's admission is READ FROM.
 *
 * `app/routes/agent-layout.tsx` does not inspect the session's role claim. It
 * calls `GET /api/agent/profile` (which the portal needs anyway, for the agent's
 * own identity and timezone) and obeys the status. That keeps one decision in one
 * place — CLAUDE.md's "capabilities come from one function, not from a page" — but
 * it also means the portal's front door is only as closed as THIS route is.
 *
 * So this spec pins the enforcement the app tier leans on, as a pair: an
 * inspector is refused 403, and an agent is served 200. The second half is not
 * decoration — a route that refused every role would satisfy the first half and
 * would also, through the guard, lock every real agent out of the portal.
 *
 * The refusal's body is asserted too, because the app tier distinguishes 403 from
 * 401 and from 428 and routes each somewhere different.
 */

/** Mirrors server/index.ts's global onError — see tests/unit/agent/agent-login.spec.ts. */
function withErrorHandler(app: OpenAPIHono<HonoConfig>) {
    app.onError((err, c) => {
        if (err instanceof AppError) {
            return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status);
        }
        return c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500);
    });
    return app;
}

const PROFILE = { name: 'Jane Agent', email: 'jane@realty.test', slug: 'jane', timezone: null };

function appAs(role: UserRole) {
    const getProfile = vi.fn().mockResolvedValue(PROFILE);
    const app = new OpenAPIHono<HonoConfig>();
    app.use('*', async (c, next) => {
        c.set('userRole', role);
        c.set('user', { sub: 'u1' } as never);
        c.set('services', { agent: { getProfile } } as never);
        await next();
    });
    app.route('/api/agent', agentRoutes);
    return { app: withErrorHandler(app), getProfile };
}

describe('GET /api/agent/profile — the agent portal\'s admission decision', () => {
    // DERIVED from ROLES, not retyped. The portal admits on this route's answer,
    // so a role added to ROLES that this route happens to accept would silently
    // widen the portal — and a hand-written list cannot notice that. It also got
    // the current roster wrong: the literal list here named a 'viewer' role this
    // deployment does not have, so it was testing one fiction and missing nothing
    // only by luck.
    for (const role of ROLES.filter((r) => r !== 'agent')) {
        it(`refuses a '${role}' session with 403 and the forbidden code`, async () => {
            const { app, getProfile } = appAs(role);
            const res = await app.request('/api/agent/profile');
            expect(res.status).toBe(403);
            const body = await res.json() as { error: { code: string; message: string } };
            expect(body.error.code).toBe('forbidden');
            expect(body.error.message).toContain('agent');
            // Refused before the read, so there is nothing to leak even in a body
            // the app tier discards.
            expect(getProfile).not.toHaveBeenCalled();
        });
    }

    it('SERVES an agent session — the control, without which refusing everyone would pass', async () => {
        const { app, getProfile } = appAs('agent');
        const res = await app.request('/api/agent/profile');
        expect(res.status).toBe(200);
        const body = await res.json() as { success: boolean; data: typeof PROFILE };
        expect(body.success).toBe(true);
        expect(body.data.email).toBe('jane@realty.test');
        expect(getProfile).toHaveBeenCalledWith('u1');
    });

    it('refuses a session with no role at all as 401, which the portal reads differently', async () => {
        const app = withErrorHandler(new OpenAPIHono<HonoConfig>());
        app.use('*', async (c, next) => {
            c.set('user', { sub: 'u1' } as never);
            c.set('services', { agent: { getProfile: vi.fn() } } as never);
            await next();
        });
        app.route('/api/agent', agentRoutes);
        const res = await app.request('/api/agent/profile');
        expect(res.status).toBe(401);
    });
});
