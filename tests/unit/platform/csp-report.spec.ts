/**
 * POST /api/public/csp-report, through the real application and middleware chain (no
 * auth mocking), in both deployment modes: reachable with no session, no CSRF
 * token and no tenant, answers 204 with an empty body whatever it is sent, and
 * logs one low-cardinality line per report.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../../server/index';
import { logger } from '../../../server/lib/logger';
import { makeExecutionContext } from '../helpers/exec-ctx';
import { createHarness, type Harness } from '../helpers/tenant-email-harness';
import {
    CSP_REPORT_MAX_BYTES,
    CSP_REPORT_MAX_PER_WINDOW,
    CSP_REPORT_WINDOW_MS,
    admitCspReport,
    parseCspReports,
    reduceBlocked,
    reduceDocumentPath,
    resetCspReportSampling,
} from '../../../server/lib/csp-report';

const UUID = '0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d';

const legacy = {
    'csp-report': {
        'document-uri': `https://app.test/inspections/${UUID}/edit?token=SECRET#frag`,
        'blocked-uri': 'https://cdn.example.com/lib/x.js?key=SECRET#h',
        'effective-directive': 'script-src-elem',
        'violated-directive': "script-src-elem 'self'",
        disposition: 'report',
        'source-file': 'https://app.test/assets/main.js?v=SECRET',
        'line-number': 12,
        'column-number': 34,
        'script-sample': 'SECRET-SAMPLE',
        referrer: 'https://elsewhere.test/SECRET',
    },
};

const reportingApi = [
    {
        type: 'csp-violation',
        url: 'https://app.test/login',
        user_agent: 'SECRET-UA',
        body: {
            documentURL: 'https://app.test/login?next=SECRET',
            blockedURL: 'inline',
            effectiveDirective: 'style-src-attr',
            disposition: 'enforce',
            sample: 'SECRET-SAMPLE',
            lineNumber: 7,
            columnNumber: 8,
        },
    },
    { type: 'deprecation', body: { id: 'x' } },
];

let h: Harness;
let info: ReturnType<typeof vi.spyOn>;

const post = async (
    body: BodyInit | null,
    headers: Record<string, string> = { 'content-type': 'application/csp-report' },
    query = '?p=a',
) => {
    const exec = makeExecutionContext({ label: 'csp-report' });
    const res = await app.request(`/api/public/csp-report${query}`, { method: 'POST', headers, body }, h.env, exec.ctx);
    await exec.settle();
    return res;
};
const lines = () => info.mock.calls.filter((c: unknown[]) => c[0] === 'csp_report').map((c: unknown[]) => c[1] as Record<string, unknown>);

describe.each(['standalone', 'saas'] as const)('POST /api/public/csp-report (%s)', (mode) => {
    beforeEach(async () => {
        h = await createHarness(mode);
        resetCspReportSampling();
        info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    });
    afterEach(() => { info.mockRestore(); h.close(); });

    it('accepts a legacy report with no session, CSRF token or tenant: 204, empty body, no CORS headers', async () => {
        const res = await post(JSON.stringify(legacy), { 'content-type': 'application/csp-report', origin: 'https://evil.test' });
        expect(res.status).toBe(204);
        expect(await res.text()).toBe('');
        expect(res.headers.get('access-control-allow-origin')).toBeNull();
        expect(res.headers.get('access-control-allow-credentials')).toBeNull();
        expect(lines()).toHaveLength(1);
    });

    it('logs only the allowed fields, with the URL reduced to an origin and the path normalised', async () => {
        await post(JSON.stringify(legacy));
        const [line] = lines();
        expect(Object.keys(line!).sort()).toEqual(
            ['blocked', 'column', 'disposition', 'document_path', 'effective_directive', 'line', 'policy', 'source_file_origin'],
        );
        expect(line).toEqual({
            policy: 'a',
            disposition: 'report',
            effective_directive: 'script-src-elem',
            blocked: 'https://cdn.example.com',
            document_path: '/inspections/:id/edit',
            source_file_origin: 'https://app.test',
            line: 12,
            column: 34,
        });
        const serialized = JSON.stringify(info.mock.calls);
        for (const secret of ['SECRET', 'token=', '#frag', '/lib/x.js', '/assets/main.js', UUID]) {
            expect(serialized).not.toContain(secret);
        }
    });

    it('accepts the Reporting API array form and logs only the CSP entries', async () => {
        const res = await post(JSON.stringify(reportingApi), { 'content-type': 'application/reports+json' });
        expect(res.status).toBe(204);
        expect(lines()).toEqual([{
            policy: 'a',
            disposition: 'enforce',
            effective_directive: 'style-src-attr',
            blocked: 'inline',
            document_path: '/login',
            source_file_origin: 'none',
            line: 7,
            column: 8,
        }]);
        expect(JSON.stringify(info.mock.calls)).not.toContain('SECRET');
    });

    it('accepts application/json', async () => {
        const res = await post(JSON.stringify(legacy), { 'content-type': 'application/json; charset=utf-8' });
        expect(res.status).toBe(204);
        expect(lines()).toHaveLength(1);
    });

    it.each([
        ['malformed JSON', '{not json', 'application/csp-report'],
        ['an empty body', '', 'application/csp-report'],
        ['JSON of the wrong shape', '[1,2,3]', 'application/json'],
        ['a wrong content type', JSON.stringify(legacy), 'text/plain'],
    ])('answers 204 and logs nothing for %s', async (_name, body, type) => {
        const res = await post(body, { 'content-type': type });
        expect(res.status).toBe(204);
        expect(await res.text()).toBe('');
        expect(lines()).toEqual([]);
    });

    it('drops an oversize body without parsing it', async () => {
        const padded = JSON.stringify({ ...legacy, pad: 'x'.repeat(CSP_REPORT_MAX_BYTES) });
        const res = await post(padded);
        expect(res.status).toBe(204);
        expect(lines()).toEqual([]);
        // control: the same report without the padding is logged
        await post(JSON.stringify(legacy));
        expect(lines()).toHaveLength(1);
    });

    it('drops a body whose declared content-length is over the cap, before reading it', async () => {
        // The body itself is small and valid: only the declared length can make this drop.
        const res = await post(JSON.stringify(legacy), { 'content-type': 'application/csp-report', 'content-length': '99999' });
        expect(res.status).toBe(204);
        expect(lines()).toEqual([]);
        // control: the same body with its true length is logged
        await post(JSON.stringify(legacy));
        expect(lines()).toHaveLength(1);
    });

    it('tags the policy: a and b are logged as such, anything else as unknown', async () => {
        const at = (i: number) => JSON.stringify({ 'csp-report': { ...legacy['csp-report'], 'document-uri': `https://app.test/p${i}` } });
        await post(at(1), undefined, '?p=a');
        await post(at(2), undefined, '?p=b');
        await post(at(3), undefined, '?p=zzz');
        await post(at(4), undefined, '');
        expect(lines().map((l: Record<string, unknown>) => l.policy)).toEqual(['a', 'b', 'unknown', 'unknown']);
    });

    it('logs a repeated tuple once, and a different policy, directive or page as new', async () => {
        const doc = (path: string, directive = 'script-src-elem') => JSON.stringify({
            'csp-report': { ...legacy['csp-report'], 'document-uri': `https://app.test${path}`, 'effective-directive': directive },
        });
        for (let i = 0; i < 5; i += 1) expect((await post(doc('/login'))).status).toBe(204);
        expect(lines()).toHaveLength(1);
        await post(doc('/login'), undefined, '?p=b');
        await post(doc('/login', 'style-src-attr'));
        await post(doc('/other'));
        expect(lines()).toHaveLength(4);
    });

    it('repeats do not spend the log budget', async () => {
        const doc = (i: number) => JSON.stringify({ 'csp-report': { ...legacy['csp-report'], 'document-uri': `https://app.test/page${i}` } });
        for (let r = 0; r < 3; r += 1) for (let i = 0; i < CSP_REPORT_MAX_PER_WINDOW; i += 1) await post(doc(i));
        expect(lines()).toHaveLength(CSP_REPORT_MAX_PER_WINDOW);
    });

    it('once the minute budget is spent the body is not read at all', async () => {
        const doc = (i: number) => JSON.stringify({ 'csp-report': { ...legacy['csp-report'], 'document-uri': `https://app.test/spent${i}` } });
        for (let i = 0; i < CSP_REPORT_MAX_PER_WINDOW; i += 1) await post(doc(i));
        expect(lines()).toHaveLength(CSP_REPORT_MAX_PER_WINDOW);

        let pulled = 0;
        // highWaterMark 0: the stream is pulled only if something actually reads it.
        const body = new ReadableStream<Uint8Array>({
            pull(controller) { pulled += 1; controller.enqueue(new TextEncoder().encode(doc(999))); controller.close(); },
        }, { highWaterMark: 0 });
        const exec = makeExecutionContext({ label: 'csp-report-spent' });
        const res = await app.request('/api/public/csp-report?p=a', {
            method: 'POST', headers: { 'content-type': 'application/json' }, body, duplex: 'half',
        } as RequestInit, h.env, exec.ctx);
        await exec.settle();
        expect(res.status).toBe(204);
        expect(pulled).toBe(0);
        expect(lines()).toHaveLength(CSP_REPORT_MAX_PER_WINDOW);
    });

    it('drops an oversize body that declares no length once the cap is passed', async () => {
        const big = new Blob([JSON.stringify({ ...legacy, pad: 'x'.repeat(CSP_REPORT_MAX_BYTES) })]).stream();
        const exec = makeExecutionContext({ label: 'csp-report-stream' });
        const res = await app.request('/api/public/csp-report', {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: big, duplex: 'half',
        } as RequestInit, h.env, exec.ctx);
        await exec.settle();
        expect(res.status).toBe(204);
        expect(lines()).toEqual([]);
    });

    it('does not answer GET (the receiver is POST only)', async () => {
        const exec = makeExecutionContext({ label: 'csp-report-get' });
        const res = await app.request('/api/public/csp-report', { method: 'GET' }, h.env, exec.ctx);
        await exec.settle();
        expect(res.status).not.toBe(204);
    });
});

const fieldsFor = (i: number) => ({
    policy: 'a' as const, disposition: 'report' as const, effective_directive: 'script-src-elem',
    blocked: 'inline', document_path: `/page${i}`, source_file_origin: 'none', line: undefined, column: undefined,
});

describe('csp report sampling', () => {
    it('admits at most the cap per window, then admits again in the next window', () => {
        resetCspReportSampling();
        const t0 = 1_000_000;
        let admitted = 0;
        for (let i = 0; i < CSP_REPORT_MAX_PER_WINDOW + 20; i += 1) if (admitCspReport(t0 + i, fieldsFor(i))) admitted += 1;
        expect(admitted).toBe(CSP_REPORT_MAX_PER_WINDOW);
        expect(admitCspReport(t0 + CSP_REPORT_WINDOW_MS + 1, fieldsFor(0))).toBe(true);
    });

    it('a tuple seen in this window is dropped, and admitted again in the next window', () => {
        resetCspReportSampling();
        expect(admitCspReport(5_000_000, fieldsFor(1))).toBe(true);
        expect(admitCspReport(5_000_001, fieldsFor(1))).toBe(false);
        expect(admitCspReport(5_000_000 + CSP_REPORT_WINDOW_MS, fieldsFor(1))).toBe(true);
    });

    it('the endpoint silently drops the excess', async () => {
        h = await createHarness('standalone');
        resetCspReportSampling();
        info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
        try {
            for (let i = 0; i < CSP_REPORT_MAX_PER_WINDOW + 10; i += 1) {
                const doc = JSON.stringify({ 'csp-report': { ...legacy['csp-report'], 'document-uri': `https://app.test/page${i}` } });
                expect((await post(doc)).status).toBe(204);
            }
            expect(lines()).toHaveLength(CSP_REPORT_MAX_PER_WINDOW);
        } finally { info.mockRestore(); h.close(); }
    });
});

describe('csp report reduction', () => {
    it.each([
        ['inline', 'inline'], ['eval', 'eval'], ['data', 'data'], ['self', 'self'], ['blob', 'blob'],
        ['data:image/png;base64,AAAA', 'data'], ['blob:https://app.test/abc', 'blob'],
        ['https://cdn.example.com:8443/a/b?c=d#e', 'https://cdn.example.com:8443'],
        ['not a url', 'unknown'], [undefined, 'unknown'],
    ])('blocked %s -> %s', (input, expected) => {
        expect(reduceBlocked(input)).toBe(expected);
    });

    it('compares case-insensitively: an upper-case path and UUID reduce like a lower-case one', () => {
        expect(reduceDocumentPath(`https://a.test/INSPECTIONS/${UUID.toUpperCase()}/Edit`)).toBe('/inspections/:id/edit');
        expect(reduceDocumentPath('https://a.test/Login')).toBe(reduceDocumentPath('https://a.test/login'));
    });

    it('replaces UUID, long numeric and opaque token segments, and drops query and fragment', () => {
        expect(reduceDocumentPath(`https://a.test/inspections/${UUID}/edit?x=1#y`)).toBe('/inspections/:id/edit');
        expect(reduceDocumentPath('https://a.test/invoices/1234567/pay')).toBe('/invoices/:id/pay');
        expect(reduceDocumentPath('https://a.test/sign/' + 'a1B2c3D4'.repeat(4))).toBe('/sign/:id');
        expect(reduceDocumentPath('https://a.test/settings/team')).toBe('/settings/team');
        expect(reduceDocumentPath('garbage')).toBe('unknown');
    });

    it('caps long strings and clamps numbers', () => {
        const [r] = parseCspReports({
            'csp-report': {
                'document-uri': 'https://a.test/' + 'seg/'.repeat(100),
                'effective-directive': 'x'.repeat(500),
                'line-number': 9e15,
                'column-number': -5,
            },
        });
        expect(r!.document_path.length).toBeLessThanOrEqual(120);
        expect(r!.effective_directive.length).toBeLessThanOrEqual(40);
        expect(r!.line).toBe(10_000_000);
        expect(r!.column).toBe(0);
    });

    it('a field of the wrong type does not discard the report', () => {
        const [r] = parseCspReports({ 'csp-report': { 'blocked-uri': 42, disposition: 'report', 'line-number': 'x' } });
        expect(r).toMatchObject({ blocked: 'unknown', disposition: 'report', line: undefined });
    });
});
