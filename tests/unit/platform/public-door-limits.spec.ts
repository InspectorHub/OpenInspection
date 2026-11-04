/**
 * Public doors that sign people in, send them an email, or accept a secret from them are counted per caller address before they do any work.
 * Each door below is requested through the real application with a limiter that refuses (429, no side effect) and with one that allows (the
 * door answers for itself), so a limiter that refuses everything, or a door that ignores the limiter, cannot pass.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { app } from '../../../server/index';
import { makeExecutionContext } from '../helpers/exec-ctx';
import { createHarness, TENANT_SLUG, type Harness } from '../helpers/tenant-email-harness';

interface Door { name: string; key: string; method: 'POST'; path: string; body: unknown; cleanAnswer?: number[] }

const DOORS: Door[] = [
    { name: 'agent password sign-in', key: 'agent-login', method: 'POST', path: '/api/agent/login', body: { email: 'nobody@example.test', password: 'a-long-enough-password' } },
    { name: 'agent sign-in link request', key: 'agent-login-link', method: 'POST', path: '/api/agent/login-link', body: { email: 'nobody@example.test' } },
    { name: 'agent report-link sign-in request', key: 'agent-magic-login-request', method: 'POST', path: '/api/agent/magic-login/request', body: { tenant: TENANT_SLUG, inspectionId: 'insp-1', token: 'some-token' } },
    { name: 'agent sign-up', key: 'agent-signup', method: 'POST', path: '/api/agent-signup', body: { email: 'new.agent@example.test', password: 'a-long-enough-password', name: 'New Agent', termsAccepted: true } },
    { name: 'client portal link request', key: 'portal-request-link', method: 'POST', path: `/api/portal/${TENANT_SLUG}/request-link`, body: { email: 'nobody@example.test' } },
    { name: 'first-run setup', key: 'setup', method: 'POST', path: '/api/auth/setup', body: { companyName: 'Acme Inspections', adminName: 'Mike Reynolds', email: 'owner@example.test', password: 'Passw0rd!x', verificationCode: 'wrong-code-123' } },
];

describe('public door limits', () => {
    let h: Harness;
    let allow: boolean;
    let keys: string[];

    const call = async (door: Door): Promise<Response> => {
        const exec = makeExecutionContext({ label: 'public-door-limits' });
        const res = await app.request(door.path, {
            method: door.method, headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '203.0.113.20' }, body: JSON.stringify(door.body),
        }, h.env, exec.ctx);
        await exec.settle();
        return res;
    };

    beforeEach(async () => {
        h = await createHarness('standalone');
        allow = true;
        keys = [];
        (h.env as unknown as { RATE_LIMITER: unknown }).RATE_LIMITER = { limit: async ({ key }: { key: string }) => { keys.push(key); return { success: allow }; } };
        (h.env as unknown as { SETUP_CODE: string }).SETUP_CODE = 'the-real-setup-code';
    });
    afterEach(() => h.close());

    it.each(DOORS)('$name: 429 when over the limit, and the door answers for itself within it', async (door) => {
        allow = false;
        expect((await call(door)).status).toBe(429);
        expect(keys).toContain(`${door.key}:203.0.113.20`);
        allow = true;
        expect((await call(door)).status).not.toBe(429);
    });

    it('first-run setup refuses a wrong or missing setup code with 400 (not a 500, not a pass), counts each try, and an unset code fails closed', async () => {
        h.sqlite.exec('DELETE FROM users');
        const setup = DOORS.find((d) => d.key === 'setup')!;
        const withCode = (verificationCode?: string): Door => ({ ...setup, body: { ...(setup.body as object), ...(verificationCode === undefined ? {} : { verificationCode }) } });
        const wrong = await call(withCode('the-real-setup-cod'));
        expect(wrong.status).toBe(400);
        expect(await wrong.json()).toMatchObject({ error: { code: 'invalid_code' } });
        const missing = await call({ ...setup, body: Object.fromEntries(Object.entries(setup.body as object).filter(([k]) => k !== 'verificationCode')) });
        expect(missing.status).toBe(400);
        expect(keys.filter((k) => k === 'setup:203.0.113.20')).toHaveLength(2);
        // An unset code never lets anyone in.
        (h.env as unknown as { SETUP_CODE?: string }).SETUP_CODE = undefined;
        const unset = await call(withCode('the-real-setup-code'));
        expect(unset.status).toBe(400);
        expect(await unset.json()).toMatchObject({ error: { code: 'setup_code_unset' } });
    });
});
