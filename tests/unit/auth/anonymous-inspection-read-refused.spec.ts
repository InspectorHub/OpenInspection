import { describe, it, expect } from 'vitest';
import { enforceApiAccess } from '../../../server/lib/auth/api-access-policy';
import { AppError } from '../../../server/lib/errors';
import { app } from '../../../server/index';
import { buildKeyring, signJwt } from '../../../server/lib/jwt-keyring';
import { makeExecutionContext } from '../helpers/exec-ctx';
import { createHarness, OWNER_ID, TENANT_ID, type Harness } from '../helpers/tenant-email-harness';

/**
 * Characterization: green on arrival. An identity-less request to an inspection
 * read used to reach a handler with no company and fail with a 500 in the
 * multi-company mode. The access policy now refuses it before any handler runs,
 * independent of deployment mode, so the answer is a 401.
 */
function statusOf(path: string, role: string | undefined): number | null {
    try {
        enforceApiAccess(path, role);
        return null;
    } catch (err) {
        if (err instanceof AppError) return err.status;
        throw err;
    }
}

describe('anonymous inspection reads are refused, not crashed', () => {
    it.each([
        '/api/inspections/insp-1',
        '/api/inspections/insp-1/results',
    ])('%s answers 401 without an identity', (path) => {
        expect(statusOf(path, undefined)).toBe(401);
    });

    it('control: the same path passes the policy for a signed-in role', () => {
        expect(statusOf('/api/inspections/insp-1', 'inspector')).toBeNull();
    });
});

/**
 * The same refusal, through the REAL application and jwtAuthMiddleware. The unit
 * above proves the policy function; only this pins that the middleware actually
 * calls it, in the order that matters (before tenant-scoped middleware and the
 * route handler).
 */
describe('anonymous GET /api/inspections/{id} through the real middleware chain', () => {
    const REQ_PATH = '/api/inspections/44444444-0000-4000-8000-0000000000ff';

    async function call(h: Harness, token: string | null) {
        const exec = makeExecutionContext({ label: 'anon-inspection' });
        const headers: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
        const res = await app.request(REQ_PATH, { method: 'GET', headers }, h.env, exec.ctx);
        await exec.settle();
        return res;
    }

    it.each(['standalone', 'saas'] as const)('answers 401 in %s mode, and the owner is not refused (control)', async (mode) => {
        const h = await createHarness(mode);
        try {
            const anon = await call(h, null);
            expect(anon.status).toBe(401);

            const keyring = await buildKeyring(h.env as unknown as Record<string, string | undefined>);
            const now = Math.floor(Date.now() / 1000);
            const token = await signJwt(
                { sub: OWNER_ID, 'custom:tenantId': TENANT_ID, 'custom:userRole': 'owner', iat: now, exp: now + 3600 },
                keyring,
            );
            // The control reaches the handler (no such inspection => 404), which is
            // exactly what the anonymous request must not do.
            expect((await call(h, token)).status).toBe(404);
        } finally { h.close(); }
    }, 60_000);
});
