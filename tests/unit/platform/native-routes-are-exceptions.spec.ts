/**
 * Every route the application serves is an OpenAPI operation, or it is a named exception.
 *
 * A route registered with a plain `.get('/x', handler)` is invisible to the generated document,
 * to the MCP tool list built from it, to the typed-client contract and to the native contract. That
 * is right for a WebSocket upgrade, a webhook that verifies a signature over the raw body, a file
 * download or a redirect, and wrong for a JSON API nobody remembered to describe. Nothing used to
 * tell the two apart, so a new plain JSON route looked exactly like a deliberate exception.
 *
 * This spec makes the difference visible. It reads the runtime route table of the real application,
 * subtracts every method and path the generated OpenAPI document declares, and requires what is left
 * to equal `NATIVE_ROUTE_EXCEPTIONS` exactly:
 *   - a route with no entry fails, by name (this is the gate: describe the route with `createRoute`,
 *     or add an entry with a category and a reason someone will review);
 *   - an entry whose route is gone, or is now described in the document, fails as stale;
 *   - the number of entries may not exceed `MAX_ENTRIES`, a ratchet that only goes down.
 *
 * The universe is `app.routes` of the full application exactly as the contract-drift spec builds
 * it: every router mounted in `server/index.ts`, the routes registered through helper functions
 * (R2 video, the webhook helpers, the platform control-plane module) included. Routes registered
 * under the method `ALL` (middleware and `app.all` dispatch lines) are excluded: they are not
 * handlers of one operation. Hono repeats a route's key for its validators, so keys are
 * deduplicated. Path parameters are compared in the OpenAPI spelling (`{id}`).
 *
 * What it cannot see, by construction: routes served outside the Hono application (the OAuth
 * provider wrapper in `workers/app.ts` and its `/oauth/*` and `/.well-known/oauth-*` paths, the
 * Durable Object internal fetch paths, and the React Router resource routes under `app/`). Those
 * are not Hono routes and are out of scope here.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { app } from '../../../server/index';
import { buildOpenApiDocument } from '../../../server/lib/openapi/build-document';
import {
    MAX_ENTRIES,
    NATIVE_ROUTE_CATEGORIES,
    NATIVE_ROUTE_EXCEPTIONS,
    type NativeRouteException,
} from './native-route-exceptions';

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

/** Hono spells a parameter `:id` (optionally `:id{regex}` or `:id?`); OpenAPI spells it `{id}`. */
function canonicalPath(path: string): string {
    return path.replace(/:([A-Za-z0-9_]+)(\{[^}]*\})?\??/g, '{$1}');
}

interface RouteSource { routes: ReadonlyArray<{ method: string; path: string }> }

/** Every handler-bearing method and path of an application, deduplicated, in the canonical spelling. */
function runtimeRoutes(source: RouteSource): string[] {
    const keys = new Set<string>();
    for (const route of source.routes) {
        if (typeof route.path !== 'string') continue;
        if (!HTTP_METHODS.has(route.method)) continue;
        keys.add(`${route.method} ${canonicalPath(route.path)}`);
    }
    return [...keys].sort();
}

/** Every `METHOD /path` the OpenAPI document declares. */
function documentedRoutes(doc: { paths?: Record<string, unknown> }): Set<string> {
    const keys = new Set<string>();
    for (const [path, item] of Object.entries(doc.paths ?? {})) {
        if (typeof item !== 'object' || item === null) continue;
        for (const method of Object.keys(item)) {
            const upper = method.toUpperCase();
            if (HTTP_METHODS.has(upper)) keys.add(`${upper} ${canonicalPath(path)}`);
        }
    }
    return keys;
}

/** The routes the application serves that the document does not describe. */
function nativeRoutes(source: RouteSource, doc: { paths?: Record<string, unknown> }): string[] {
    const documented = documentedRoutes(doc);
    return runtimeRoutes(source).filter((key) => !documented.has(key));
}

interface Verdict { unlisted: string[]; stale: string[]; duplicates: string[] }

/** Compare the native routes with the exceptions list. Both lists are keyed `METHOD /path`. */
function compare(native: readonly string[], entries: readonly { key: string }[]): Verdict {
    const listed = entries.map((e) => e.key);
    const nativeSet = new Set(native);
    const listedSet = new Set(listed);
    return {
        unlisted: native.filter((key) => !listedSet.has(key)),
        stale: listed.filter((key) => !nativeSet.has(key)),
        duplicates: listed.filter((key, i) => listed.indexOf(key) !== i),
    };
}

const CLEAN: Verdict = { unlisted: [], stale: [], duplicates: [] };

let universe: string[] = [];
let native: string[] = [];

beforeAll(() => {
    const doc = buildOpenApiDocument(app, {
        openapi: '3.0.0',
        info: { version: 'native-routes', title: 'OpenInspection Native Routes' },
    });
    universe = runtimeRoutes(app);
    native = nativeRoutes(app, doc);
}, 60_000);

describe('every route is an OpenAPI operation or a named exception', { timeout: 30_000 }, () => {
    it('reads a non-empty route table and prints both numbers', () => {
        const perCategory = NATIVE_ROUTE_CATEGORIES.map(
            (c) => `${c}=${NATIVE_ROUTE_EXCEPTIONS.filter((e) => e.category === c).length}`,
        ).join(' ');
        console.info(
            `[gate] native routes found=${native.length} exceptions listed=${NATIVE_ROUTE_EXCEPTIONS.length} ` +
            `max=${MAX_ENTRIES} runtime routes=${universe.length} | ${perCategory}`,
        );
        expect(universe.length, 'zero routes means the reader is broken, not that the app is clean').toBeGreaterThan(100);
        expect(native.length, 'no native route at all means the subtraction is broken').toBeGreaterThan(0);
    });

    it('lists every native route, and names no route that is documented or gone', () => {
        expect(compare(native, NATIVE_ROUTE_EXCEPTIONS), [
            'unlisted: describe the route with createRoute (preferred), or add an entry to',
            'tests/unit/platform/native-route-exceptions.ts with a category and a reason.',
            'stale: the route is gone or is now in the OpenAPI document; delete the entry.',
        ].join(' ')).toEqual(CLEAN);
    });

    it('keeps the exception count at or under the ratchet', () => {
        expect(
            NATIVE_ROUTE_EXCEPTIONS.length,
            'MAX_ENTRIES may only go down; a new exception needs a reviewed reason, not a higher ceiling',
        ).toBeLessThanOrEqual(MAX_ENTRIES);
    });

    it('uses a closed category list and a one-line English reason on every entry', () => {
        const categories: readonly string[] = NATIVE_ROUTE_CATEGORIES;
        const bad = NATIVE_ROUTE_EXCEPTIONS.filter(
            (e: NativeRouteException) =>
                !categories.includes(e.category)
                || e.reason.trim().length === 0
                || e.reason.length > 120
                || /[^\x20-\x7E]/.test(e.reason)
                || !/^(GET|POST|PUT|PATCH|DELETE) \//.test(e.key),
        );
        expect(bad.map((e) => e.key)).toEqual([]);
    });

});

describe('the gate is not vacuous (positive controls on a fixture application)', () => {
    const fixture = new Hono();
    fixture.get('/api/fixture/json', (c) => c.json({ ok: true }));
    fixture.get('/api/fixture/items/:id', (c) => c.json({ id: c.req.param('id') }));
    fixture.use('/api/fixture/*', async (_c, next) => { await next(); });
    fixture.all('/api/fixture/dispatch', (c) => c.text('x'));
    const doc = { paths: { '/api/fixture/items/{id}': { get: {} } } };

    it('reads the fixture table, drops middleware and ALL lines, normalises parameters, subtracts the document', () => {
        expect(runtimeRoutes(fixture)).toEqual(['GET /api/fixture/items/{id}', 'GET /api/fixture/json']);
        expect(nativeRoutes(fixture, doc)).toEqual(['GET /api/fixture/json']);
    });

    it('flags a native JSON route with no entry, by name', () => {
        expect(compare(nativeRoutes(fixture, doc), [])).toEqual({ ...CLEAN, unlisted: ['GET /api/fixture/json'] });
    });

    it('passes a listed route', () => {
        expect(compare(nativeRoutes(fixture, doc), [{ key: 'GET /api/fixture/json' }])).toEqual(CLEAN);
    });

    it('flags a stale entry whose route is gone, and one that is now documented', () => {
        const entries = [{ key: 'GET /api/fixture/json' }, { key: 'GET /api/fixture/gone' }, { key: 'GET /api/fixture/items/{id}' }];
        expect(compare(nativeRoutes(fixture, doc), entries).stale).toEqual(['GET /api/fixture/gone', 'GET /api/fixture/items/{id}']);
    });

    it('flags a duplicated entry', () => {
        const entries = [{ key: 'GET /api/fixture/json' }, { key: 'GET /api/fixture/json' }];
        expect(compare(nativeRoutes(fixture, doc), entries).duplicates).toEqual(['GET /api/fixture/json']);
    });

    it('reads an empty table as zero routes, which the real-app test above rejects', () => {
        expect(runtimeRoutes(new Hono())).toEqual([]);
    });
});
