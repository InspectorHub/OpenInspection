/**
 * The E2E test hooks are public paths (no session) that only exist behind E2E_EMAIL_SINK. Every route of the router, and any path under it,
 * answers 404 when the flag is unset, whatever the method; with the flag set the same routes are reachable. The list of routes is read from the
 * router itself, so a hook added later is covered without anyone remembering to add it here.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { Hono } from 'hono';
import { app } from '../../../server/index';
import testHooks from '../../../server/api/test-hooks';
import { makeExecutionContext } from '../helpers/exec-ctx';
import { createHarness, type Harness } from '../helpers/tenant-email-harness';

describe('test hooks', () => {
    let h: Harness;
    afterEach(() => h?.close());

    const call = async (method: string, path: string, flag: string | undefined): Promise<Response> => {
        const env = { ...h.env, ...(flag === undefined ? {} : { E2E_EMAIL_SINK: flag }) };
        const exec = makeExecutionContext({ label: 'test-hooks-closed' });
        const res = await app.request(`/api/__test__${path}`, { method, headers: { 'content-type': 'application/json' }, ...(method === 'POST' ? { body: '{}' } : {}) }, env, exec.ctx);
        await exec.settle();
        return res;
    };

    it('reads at least the three known routes from the router', () => {
        const routes = testHooks.routes.filter((r) => r.method !== 'ALL').map((r) => `${r.method} ${r.path}`);
        expect(routes).toEqual(expect.arrayContaining(['GET /last-email', 'POST /calendar-connection', 'POST /report-translation']));
    });

    it('answers 404 on every route, and on an unknown path under it, when the flag is unset or not "1"', async () => {
        h = await createHarness('standalone');
        const routes = testHooks.routes.filter((r) => r.method !== 'ALL');
        for (const flag of [undefined, '', '0', 'true']) {
            for (const r of routes) expect((await call(r.method, r.path, flag)).status, `${r.method} ${r.path} flag=${String(flag)}`).toBe(404);
            expect((await call('GET', '/anything-else', flag)).status).toBe(404);
        }
    });

    it('control: with the flag set the routes answer for themselves', async () => {
        h = await createHarness('standalone');
        // last-email without its query is a 400 from the handler, which is not the closed answer.
        expect((await call('GET', '/last-email', '1')).status).toBe(400);
    });

    it('a hook added later is closed too: the gate sits ahead of every handler, so a route that forgets its own check still answers 404', async () => {
        // Registered on the router after the gate (which was registered when the module loaded); mounted on a fresh app so the production app is untouched.
        testHooks.get('/added-later', (c) => c.json({ open: true }));
        const parent = new Hono().route('/api/__test__', testHooks);
        const closed = await parent.request('/api/__test__/added-later', {}, {});
        expect(closed.status).toBe(404);
        // Control: with the flag set the same route answers, so the 404 above is the gate and not a missing route.
        const open = await parent.request('/api/__test__/added-later', {}, { E2E_EMAIL_SINK: '1' });
        expect(open.status).toBe(200);
    });
});
