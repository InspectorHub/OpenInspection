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

type Listener = (event: Record<string, unknown>) => void;

interface FetchOutcome { responded: boolean; response: Response | null }

function makeHarness(opts: { network?: (req: { url: string }) => Promise<Response> } = {}) {
    const listeners = new Map<string, Listener[]>();
    const store = new Map<string, Map<string, Response>>();
    let network = opts.network ?? (async () => new Response('net', { status: 200 }));
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
        get: (p: string, mode = 'cors') => dispatch('fetch', { request: { method: 'GET', url: ORIGIN + p, mode } }),
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

    it('purges on a logout navigation before the request goes out', async () => {
        const h = makeHarness({ network: reply('x') });
        await h.message({ type: 'set-user', marker: 'user-a' });
        await h.get(`/api/inspections/${ID}`);
        h.setNetwork(html());
        await h.get('/logout', 'navigate');
        expect(h.allUserPaths()).toEqual([]);
    });
});
