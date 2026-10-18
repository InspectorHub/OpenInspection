/**
 * The "Request processed" line is for requests that arrive from outside. A page
 * render fans out about a dozen in-process API calls through the worker's
 * self-binding; each used to write its own line, drowning the one line that
 * describes the page. In-process calls now log only when they fail (5xx).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { requestLog } from '../../../server/lib/middleware/request-log';
import { createRequestScope, REQUEST_SCOPE } from '../../../server/lib/request-scope';

describe('requestLog middleware', () => {
    let lines: string[];
    beforeEach(() => {
        lines = [];
        vi.spyOn(console, 'info').mockImplementation((l: string) => {
            lines.push(l);
        });
        vi.spyOn(console, 'error').mockImplementation((l: string) => {
            lines.push(l);
        });
    });
    afterEach(() => vi.restoreAllMocks());

    function appWith(status: number) {
        const app = new Hono();
        app.use('*', requestLog);
        app.get('/api/thing', (c) => c.json({ ok: true }, status as 200));
        return app;
    }
    const processed = () => lines.filter((l) => (JSON.parse(l) as { message: string }).message === 'Request processed');

    it('still logs an external request (plain env, no request scope)', async () => {
        const res = await appWith(200).fetch(new Request('https://example.test/api/thing'), {});
        expect(res.status).toBe(200);
        expect(processed()).toHaveLength(1);
        expect(JSON.parse(processed()[0]!).data).toMatchObject({ method: 'GET', path: '/api/thing', status: 200 });
    });

    it('does not log an in-process call (env carries the request scope)', async () => {
        const env = { [REQUEST_SCOPE]: createRequestScope() };
        const res = await appWith(200).fetch(new Request('https://example.test/api/thing'), env);
        expect(res.status).toBe(200);
        expect(processed()).toHaveLength(0);
    });

    it('does not log an in-process 4xx either (the caller sees it and handles it)', async () => {
        const env = { [REQUEST_SCOPE]: createRequestScope() };
        await appWith(404).fetch(new Request('https://example.test/api/thing'), env);
        expect(processed()).toHaveLength(0);
    });

    it('still logs an in-process call that fails with a 5xx', async () => {
        const env = { [REQUEST_SCOPE]: createRequestScope() };
        await appWith(503).fetch(new Request('https://example.test/api/thing'), env);
        expect(processed()).toHaveLength(1);
        expect(JSON.parse(processed()[0]!).data).toMatchObject({ status: 503 });
    });

    it('a client cannot make itself look in-process by sending a header', async () => {
        const req = new Request('https://example.test/api/thing', { headers: { [REQUEST_SCOPE]: '1', 'x-request-scope': '1' } });
        await appWith(200).fetch(req, {});
        expect(processed()).toHaveLength(1);
    });
});
