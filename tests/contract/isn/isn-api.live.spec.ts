/**
 * The things about ISN that its published document does not say, asked of the
 * real API. Each was learned the expensive way on 2026-09-18.
 *
 *   1. Errors arrive as HTTP 200 with `status: "error"` — a missing login, an
 *      unknown path. Trusting the status code read every failure as success.
 *   2. `PUT /orders/addreporturl` ignores the form body the spec documents and
 *      reads the query string.
 *
 * WRITES NOTHING. Every addreporturl call names an order that does not exist,
 * so ISN can only refuse it; the WORDING of the refusal is the answer. "You must
 * provide a url" means the url was not read; anything past that check means it
 * was.
 *
 * Needs ISN_DOMAIN, ISN_COMPANY_KEY, ISN_ACCESS_KEY and ISN_SECRET_KEY in
 * `.dev.vars` (or the environment). Without them it says so and skips.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isnConfig, type IsnConfig } from '../../../server/services/isn/api-base';
import { buildReportLinkParams } from '../../../server/services/isn/report-link-payload';

function devVars(): Record<string, string> {
    const path = join(__dirname, '..', '..', '..', '.dev.vars');
    if (!existsSync(path)) return {};
    return Object.fromEntries(readFileSync(path, 'utf8').split('\n')
        .map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l.trim()))
        .filter((m): m is RegExpExecArray => !!m)
        .map((m) => [m[1]!, m[2]!.replace(/^['"]|['"]$/g, '')]));
}

const cfg: IsnConfig | null = isnConfig({ ...devVars(), ...process.env });
if (!cfg) console.warn('[isn live] skipped: set ISN_DOMAIN, ISN_COMPANY_KEY, ISN_ACCESS_KEY, ISN_SECRET_KEY in .dev.vars');

const NO_SUCH_ORDER = '00000000-0000-0000-0000-000000000000';

async function raw(c: IsnConfig, method: string, path: string, init: { auth?: boolean; body?: string; contentType?: string } = {}) {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (init.auth !== false) headers.Authorization = `Basic ${btoa(`${c.accessKey}:${c.secretKey}`)}`;
    if (init.contentType) headers['Content-Type'] = init.contentType;
    const res = await fetch(`${c.domain}/${c.companyKey}/rest${path}`, { method, headers, body: init.body });
    return { status: res.status, body: (await res.json()) as { status?: string; message?: string } };
}

describe.skipIf(!cfg)('ISN REST API — what only the wire can say', () => {
    const c = cfg!;
    const params = buildReportLinkParams({ orderId: NO_SUCH_ORDER, url: 'https://example.com/contract-probe', title: 'contract probe' });

    it('answers a request with no credentials with HTTP 200 and status "error"', async () => {
        const r = await raw(c, 'GET', '/me', { auth: false });
        expect(r.status).toBe(200);
        expect(r.body.status).toBe('error');
    });

    it('answers an unknown path with HTTP 200 and status "error"', async () => {
        const r = await raw(c, 'GET', '/definitely-not-an-endpoint');
        expect(r.status).toBe(200);
        expect(r.body.status).toBe('error');
    });

    it('ignores a form-encoded addreporturl body (the form the spec documents)', async () => {
        const r = await raw(c, 'PUT', '/orders/addreporturl', {
            body: new URLSearchParams(params).toString(), contentType: 'application/x-www-form-urlencoded',
        });
        expect(r.body).toMatchObject({ status: 'error', message: 'you must provide a url for the report' });
    });

    it('reads addreporturl fields from the query string', async () => {
        const r = await raw(c, 'PUT', `/orders/addreporturl?${new URLSearchParams(params).toString()}`);
        // Refused — the order does not exist — but past the url check.
        expect(r.body.status).toBe('error');
        expect(r.body.message).not.toBe('you must provide a url for the report');
    });
});
