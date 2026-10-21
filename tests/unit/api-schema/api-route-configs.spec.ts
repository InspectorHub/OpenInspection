import { describe, it, expect, beforeAll } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergePath } from 'hono/utils/url';
import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../../../server/lib/openapi-router';
import { legacyMounted, mounted } from '../../../server/lib/api-schema';
import type { Mounted, RoutePart } from '../../../server/lib/api-schema';
import { CONVERTED_API_MODULES, importsApiSchema, needsRegistration } from '../helpers/converted-api-modules';

/**
 * A converted router's `XxxApi` type is derived from its `xxxRouteConfigs` / `xxxRouteParts` tuple, not
 * from the `app.openapi(...)` / `app.route(...)` statements, so the type cannot notice a route that was
 * registered but left out of the tuple, a child router mounted but left out, or a mount at the wrong
 * prefix (each would silently vanish from, or move inside, the typed client). This pins the tuple to what
 * the router really registered, for every module in CONVERTED_API_MODULES:
 *   - the OpenAPI registry (`method path`, the path the library merges for each mount), in order;
 *   - Hono's own route table (`method :path`), in order, which is what actually dispatches;
 *   - for every mounted child, the child router's own registry against the parts it was mounted with.
 *
 * Limits, stated so nobody reads more into a green run than it says:
 *   - The tuple and the registry are compared as `method path` strings only. Two routes that share a method and
 *     a path but differ in schema (a different request body or response) would compare equal, so a tuple that
 *     lists the wrong one of them is not caught here. The chance is remote: it needs two route definitions for the
 *     same operation in one router, which no module does.
 *   - Which module is registered is decided by reading source text (see `needsRegistration`), so a router file
 *     that gets `ApiOf` or `mounted` through a re-export, not a direct import, is invisible to the scan.
 */

type Router = ReturnType<typeof createApiRouter>;
type AnyMounted = Mounted<string, readonly RoutePart[]>;

const isMounted = (part: RoutePart): part is AnyMounted => 'parts' in part;
const isLegacy = (part: RoutePart): part is Extract<RoutePart, { legacy: true }> => 'legacy' in part;

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
    return parts.flatMap((part) => {
        if (isMounted(part)) return expected(part.parts, mergePath(prefix, part.prefix));
        // A legacy mount lists no routes of its own; what it contributes is whatever the child router registered.
        if (isLegacy(part)) {
            return registered(part.router as Router).map((key) => {
                const [method, path] = key.split(' ');
                return `${method} ${mergePath(prefix, mergePath(part.prefix, path ?? '/'))}`;
            });
        }
        return [`${part.method} ${mergePath(prefix, part.path)}`];
    });
}

/**
 * The same list as Hono's route table spells it (`{id}` is `:id`). A legacy mount contributes what the child
 * router dispatches, not what it registered with OpenAPI: a child written as a chain may also carry plain
 * `.get()` / `.post()` routes, which the OpenAPI registry never sees but Hono does dispatch.
 */
function expectedDispatch(parts: readonly RoutePart[], prefix = '/'): string[] {
    return parts.flatMap((part) => {
        if (isMounted(part)) return expectedDispatch(part.parts, mergePath(prefix, part.prefix));
        if (isLegacy(part)) {
            return dispatched(part.router as Router).map((key) => {
                const [method, path] = key.split(' ');
                return `${method} ${mergePath(prefix, mergePath(part.prefix, path ?? '/'))}`;
            });
        }
        return [`${part.method} ${mergePath(prefix, part.path)}`.replace(/\{([^}]+)\}/g, ':$1')];
    });
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

        it('expands a legacy mount into whatever the child registered, and rejects one at the wrong prefix', () => {
            const app = tinyParent();
            const legacy = [routeB, legacyMounted('/x', child), routeA] as const;
            expect(expected(legacy)).toEqual(registered(app));
            expect(expectedDispatch(legacy)).toEqual(dispatched(app));
            expect(expected([routeB, legacyMounted('/y', child), routeA])).not.toEqual(registered(app));
            expect(expected([routeB, routeA])).not.toEqual(registered(app));
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

    it('registers every router file that imports ApiOf or mounted, or exports a tuple by the usual name', () => {
        const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../server/api');
        const repoRoot = path.resolve(apiDir, '../..');
        const found: string[] = [];
        const walk = (dir: string) => {
            for (const name of readdirSync(dir)) {
                const full = path.join(dir, name);
                if (statSync(full).isDirectory()) walk(full);
                else if (name.endsWith('.ts') && needsRegistration(readFileSync(full, 'utf8'))) {
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

describe('the registration scan can say no', () => {
    const unregistered = `import { createApiRouter } from '../lib/openapi-router';
import { type ApiOf, mounted } from '../lib/api-schema';
export const fooRoutesList = [barRoute] as const;
export type FooApi = ApiOf<typeof fooRoutesList>;
`;

    it('flags a file that imports ApiOf under a tuple name the old scan did not know', () => {
        expect(importsApiSchema(unregistered)).toBe(true);
        expect(needsRegistration(unregistered)).toBe(true);
    });

    it('flags the import in each relative form, type-only and multi-line included', () => {
        expect(importsApiSchema(`import type { ApiOf } from '../lib/api-schema';`)).toBe(true);
        expect(importsApiSchema(`import { mounted } from "../../lib/api-schema";`)).toBe(true);
        expect(importsApiSchema(`import {
    mounted,
    type ApiOf,
} from '../lib/api-schema';`)).toBe(true);
        expect(importsApiSchema(`import * as schema from '../lib/api-schema';`)).toBe(true);
    });

    it('flags the by-name tuple even without the import', () => {
        expect(needsRegistration('export const fooRouteConfigs = [a, b] as const;')).toBe(true);
        expect(needsRegistration('export const fooRouteParts = [a, b] as const;')).toBe(true);
    });

    it('does not flag a file that uses neither', () => {
        expect(needsRegistration(`import { createApiRouter } from '../lib/openapi-router';
export default createApiRouter();`)).toBe(false);
        // Importing only the types of a part, not the helpers that derive a client type.
        expect(importsApiSchema(`import type { RoutePart } from '../lib/api-schema';`)).toBe(false);
        // A module with a similar name elsewhere is not the helper module.
        expect(importsApiSchema(`import { mounted } from '../lib/other-api-schema-thing';`)).toBe(false);
    });

    it('finds every registered module through its source (positive control)', () => {
        const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../server/api');
        const repoRoot = path.resolve(apiDir, '../..');
        expect(CONVERTED_API_MODULES.length).toBeGreaterThan(0);
        for (const m of CONVERTED_API_MODULES) {
            const source = readFileSync(path.join(repoRoot, m.file), 'utf8');
            expect(needsRegistration(source), m.file).toBe(true);
        }
    });
});
