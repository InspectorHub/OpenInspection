/**
 * ISN report-link push. The response bodies below are the ones ISN sent on
 * 2026-09-18 (ids replaced); every one arrived with HTTP 200, errors included.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isnCall, isnConfig, IsnError } from '../../../server/services/isn/api-base';
import { addReportLinkToIsnOrder } from '../../../server/services/isn/report-link-sync';

const cfg = { domain: 'https://inspectionsupport.com', companyKey: 'co', accessKey: 'a', secretKey: 's' };
const ORDER = '11111111-2222-4333-8444-555555555555';
const ROW = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

/** Answers like ISN. `files` is what /orderfiles lists for the new row. */
function stubIsn(opts: { files?: 'shown' | 'hidden' | 'absent'; addreporturl?: 'ok' | 'error' } = {}) {
    const calls: Array<{ method: string; url: URL; body: unknown }> = [];
    vi.stubGlobal('fetch', vi.fn((input: string, init: RequestInit) => {
        const url = new URL(input);
        calls.push({ method: init.method ?? 'GET', url, body: init.body });
        const path = url.pathname.replace('/co/rest', '');
        const json =
            path === '/order/55' ? { status: 'ok', order: { id: ORDER, oid: 55 } }
            : path === '/orders/addreporturl' ? (opts.addreporturl === 'error'
                ? { status: 'error', message: 'you must provide a url for the report' }
                : { status: 'ok', url: url.searchParams.get('url'), id: ROW, message: '' })
            : path === '/orderfiles' ? { status: 'ok', files: opts.files === 'absent' ? [] : [{ id: ROW, oid: 55, order_id: ORDER, show: opts.files !== 'hidden', public_access: true }] }
            : { status: 'error', message: 'missing or invalid action specified' };
        return Promise.resolve(new Response(JSON.stringify(json), { status: 200 }));
    }));
    return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('addReportLinkToIsnOrder', () => {
    it('resolves the order number, sends the fields in the query string with no body, and returns the row id', async () => {
        const calls = stubIsn();
        await expect(addReportLinkToIsnOrder(cfg, '55', 'https://x.test/r?token=t', 'Home Inspection')).resolves.toBe(ROW);
        const put = calls.find((c) => c.method === 'PUT')!;
        expect(put.url.origin + put.url.pathname).toBe('https://inspectionsupport.com/co/rest/orders/addreporturl');
        expect(Object.fromEntries(put.url.searchParams)).toEqual({ id: ORDER, url: 'https://x.test/r?token=t', title: 'Home Inspection', public: 'true' });
        expect(put.body).toBeUndefined();
    });

    it('treats HTTP 200 with status "error" as a failure, keeping ISN\'s words', async () => {
        stubIsn({ addreporturl: 'error' });
        await expect(addReportLinkToIsnOrder(cfg, '55', 'u', 't')).rejects.toThrow('you must provide a url for the report');
    });

    it('fails when the new row cannot be read back', async () => {
        stubIsn({ files: 'absent' });
        await expect(addReportLinkToIsnOrder(cfg, '55', 'u', 't')).rejects.toThrow('not on order 55');
    });

    it('fails when the row is listed but deleted (ISN keeps it with show:false)', async () => {
        stubIsn({ files: 'hidden' });
        await expect(addReportLinkToIsnOrder(cfg, '55', 'u', 't')).rejects.toThrow('not on order 55');
    });

    it('names an unknown order instead of writing to anything', async () => {
        const calls = stubIsn();
        await expect(addReportLinkToIsnOrder(cfg, '999', 'u', 't')).rejects.toThrow('missing or invalid action specified');
        expect(calls.some((c) => c.method === 'PUT')).toBe(false);
    });
});

describe('isnCall', () => {
    it('reports a non-JSON answer as such, with the HTTP status', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('<html>502</html>', { status: 502 }))));
        const err = await isnCall(cfg, 'GET', '/me').catch((e: unknown) => e);
        expect(err).toBeInstanceOf(IsnError);
        expect((err as IsnError).httpStatus).toBe(502);
        expect((err as IsnError).isnMessage).toContain('non-JSON');
    });
});

describe('isnConfig', () => {
    it('is off unless all four are set — there is no default domain', () => {
        expect(isnConfig({ ISN_COMPANY_KEY: 'co', ISN_ACCESS_KEY: 'a', ISN_SECRET_KEY: 's' })).toBeNull();
        expect(isnConfig({ ISN_DOMAIN: 'https://inspectionsupport.com/', ISN_COMPANY_KEY: 'co', ISN_ACCESS_KEY: 'a', ISN_SECRET_KEY: 's' })).toEqual(cfg);
    });
});
