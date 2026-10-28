// @vitest-environment node
/**
 * public/sw.js is a classic script, so it cannot be imported. It is evaluated here in a vm context
 * with a fake `self`, `caches` and `fetch`, and driven through the same events the browser fires.
 * What is tested is the shipped file, not a copy of its logic.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { RESERVED_INSPECTION_SEGMENTS } from '../../server/lib/inspection/reserved-segments';

const SW_SOURCE = readFileSync(path.resolve(__dirname, '../../public/sw.js'), 'utf8');
const ORIGIN = 'https://app.test';
const ID = '3f2b8c1e-9a4d-4e6b-8c11-0a1b2c3d4e5f';
const SW_VERSION = /const SW_VERSION\s*=\s*'([^']+)'/.exec(SW_SOURCE)![1];

type Listener = (event: Record<string, unknown>) => void;

interface FetchOutcome { responded: boolean; response: Response | null }

function makeHarness(opts: { network?: (req: { url: string }) => Promise<Response> } = {}) {
    const listeners = new Map<string, Listener[]>();
    const store = new Map<string, Map<string, Response>>();
    let network = opts.network ?? (async () => new Response('net', { status: 200 }));
    // Names of caches whose writes throw, like a full disk (QuotaExceededError).
    const failingWrites = new Set<string>();
    const fakeCaches = {
        async open(name: string) {
            if (!store.has(name)) store.set(name, new Map());
            const m = store.get(name)!;
            return {
                async match(req: { url: string } | string) {
                    const hit = m.get(typeof req === 'string' ? new URL(req, ORIGIN).href : req.url);
                    return hit ? hit.clone() : undefined;
                },
                async put(req: { url: string } | string, res: Response) {
                    if (failingWrites.has(name)) throw new Error('QuotaExceededError');
                    m.set(typeof req === 'string' ? new URL(req, ORIGIN).href : req.url, res.clone());
                },
                async add(req: string) {
                    m.set(new URL(req, ORIGIN).href, await network({ url: new URL(req, ORIGIN).href }));
                },
                async delete(req: { url: string } | string) {
                    return m.delete(typeof req === 'string' ? new URL(req, ORIGIN).href : req.url);
                },
                async keys() { return [...m.keys()].map((url) => ({ url })); },
            };
        },
        async keys() { return [...store.keys()]; },
        async delete(name: string) { return store.delete(name); },
    };
    const self = {
        location: { origin: ORIGIN },
        addEventListener: (type: string, fn: Listener) => {
            listeners.set(type, [...(listeners.get(type) ?? []), fn]);
        },
        skipWaiting: () => undefined,
        clients: { claim: () => undefined, matchAll: async () => [] },
        registration: {},
    };
    vm.runInNewContext(SW_SOURCE, {
        self, caches: fakeCaches, URL, Response, Headers, Promise, console,
        fetch: (req: { url: string }) => network(req),
    });

    async function settle(ev: { waits: Promise<unknown>[] }) {
        // Background work may queue more work; drain until nothing new appears.
        let seen = 0;
        while (seen < ev.waits.length) {
            const batch = ev.waits.slice(seen);
            seen = ev.waits.length;
            await Promise.allSettled(batch);
        }
    }

    async function dispatch(type: string, extra: Record<string, unknown>) {
        const waits: Promise<unknown>[] = [];
        let responded = false;
        let respondP: Promise<Response> | null = null;
        const ev = {
            ...extra,
            waits,
            respondWith: (p: Promise<Response>) => { responded = true; respondP = Promise.resolve(p); },
            waitUntil: (p: Promise<unknown>) => { waits.push(Promise.resolve(p)); },
        };
        for (const fn of listeners.get(type) ?? []) fn(ev);
        let response: Response | null = null;
        if (respondP) response = await (respondP as Promise<Response>).catch(() => null);
        await settle(ev);
        return { responded, response } satisfies FetchOutcome;
    }

    return {
        store,
        setNetwork(fn: (req: { url: string }) => Promise<Response>) { network = fn; },
        failWritesTo(substr: string) {
            for (const n of ['static', 'user', 'meta']) if (n.includes(substr)) failingWrites.add(`openinspection-${n}-${SW_VERSION}`);
        },
        get: (p: string, mode = 'cors') => dispatch('fetch', { request: { method: 'GET', url: ORIGIN + p, mode } }),
        send: (method: string, p: string) => dispatch('fetch', { request: { method, url: ORIGIN + p, mode: 'cors' } }),
        message: (data: unknown) => dispatch('message', { data }),
        activate: () => dispatch('activate', {}),
        install: () => dispatch('install', {}),
        names: () => [...store.keys()],
        keysOf: (name: string) => [...(store.get(name)?.keys() ?? [])].map((u) => new URL(u).pathname),
        allUserPaths: () => [...store.entries()]
            .filter(([n]) => n.includes('user'))
            .flatMap(([, m]) => [...m.keys()].map((u) => new URL(u).pathname)),
    };
}

const body = (r: Response | null) => (r ? r.clone().text() : Promise.resolve('<none>'));
const reply = (text: string, init: ResponseInit = {}) => async () => new Response(text, { status: 200, ...init });

describe('sw.js: which requests are cached at all', () => {
    it.each([...RESERVED_INSPECTION_SEGMENTS])('never answers /api/inspections/%s from the cache', async (seg) => {
        const h = makeHarness();
        await h.message({ type: 'set-user', marker: 'user-a' });
        const out = await h.get(`/api/inspections/${seg}`);
        expect(out.responded).toBe(false);
        expect(h.allUserPaths()).toEqual([]);
    });

    it('never caches the list or an unrecognised sub-resource', async () => {
        const h = makeHarness();
        await h.message({ type: 'set-user', marker: 'user-a' });
        for (const p of ['/api/inspections', '/api/inspections/counts?x=1', `/api/inspections/${ID}/comments`, '/api/inspections/abc']) {
            expect((await h.get(p)).responded).toBe(false);
        }
    });

    it('caches a UUID inspection and its results for a known user', async () => {
        const h = makeHarness();
        await h.message({ type: 'set-user', marker: 'user-a' });
        expect((await h.get(`/api/inspections/${ID}`)).responded).toBe(true);
        expect((await h.get(`/api/inspections/${ID.toUpperCase()}/results`)).responded).toBe(true);
        expect(h.allUserPaths().sort()).toEqual([`/api/inspections/${ID.toUpperCase()}/results`, `/api/inspections/${ID}`].sort());
    });

    it('stores nothing while no user is known (fail closed)', async () => {
        const h = makeHarness();
        const out = await h.get(`/api/inspections/${ID}`);
        expect(await body(out.response)).toBe('net');
        expect(h.allUserPaths()).toEqual([]);
    });
});

describe('sw.js: the cache belongs to one user', () => {
    it('does not serve user A\'s entry to user B, and still serves it to A', async () => {
        const h = makeHarness({ network: reply('owner-data') });
        await h.message({ type: 'set-user', marker: 'user-a' });
        await h.get(`/api/inspections/${ID}`);

        h.setNetwork(reply('inspector-data'));
        await h.message({ type: 'set-user', marker: 'user-b' });
        expect(await body((await h.get(`/api/inspections/${ID}`)).response)).toBe('inspector-data');

        // Back to A while offline: B's entry is not A's, and A's was purged on the switch.
        h.setNetwork(async () => { throw new TypeError('offline'); });
        await h.message({ type: 'set-user', marker: 'user-a' });
        expect(await body((await h.get(`/api/inspections/${ID}`)).response)).not.toBe('owner-data');
    });

    it('serves the same user from the cache when offline', async () => {
        const h = makeHarness({ network: reply('mine') });
        await h.message({ type: 'set-user', marker: 'user-a' });
        await h.get(`/api/inspections/${ID}`);
        h.setNetwork(async () => { throw new TypeError('offline'); });
        expect(await body((await h.get(`/api/inspections/${ID}`)).response)).toBe('mine');
    });

    it('refuses an entry stamped for another user even if it is still in the store', async () => {
        const h = makeHarness({ network: reply('owner-data') });
        await h.message({ type: 'set-user', marker: 'user-a' });
        await h.get(`/api/inspections/${ID}`);
        // Simulate a purge that never ran: only the marker record changes hands.
        const meta = [...h.store.keys()].find((n) => n.includes('meta'))!;
        h.store.get(meta)!.set(ORIGIN + '/__oi/user-marker', new Response('user-b'));
        h.setNetwork(async () => { throw new TypeError('offline'); });
        expect(await body((await h.get(`/api/inspections/${ID}`)).response)).not.toBe('owner-data');
    });

    it('a refresh that lands after sign-out does not repopulate the cache', async () => {
        let release: (r: Response) => void = () => undefined;
        const h = makeHarness({ network: () => new Promise<Response>((res) => { release = res; }) });
        await h.message({ type: 'set-user', marker: 'user-a' });
        const pending = h.get(`/api/inspections/${ID}`);
        await new Promise((r) => setTimeout(r, 5));
        await h.message({ type: 'clear-user-cache' });
        release(new Response('late-owner-data', { status: 200 }));
        await pending;
        expect(h.allUserPaths()).toEqual([]);
    });

    it('drops an entry when the server stops authorising it', async () => {
        const h = makeHarness({ network: reply('data') });
        await h.message({ type: 'set-user', marker: 'user-a' });
        await h.get(`/api/inspections/${ID}`);
        h.setNetwork(async () => new Response('gone', { status: 404 }));
        await h.get(`/api/inspections/${ID}`);
        expect(h.allUserPaths()).toEqual([]);
    });

    it('caches photo files per user as well', async () => {
        const h = makeHarness({ network: reply('jpeg') });
        await h.message({ type: 'set-user', marker: 'user-a' });
        await h.get('/api/inspections/files/abc.jpg');
        await h.message({ type: 'set-user', marker: 'user-b' });
        h.setNetwork(async () => new Response('denied', { status: 404 }));
        expect(await body((await h.get('/api/inspections/files/abc.jpg')).response)).toBe('denied');
    });
});

describe('sw.js: clearing', () => {
    it('clear-user-cache empties the user cache and keeps static assets', async () => {
        const h = makeHarness({ network: reply('x') });
        await h.message({ type: 'set-user', marker: 'user-a' });
        await h.get(`/api/inspections/${ID}`);
        await h.get('/assets/app.js');
        expect(h.allUserPaths().length).toBe(1);
        await h.message({ type: 'clear-user-cache' });
        expect(h.allUserPaths()).toEqual([]);
        const staticName = h.names().find((n) => n.includes('static'))!;
        expect(h.keysOf(staticName)).toContain('/assets/app.js');
        // And the user is unknown again: nothing new is stored.
        await h.get(`/api/inspections/${ID}`);
        expect(h.allUserPaths()).toEqual([]);
    });

    it('a different marker purges the previous user\'s entries', async () => {
        const h = makeHarness({ network: reply('x') });
        await h.message({ type: 'set-user', marker: 'user-a' });
        await h.get(`/api/inspections/${ID}`);
        await h.message({ type: 'set-user', marker: 'user-b' });
        expect(h.allUserPaths()).toEqual([]);
    });

    it('a null marker (signed out) purges and stops caching', async () => {
        const h = makeHarness({ network: reply('x') });
        await h.message({ type: 'set-user', marker: 'user-a' });
        await h.get(`/api/inspections/${ID}`);
        await h.message({ type: 'set-user', marker: null });
        expect(h.allUserPaths()).toEqual([]);
        await h.get(`/api/inspections/${ID}`);
        expect(h.allUserPaths()).toEqual([]);
    });

    it('activate deletes every cache of an earlier version, including the old shared one', async () => {
        const h = makeHarness();
        h.store.set('openinspection-v3-a2', new Map([[`${ORIGIN}/api/inspections/counts`, new Response('{"all":3}')]]));
        await h.install();
        await h.activate();
        expect(h.names()).not.toContain('openinspection-v3-a2');
        expect(h.names().every((n) => !n.endsWith('v3-a2'))).toBe(true);
    });
});

describe('sw.js: pages (HTML) are per user too', () => {
    const html = (marker?: string) => async () => new Response('<html>page</html>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8', ...(marker ? { 'x-oi-session': marker } : {}) },
    });

    it('a navigation response carrying another session marker purges the previous user', async () => {
        const h = makeHarness({ network: reply('x') });
        await h.message({ type: 'set-user', marker: 'user-a' });
        await h.get(`/api/inspections/${ID}`);
        h.setNetwork(html('user-b'));
        await h.get('/inspections', 'navigate');
        expect(h.allUserPaths().some((p) => p.startsWith('/api/inspections/'))).toBe(false);
    });

    it('a navigation without a marker header changes nothing and stores no page', async () => {
        const h = makeHarness({ network: reply('x') });
        await h.message({ type: 'set-user', marker: 'user-a' });
        await h.get(`/api/inspections/${ID}`);
        h.setNetwork(html());
        await h.get('/login', 'navigate');
        expect(h.allUserPaths()).toEqual([`/api/inspections/${ID}`]);
    });

    it('does not show user A\'s cached page to user B when offline', async () => {
        const h = makeHarness({ network: html('user-a') });
        await h.message({ type: 'set-user', marker: 'user-a' });
        await h.get('/inspections', 'navigate');
        h.setNetwork(async () => { throw new TypeError('offline'); });
        await h.message({ type: 'set-user', marker: 'user-b' });
        const out = await h.get('/inspections', 'navigate');
        expect(out.response?.status).toBe(503);
    });

    it('serves user A\'s cached page to A when offline', async () => {
        const h = makeHarness({ network: html('user-a') });
        await h.get('/inspections', 'navigate');
        h.setNetwork(async () => { throw new TypeError('offline'); });
        const out = await h.get('/inspections', 'navigate');
        expect(await body(out.response)).toBe('<html>page</html>');
    });

    it('does not store a 404 page, and drops the copy it kept of a page the server now says is gone', async () => {
        const h = makeHarness({ network: html('user-a') });
        await h.get(`/inspections/${ID}/edit`, 'navigate');
        expect(h.allUserPaths()).toEqual([`/inspections/${ID}/edit`]);
        h.setNetwork(async () => new Response('<html>gone</html>', {
            status: 404,
            headers: { 'content-type': 'text/html; charset=utf-8', 'x-oi-session': 'user-a' },
        }));
        const out = await h.get(`/inspections/${ID}/edit`, 'navigate');
        expect(out.response?.status).toBe(404);
        expect(h.allUserPaths()).toEqual([]);
    });

    it('CONTROL - a 500 page leaves the cached copy for the offline case', async () => {
        const h = makeHarness({ network: html('user-a') });
        await h.get(`/inspections/${ID}/edit`, 'navigate');
        h.setNetwork(async () => new Response('<html>oops</html>', {
            status: 500,
            headers: { 'content-type': 'text/html; charset=utf-8', 'x-oi-session': 'user-a' },
        }));
        await h.get(`/inspections/${ID}/edit`, 'navigate');
        expect(h.allUserPaths()).toEqual([`/inspections/${ID}/edit`]);
    });

    it('purges on a logout navigation before the request goes out', async () => {
        const h = makeHarness({ network: reply('x') });
        await h.message({ type: 'set-user', marker: 'user-a' });
        await h.get(`/api/inspections/${ID}`);
        h.setNetwork(html());
        await h.get('/logout', 'navigate');
        expect(h.allUserPaths()).toEqual([]);
    });
});

describe('sw.js: a failed cache write never costs the user a live response', () => {
    it('returns the network answer for an inspection read when the cache write throws', async () => {
        const h = makeHarness({ network: reply('fresh') });
        await h.message({ type: 'set-user', marker: 'user-a' });
        h.failWritesTo('user');
        const out = await h.get(`/api/inspections/${ID}`);
        expect(await body(out.response)).toBe('fresh');
    });

    it('returns the live page for a navigation when the cache write throws, not the offline text', async () => {
        const h = makeHarness({
            network: async () => new Response('<html>live</html>', {
                status: 200,
                headers: { 'content-type': 'text/html; charset=utf-8', 'x-oi-session': 'user-a' },
            }),
        });
        h.failWritesTo('user');
        const out = await h.get('/inspections', 'navigate');
        expect(out.response?.status).toBe(200);
        expect(await body(out.response)).toBe('<html>live</html>');
    });

    it('does not store a 204 page (the Cache API refuses it)', async () => {
        const h = makeHarness({
            network: async () => new Response(null, { status: 204, headers: { 'content-type': 'text/html', 'x-oi-session': 'user-a' } }),
        });
        await h.get('/inspections', 'navigate');
        expect(h.allUserPaths()).toEqual([]);
    });
});

describe('sw.js: a deleted inspection is not readable from the cache', () => {
    const OTHER = '9c8b7a6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
    async function seeded(network: (req: { url: string }) => Promise<Response> = reply('data')) {
        const h = makeHarness({ network });
        await h.message({ type: 'set-user', marker: 'user-a' });
        for (const id of [ID, OTHER]) {
            await h.get(`/api/inspections/${id}`);
            await h.get(`/api/inspections/${id}/results`);
        }
        return h;
    }

    it('forgets the detail and the results once the server has deleted it', async () => {
        const h = await seeded();
        h.setNetwork(async () => new Response('{}', { status: 200 }));
        const out = await h.send('DELETE', `/api/inspections/${ID}`);
        expect(out.responded).toBe(true);
        expect(out.response?.status).toBe(200);
        expect(h.allUserPaths().sort()).toEqual([`/api/inspections/${OTHER}`, `/api/inspections/${OTHER}/results`].sort());
    });

    it('matches the id however it is cased', async () => {
        const h = await seeded();
        h.setNetwork(async () => new Response('{}', { status: 200 }));
        await h.send('DELETE', `/api/inspections/${ID.toUpperCase()}`);
        expect(h.allUserPaths().every((p) => !p.toLowerCase().includes(ID))).toBe(true);
    });

    it('also forgets them when the server says the inspection is already gone (404, 410)', async () => {
        for (const status of [404, 410]) {
            const h = await seeded();
            h.setNetwork(async () => new Response('gone', { status }));
            await h.send('DELETE', `/api/inspections/${ID}`);
            expect(h.allUserPaths().some((p) => p.includes(ID))).toBe(false);
        }
    });

    it('CONTROL - a refused delete (500, 403) keeps what is cached', async () => {
        for (const status of [500, 403]) {
            const h = await seeded();
            h.setNetwork(async () => new Response('no', { status }));
            const out = await h.send('DELETE', `/api/inspections/${ID}`);
            expect(out.response?.status).toBe(status);
            expect(h.allUserPaths()).toHaveLength(4);
        }
    });

    it('CONTROL - deleting another inspection keeps these, and other writes are left alone', async () => {
        const h = await seeded();
        h.setNetwork(async () => new Response('{}', { status: 200 }));
        await h.send('DELETE', `/api/inspections/${OTHER}`);
        expect(h.allUserPaths().filter((p) => p.includes(ID))).toHaveLength(2);
        expect((await h.send('POST', `/api/inspections/${ID}/results`)).responded).toBe(false);
        expect((await h.send('DELETE', '/api/inspections/counts')).responded).toBe(false);
        expect(h.allUserPaths().filter((p) => p.includes(ID))).toHaveLength(2);
    });
});

describe('sw.js: forget-inspection message (the page deletes through a route action, so the worker never sees the DELETE)', () => {
    const OTHER = '9c8b7a6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
    const userCache = () => `openinspection-user-${SW_VERSION}`;

    async function seeded() {
        const h = makeHarness({ network: reply('data') });
        await h.message({ type: 'set-user', marker: 'user-a' });
        // A cached read, plus the page and photo entries a visit leaves behind.
        for (const id of [ID, OTHER]) {
            await h.get(`/api/inspections/${id}`);
            await h.get(`/api/inspections/${id}/results`);
        }
        const user = h.store.get(userCache())!;
        const stamp = () => new Response('x', { headers: { 'x-oi-user': 'user-a' } });
        for (const p of [
            `/inspections/${ID}`, `/inspections/${ID}/edit`, `/inspections/${ID}.data`, `/inspections/${ID}/edit.data`,
            `/inspections/${OTHER}`, `/inspections/${OTHER}/edit`, '/inspections',
            `/api/inspections/files/tenant1%2F${ID}%2Fitem_aaaa_roof.jpg`, `/api/inspections/files/tenant1/${ID}/item_bbbb_gutter.jpg`,
            `/api/inspections/files/tenant1%2F${OTHER}%2Fitem_cccc_roof.jpg`,
            `/api/inspections/files/tenant1%2F${OTHER}%2Fitem_dddd_${ID}.jpg`,
            // Multi-route data requests and pages that carry an inspection id in the query or deeper in the path.
            `/inspections/${ID}.data?_routes=routes%2Finspector-portal`,
            `/inspections.data?_routes=routes%2Finspections&focus=${ID}`,
            `/report-view/acme/${ID}`,
            `/inspections.data?_routes=routes%2Finspections&focus=${OTHER}`,
            `/report-view/acme/${OTHER}`,
            `/inspections?ref=${ID}abc`,
        ]) user.set(ORIGIN + p, stamp());
        return h;
    }

    it('forgets the cached detail, results, pages and photo files of that inspection, and nothing else', async () => {
        const h = await seeded();
        await h.message({ type: 'forget-inspection', id: ID });
        // Compared as path + query, because the multi-route entries differ only in their query.
        const left = [...h.store.get(userCache())!.keys()]
            .map((u) => decodeURIComponent(new URL(u).pathname + new URL(u).search)).sort();
        expect(left).toEqual([
            '/inspections',
            `/inspections/${OTHER}`, `/inspections/${OTHER}/edit`,
            `/api/inspections/${OTHER}`, `/api/inspections/${OTHER}/results`,
            `/api/inspections/files/tenant1/${OTHER}/item_cccc_roof.jpg`,
            `/api/inspections/files/tenant1/${OTHER}/item_dddd_${ID}.jpg`,
            // Another inspection's multi-route entry and page stay, and so does a query that only STARTS with this id.
            `/inspections.data?_routes=routes/inspections&focus=${OTHER}`,
            `/report-view/acme/${OTHER}`,
            `/inspections?ref=${ID}abc`,
        ].sort());
    });

    it('matches the id however it is cased', async () => {
        const h = await seeded();
        await h.message({ type: 'forget-inspection', id: ID.toUpperCase() });
        expect(h.allUserPaths().some((p) => decodeURIComponent(p).toLowerCase().includes(`/${ID}`) && !p.includes(OTHER))).toBe(false);
    });

    it('CONTROL - a malformed id, a missing id and other message types do nothing', async () => {
        const h = await seeded();
        const before = h.allUserPaths().length;
        for (const msg of [
            { type: 'forget-inspection', id: 'not-a-uuid' },
            { type: 'forget-inspection', id: `${ID}/../${OTHER}` },
            { type: 'forget-inspection', id: '*' },
            { type: 'forget-inspection', id: 'tenant1' }, // would match every photo of that tenant if it were not a whole id
            { type: 'forget-inspection', id: 'item_aaaa_roof.jpg' },
            { type: 'forget-inspection' },
            { type: 'forget-inspection', id: 42 },
            { type: 'something-else', id: ID },
        ]) await h.message(msg);
        expect(h.allUserPaths()).toHaveLength(before);
    });
});
