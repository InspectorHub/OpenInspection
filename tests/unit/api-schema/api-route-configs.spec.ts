import { describe, it, expect, beforeAll } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergePath } from 'hono/utils/url';
import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../../../server/lib/openapi-router';
import { mounted } from '../../../server/lib/api-schema';
import type { Mounted, RoutePart } from '../../../server/lib/api-schema';
import { CONVERTED_API_MODULES } from '../helpers/converted-api-modules';

/**
 * A converted router's `XxxApi` type is derived from its `xxxRouteConfigs` / `xxxRouteParts` tuple, not
 * from the `app.openapi(...)` / `app.route(...)` statements, so the type cannot notice a route that was
 * registered but left out of the tuple, a child router mounted but left out, or a mount at the wrong
 * prefix (each would silently vanish from, or move inside, the typed client). This pins the tuple to what
 * the router really registered, for every module in CONVERTED_API_MODULES:
 *   - the OpenAPI registry (`method path`, the path the library merges for each mount), in order;
 *   - Hono's own route table (`method :path`), in order, which is what actually dispatches;
 *   - for every mounted child, the child router's own registry against the parts it was mounted with.
 */

type Router = ReturnType<typeof createApiRouter>;
type AnyMounted = Mounted<string, readonly RoutePart[]>;

const isMounted = (part: RoutePart): part is AnyMounted => 'parts' in part;

function registered(app: Router): string[] {
    return app.openAPIRegistry.definitions.flatMap((d) => (d.type === 'route' ? [`${d.route.method} ${d.route.path}`] : []));
}

/** Hono's dispatch table: one entry per handler, so the middleware and validators of a route repeat its key. */
function dispatched(app: Router): string[] {
    const keys = app.routes
        .filter((r) => r.method !== 'ALL')
        .map((r) => `${r.method.toLowerCase()} ${r.path}`);
    return keys.filter((key, i) => key !== keys[i - 1]);
}

/** What `registered` must return for a parts list: mounts expanded in place, prefixes merged the library's way. */
function expected(parts: readonly RoutePart[], prefix = '/'): string[] {
    return parts.flatMap((part) =>
        isMounted(part) ? expected(part.parts, mergePath(prefix, part.prefix)) : [`${part.method} ${mergePath(prefix, part.path)}`],
    );
}

/** The same list as Hono's route table spells it (`{id}` is `:id`). */
function expectedDispatch(parts: readonly RoutePart[]): string[] {
    return expected(parts).map((key) => key.replace(/\{([^}]+)\}/g, ':$1'));
}

function mountsIn(parts: readonly RoutePart[]): AnyMounted[] {
    return parts.flatMap((part) => (isMounted(part) ? [part, ...mountsIn(part.parts)] : []));
}

const ok = { 200: { description: 'ok', content: { 'application/json': { schema: z.object({ ok: z.literal(true) }) } } } };
const routeA = createRoute({ method: 'get', path: '/a', responses: ok });
const routeB = createRoute({ method: 'post', path: '/b/{id}', request: { params: z.object({ id: z.string() }) }, responses: ok });
const routeC = createRoute({ method: 'get', path: '/', responses: ok });

function tinyRouter(): Router {
    const app = createApiRouter();
    app.openapi(routeA, (c) => c.json({ ok: true as const }, 200));
    app.openapi(routeB, (c) => c.json({ ok: true as const }, 200));
    return app;
}

function tinyChild(): Router {
    const app = createApiRouter();
    app.openapi(routeA, (c) => c.json({ ok: true as const }, 200));
    app.openapi(routeC, (c) => c.json({ ok: true as const }, 200));
    return app;
}
const childParts = [routeA, routeC] as const;

/** A route, then a mount, then a route again: the mixed order public-report.ts registers in. */
function tinyParent(): Router {
    const app = createApiRouter();
    app.openapi(routeB, (c) => c.json({ ok: true as const }, 200));
    app.route('/x', tinyChild());
    app.openapi(routeA, (c) => c.json({ ok: true as const }, 200));
    return app;
}

describe('the comparison used below can say no', () => {
    it('accepts the tuple that matches the registrations', () => {
        expect(expected([routeA, routeB])).toEqual(registered(tinyRouter()));
    });

    it('rejects a route that is registered but missing from the tuple', () => {
        expect(expected([routeA])).not.toEqual(registered(tinyRouter()));
    });

    it('rejects a route that is in the tuple but was never registered', () => {
        const app = createApiRouter();
        app.openapi(routeA, (c) => c.json({ ok: true as const }, 200));
        expect(expected([routeA, routeB])).not.toEqual(registered(app));
    });

    it('rejects a different order', () => {
        expect(expected([routeB, routeA])).not.toEqual(registered(tinyRouter()));
    });

    describe('with a mounted child', () => {
        const child = tinyChild();
        const parts = [routeB, mounted('/x', child, childParts), routeA] as const;

        it('accepts the parts that match, mount and prefix included', () => {
            const app = tinyParent();
            expect(expected(parts)).toEqual(['post /b/{id}', 'get /x/a', 'get /x', 'get /a']);
            expect(expected(parts)).toEqual(registered(app));
            expect(expectedDispatch(parts)).toEqual(dispatched(app));
        });

        it('rejects a mount that is missing from the parts', () => {
            expect(expected([routeB, routeA])).not.toEqual(registered(tinyParent()));
        });

        it('rejects a mount at the wrong prefix', () => {
            expect(expected([routeB, mounted('/y', child, childParts), routeA])).not.toEqual(registered(tinyParent()));
            expect(expectedDispatch([routeB, mounted('/y', child, childParts), routeA])).not.toEqual(dispatched(tinyParent()));
        });

        it('rejects a mount listed at the wrong position', () => {
            expect(expected([mounted('/x', child, childParts), routeB, routeA])).not.toEqual(registered(tinyParent()));
        });

        it('rejects child parts that differ from what the child registered', () => {
            expect(expected(childParts)).toEqual(registered(child));
            expect(expected([routeA])).not.toEqual(registered(child));
        });
    });
});

describe('route config tuples of converted routers', () => {
    // Importing a router pulls in its whole server graph; the first one pays for the transform, so load them all
    // once, under a timeout sized for that, instead of letting whichever case runs first time out.
    beforeAll(async () => {
        for (const m of CONVERTED_API_MODULES) await m.load();
    }, 120_000);

    it('registers at least one module', () => {
        expect(CONVERTED_API_MODULES.length).toBeGreaterThan(0);
    });

    describe.each(CONVERTED_API_MODULES.map((m) => [m.file, m] as const))('%s', (_file, mod) => {
        it('lists exactly the routes the router registered, in registration order', async () => {
            const { app, configs } = await mod.load();
            const seen = registered(app);
            expect(seen.length).toBeGreaterThan(0);
            expect(expected(configs)).toEqual(seen);
        });

        it('lists exactly what Hono dispatches, in registration order', async () => {
            const { app, configs } = await mod.load();
            expect(dispatched(app).length).toBeGreaterThan(0);
            expect(expectedDispatch(configs)).toEqual(dispatched(app));
        });

        it('lists each route and each mount once', async () => {
            const { configs } = await mod.load();
            expect(new Set(configs).size).toBe(configs.length);
        });

        it('mounts every child with the parts that child registered', async () => {
            const { configs } = await mod.load();
            for (const mount of mountsIn(configs)) {
                expect(expected(mount.parts)).toEqual(registered(mount.router));
            }
        });
    });

    it('exercises at least one mounted child, or the mount checks above are vacuous', async () => {
        const loaded = await Promise.all(CONVERTED_API_MODULES.map((m) => m.load()));
        expect(loaded.flatMap((m) => mountsIn(m.configs)).length).toBeGreaterThan(0);
    });

    it('registers every router file that derives its client type from a tuple', () => {
        const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../server/api');
        const repoRoot = path.resolve(apiDir, '../..');
        const found: string[] = [];
        const walk = (dir: string) => {
            for (const name of readdirSync(dir)) {
                const full = path.join(dir, name);
                if (statSync(full).isDirectory()) walk(full);
                else if (name.endsWith('.ts') && /^export const \w+(RouteConfigs|RouteParts) = \[/m.test(readFileSync(full, 'utf8'))) {
                    found.push(path.relative(repoRoot, full).split(path.sep).join('/'));
                }
            }
        };
        walk(apiDir);
        // Positive control: the scan finds files at all, so an empty list cannot pass for "all registered".
        expect(found.length).toBeGreaterThan(0);
        expect(CONVERTED_API_MODULES.map((m) => m.file).sort()).toEqual(found.sort());
    });
});
