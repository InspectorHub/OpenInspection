/**
 * Task 12 (two-layer role model), closes IA-98 — declaration versus enforcement
 * over every capability-guarded route.
 *
 * require-capability.spec.ts proves the MIDDLEWARE decides correctly against a
 * synthetic app; it can never prove a real route wears it — a route missing its
 * guard still returns 200, just with more in it. Enumerating "which routes must
 * wear `financial`" per capability does not scale; inverting it does: every
 * route that DECLARES a capability (x-capability metadata) must MOUNT
 * requireCapability for it, and every route that mounts the guard must declare
 * it. The declared side is greppable documentation; this gate keeps the two
 * from drifting.
 *
 * Two sources, matched by method+path:
 * - DECLARED: the generated OpenAPI document (same walk as
 *   route-metadata.spec.ts) — x-capability survives as a vendor extension.
 *   The registry's route defs do NOT carry `middleware` (zod-openapi keeps
 *   only OpenAPI-relevant keys), which is why the doc alone cannot answer
 *   the enforcement side.
 * - MOUNTED: Hono's own routing table (app.routes), where every middleware is
 *   its own entry and requireCapability stamps `capability` on its closure.
 */
import { describe, it, expect } from 'vitest';
import { app } from '../../../server/index';

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);

/** '{id}' (OpenAPI) → ':id' (Hono) so the two path vocabularies can meet. */
const honoPath = (docPath: string) => docPath.replace(/\{([^}]+)\}/g, ':$1');

interface OperationLike { 'x-capability'?: string;[k: string]: unknown }

function declaredOps(): Map<string, string | undefined> {
    const doc = app.getOpenAPIDocument({ openapi: '3.0.0', info: { version: 'test', title: 't' } });
    const out = new Map<string, string | undefined>();
    for (const [path, methods] of Object.entries(doc.paths ?? {})) {
        for (const [method, op] of Object.entries(methods as Record<string, OperationLike>)) {
            if (!HTTP_METHODS.has(method)) continue;
            out.set(`${method.toUpperCase()} ${honoPath(path)}`, op['x-capability']);
        }
    }
    return out;
}

function mountedGuards(): Map<string, string> {
    const routes = (app as unknown as { routes: Array<{ method: string; path: string; handler: { capability?: string } }> }).routes;
    const out = new Map<string, string>();
    for (const r of routes) {
        if (typeof r.handler === 'function' && typeof r.handler.capability === 'string') {
            out.set(`${r.method.toUpperCase()} ${r.path}`, r.handler.capability);
        }
    }
    return out;
}

describe('authorization surface', { timeout: 30_000 }, () => {
    it('walks real, non-empty route tables', () => {
        // If either walk's shape ever changes, the assertions below could pass
        // VACUOUSLY (no routes → no mismatches). Pin both walks.
        expect(declaredOps().size).toBeGreaterThan(100);
        expect(mountedGuards().size).toBeGreaterThan(0);
    });

    it('every route that declares a capability actually mounts requireCapability for it', () => {
        const mounted = mountedGuards();
        const broken: string[] = [];
        for (const [key, declared] of declaredOps()) {
            if (!declared) continue;
            if (mounted.get(key) !== declared) {
                broken.push(`${key} declares '${declared}' but mounts '${mounted.get(key) ?? 'nothing'}'`);
            }
        }
        expect(broken, broken.join('\n')).toEqual([]);
    });

    it('every route that mounts requireCapability declares the same capability', () => {
        const declared = declaredOps();
        const broken: string[] = [];
        for (const [key, cap] of mountedGuards()) {
            if (!declared.has(key)) {
                broken.push(`${key} mounts '${cap}' but is not in the OpenAPI document`);
            } else if (declared.get(key) !== cap) {
                broken.push(`${key} mounts '${cap}' but declares '${declared.get(key) ?? 'nothing'}'`);
            }
        }
        expect(broken, broken.join('\n')).toEqual([]);
    });
});
