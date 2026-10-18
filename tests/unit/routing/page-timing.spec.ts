/**
 * Per-route page timing: one aggregatable `page_timing` log line per sampled HTML
 * page response and a `Server-Timing` header on every HTML page response.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_COOKIE_NAME } from '../../../server/lib/auth-helpers';
import type { ServerRoutes } from '../../../server/lib/page-timing';

const ROUTES: ServerRoutes = {
    root: { id: 'root', path: '' },
    home: { id: 'home', parentId: 'root', index: true },
    login: { id: 'login', parentId: 'root', path: 'login' },
    insp: { id: 'insp', parentId: 'root', path: 'inspections/:id' },
    edit: { id: 'edit', parentId: 'insp', path: 'edit' },
    book: { id: 'book', parentId: 'root', path: 'book/:tenant' },
};

/** Module state (page counter, cold flag) is per isolate, so every test gets a fresh isolate. */
async function fresh() {
    vi.resetModules();
    return import('../../../server/lib/page-timing');
}
type Mod = Awaited<ReturnType<typeof fresh>>;

function html(body: string | null = '<p>hi</p>', init: { status?: number; headers?: HeadersInit } = {}): Response {
    return new Response(body, {
        status: init.status ?? 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8', ...(init.headers as Record<string, string> | undefined) },
    });
}
const json = () => new Response('{}', { headers: { 'Content-Type': 'application/json' } });

describe('sampleReason', () => {
    it('always keeps errors, slow pages and the first page', async () => {
        const m = await fresh();
        expect(m.sampleReason({ status: 500, wallMs: 5, pageN: 2 })).toBe('error');
        expect(m.sampleReason({ status: 503, wallMs: 5, pageN: 3 })).toBe('error');
        expect(m.sampleReason({ status: 200, wallMs: m.PAGE_TIMING_SLOW_MS + 1, pageN: 2 })).toBe('slow');
        expect(m.sampleReason({ status: 200, wallMs: m.PAGE_TIMING_SLOW_MS, pageN: 2 })).toBeNull();
        expect(m.sampleReason({ status: 200, wallMs: 5, pageN: 1 })).toBe('cold');
    });
    it('keeps exactly 1 in N of the rest, deterministically', async () => {
        const m = await fresh();
        const kept = Array.from({ length: 100 }, (_, i) => i + 2).filter(
            (pageN) => m.sampleReason({ status: 200, wallMs: 5, pageN }) === 'n',
        );
        expect(kept.every((n) => n % m.PAGE_TIMING_SAMPLE_EVERY === 0)).toBe(true);
        expect(kept).toHaveLength(Math.floor(101 / m.PAGE_TIMING_SAMPLE_EVERY));
    });
});

describe('createRoutePatternResolver', () => {
    it('returns the pattern, never ids or slugs', async () => {
        const resolve = (await fresh()).createRoutePatternResolver(ROUTES);
        expect(resolve('/inspections/0b1c2d3e-secret/edit')).toBe('/inspections/:id/edit');
        expect(resolve('/book/acme-inspections')).toBe('/book/:tenant');
        expect(resolve('/login')).toBe('/login');
        expect(resolve('/')).toBe('/');
    });
    it('collapses a path no route claims into one bounded value', async () => {
        const resolve = (await fresh()).createRoutePatternResolver(ROUTES);
        expect(resolve('/a/b/c/d')).toBe('unmatched');
    });
    it('handles a splat, an optional segment and a pathless layout route', async () => {
        const resolve = (await fresh()).createRoutePatternResolver({
            root: { id: 'root', path: '' },
            layout: { id: 'layout', parentId: 'root' }, // pathless
            docs: { id: 'docs', parentId: 'layout', path: 'docs/*' },
            lang: { id: 'lang', parentId: 'root', path: ':lang?/about' },
        });
        expect(resolve('/docs/a/secret-id-123/b')).toBe('/docs/*');
        expect(resolve('/about')).toBe('/:lang?/about');
        expect(resolve('/fr/about')).toBe('/:lang?/about');
    });
});

describe('finishPage', () => {
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

    function run(
        m: Mod,
        opts: {
            res: Response;
            method?: string;
            getRoutes?: () => ServerRoutes | undefined;
            inprocCalls?: () => number;
            url?: string;
            cookie?: string;
            extraHeaders?: Record<string, string>;
        },
    ) {
        return m.finishPage({
            request: new Request(opts.url ?? 'https://example.test/inspections/0b1c2d3e-secret/edit?token=SECRET&email=a@b.co', {
                method: opts.method ?? 'GET',
                headers: {
                    'User-Agent': 'UA-SENTINEL',
                    'x-forwarded-for': '203.0.113.77',
                    Cookie: opts.cookie ?? `${AUTH_COOKIE_NAME}=JWT-SENTINEL`,
                },
            }),
            res: opts.res,
            startedAt: Date.now() - 40,
            inprocCalls: opts.inprocCalls ?? (() => 14),
            getRoutes: opts.getRoutes ?? (() => ROUTES),
            extraHeaders: opts.extraHeaders,
        });
    }
    const data = (i: number) => (JSON.parse(lines[i]!) as { message: string; data: Record<string, unknown> }).data;

    it('adds Server-Timing to an HTML page and leaves the body intact', async () => {
        const m = await fresh();
        const out = run(m, { res: html('<p>body</p>') });
        expect(out.headers.get('Server-Timing')).toMatch(/^app;dur=\d+$/);
        expect(await out.text()).toBe('<p>body</p>');
    });

    it('never reads the body: a pending stream is returned as the same stream', async () => {
        const m = await fresh();
        const stream = new ReadableStream<Uint8Array>({ start() { /* never enqueues, never closes */ } });
        const getReader = vi.spyOn(stream, 'getReader');
        const tee = vi.spyOn(stream, 'tee');
        const inner = new Response(stream, { headers: { 'Content-Type': 'text/html' } });
        const out = run(m, { res: inner });
        // Returning at all (instead of waiting for the stream) proves nothing was buffered.
        expect(out.headers.has('Server-Timing')).toBe(true);
        expect(getReader).not.toHaveBeenCalled();
        expect(tee).not.toHaveBeenCalled();
    });

    it('preserves several Set-Cookie headers and merges extra headers', async () => {
        const m = await fresh();
        const inner = html();
        inner.headers.append('Set-Cookie', 'a=1; Path=/; HttpOnly');
        inner.headers.append('Set-Cookie', 'b=2; Path=/; Secure');
        const out = run(m, { res: inner, extraHeaders: { 'x-oi-session': 'marker' } });
        expect(out.headers.getSetCookie()).toEqual(['a=1; Path=/; HttpOnly', 'b=2; Path=/; Secure']);
        expect(out.headers.get('x-oi-session')).toBe('marker');
        expect(out.status).toBe(200);
    });

    it('never mutates the input response headers', async () => {
        const m = await fresh();
        const inner = html();
        const set = vi.spyOn(inner.headers, 'set');
        const append = vi.spyOn(inner.headers, 'append');
        const out = run(m, { res: inner, extraHeaders: { 'x-oi-session': 'marker' } });
        expect(out).not.toBe(inner);
        expect(inner.headers.has('Server-Timing')).toBe(false);
        expect(inner.headers.has('x-oi-session')).toBe(false);
        expect(set).not.toHaveBeenCalled();
        expect(append).not.toHaveBeenCalled();
    });

    it('returns the original object for non-HTML, and does not count it as a page', async () => {
        const m = await fresh();
        const a = json();
        expect(run(m, { res: a })).toBe(a);
        expect(lines).toHaveLength(0);
        // The first PAGE after non-page traffic is still the cold one.
        run(m, { res: html() });
        expect(data(0)).toMatchObject({ req_n: 1, cold: 1, sample: 'cold' });
    });

    it.each([
        ['204', () => new Response(null, { status: 204, headers: { 'Content-Type': 'text/html' } })],
        ['304', () => new Response(null, { status: 304, headers: { 'Content-Type': 'text/html' } })],
        ['redirect', () => new Response(null, { status: 302, headers: { 'Content-Type': 'text/html', Location: '/login' } })],
    ])('passes a %s response through untouched and uncounted', async (_n, make) => {
        const m = await fresh();
        const r = make();
        expect(run(m, { res: r })).toBe(r);
        expect(lines).toHaveLength(0);
        run(m, { res: html() });
        expect(data(0)).toMatchObject({ req_n: 1, cold: 1 });
    });

    it('handles HEAD without throwing', async () => {
        const m = await fresh();
        const out = run(m, { method: 'HEAD', res: new Response(null, { headers: { 'Content-Type': 'text/html' } }) });
        expect(out.headers.get('Server-Timing')).toMatch(/^app;dur=\d+$/);
    });

    it('appends to an existing Server-Timing instead of replacing it', async () => {
        const m = await fresh();
        const out = run(m, { res: html('x', { headers: { 'Server-Timing': 'db;dur=3' } }) });
        expect(out.headers.get('Server-Timing')).toMatch(/^db;dur=3, app;dur=\d+$/);
    });

    it('counts pages only: interleaved non-pages do not move the cadence', async () => {
        const m = await fresh();
        const n = m.PAGE_TIMING_SAMPLE_EVERY;
        for (let i = 0; i < n * 2; i++) {
            run(m, { res: json() });
            run(m, { res: json() });
            run(m, { res: html() });
        }
        const reqs = lines.map((_l, i) => data(i));
        // cold (page 1), then pages n and 2n.
        expect(reqs.map((d) => [d.req_n, d.sample])).toEqual([[1, 'cold'], [n, 'n'], [n * 2, 'n']]);
        expect(reqs.map((d) => d.cold)).toEqual([1, 0, 0]);
    });

    it('always logs a 5xx page', async () => {
        const m = await fresh();
        run(m, { res: html() }); // cold
        run(m, { res: html('oops', { status: 500 }) });
        expect(data(1)).toMatchObject({ status: 500, sample: 'error', req_n: 2 });
    });

    it('logs the documented fields, all numeric or low-cardinality strings', async () => {
        const m = await fresh();
        run(m, { res: html() });
        const entry = JSON.parse(lines[0]!) as { message: string; data: Record<string, unknown> };
        expect(entry.message).toBe('page_timing');
        expect(entry.data).toEqual({
            kind: 'page',
            route: '/inspections/:id/edit',
            status: 200,
            wall_ms: expect.any(Number),
            cold: 1,
            req_n: 1,
            authed: 1,
            sample: 'cold',
            inproc_calls: 14,
        });
    });

    it('reports authed from cookie presence only, never from its value', async () => {
        const m = await fresh();
        run(m, { res: html(), cookie: 'theme=dark' });
        expect(data(0).authed).toBe(0);
        run(m, { res: html(), cookie: `${AUTH_COOKIE_NAME}=garbage-not-a-jwt` });
        run(m, { res: html(), cookie: `x_${AUTH_COOKIE_NAME}=1` });
    });

    it('writes no id, slug, email, token, query string, cookie value, IP or user agent', async () => {
        const m = await fresh();
        run(m, { res: html() });
        const raw = lines[0]!;
        for (const s of ['0b1c2d3e', 'SECRET', 'a@b.co', 'JWT-SENTINEL', 'UA-SENTINEL', '203.0.113.77', 'token=', 'example.test']) {
            expect(raw, `leaked ${s}`).not.toContain(s);
        }
    });

    it('logs "pending" when the server build is not loaded, and "unknown" if resolution throws', async () => {
        const m = await fresh();
        run(m, { res: html(), getRoutes: () => undefined });
        expect(data(0).route).toBe('pending');
        run(m, {
            res: html('x', { status: 500 }),
            getRoutes: () => {
                throw new Error('boom');
            },
        });
        expect(data(1).route).toBe('unknown');
    });

    it('omits inproc_calls when no counter is supplied', async () => {
        const m = await fresh();
        m.finishPage({
            request: new Request('https://example.test/login'),
            res: html(),
            startedAt: Date.now(),
            getRoutes: () => ROUTES,
        });
        expect(data(0)).not.toHaveProperty('inproc_calls');
    });
});

describe('createServerBuildTracker', () => {
    beforeEach(() => {
        vi.spyOn(console, 'info').mockImplementation(() => undefined);
    });
    afterEach(() => vi.restoreAllMocks());

    it('never calls the loader on its own: a cold request with a timing line loads nothing', async () => {
        const m = await fresh();
        const loader = vi.fn(async () => ({ routes: ROUTES }));
        const tracker = m.createServerBuildTracker(loader);
        const out = m.finishPage({
            request: new Request('https://example.test/login'),
            res: html(),
            startedAt: Date.now(),
            getRoutes: tracker.getRoutes,
        });
        expect(out.headers.has('Server-Timing')).toBe(true);
        expect(loader).not.toHaveBeenCalled();
        expect(tracker.getRoutes()).toBeUndefined();
    });

    it('exposes the route table only after the renderer itself has loaded the build', async () => {
        const m = await fresh();
        const loader = vi.fn(async () => ({ routes: ROUTES }));
        const tracker = m.createServerBuildTracker(loader);
        await tracker.load(); // what the request handler does when it renders
        expect(loader).toHaveBeenCalledTimes(1);
        expect(tracker.getRoutes()).toBe(ROUTES);
        await tracker.load();
        expect(loader).toHaveBeenCalledTimes(2); // the tracker is a pass-through, it adds no caching of its own
    });

    it('stays unloaded when the loader rejects', async () => {
        const m = await fresh();
        const tracker = m.createServerBuildTracker(async () => {
            throw new Error('nope');
        });
        await expect(tracker.load()).rejects.toThrow('nope');
        expect(tracker.getRoutes()).toBeUndefined();
    });
});

describe('cookie name', () => {
    it('is the one the session code writes', async () => {
        const m = await fresh();
        expect(m.PAGE_TIMING_SESSION_COOKIE).toBe(AUTH_COOKIE_NAME);
    });
});
