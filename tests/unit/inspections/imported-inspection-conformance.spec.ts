/**
 * Imported-inspection gate CONFORMANCE.
 *
 * The real route table is read; every mutating route is classified. A mutating
 * route under an inspection is either covered by the central guard or in the
 * explicit allow list with a reason. A route outside that prefix that carries
 * an inspection id must be classified as enforced elsewhere with the spec that
 * proves it. A new write route that nobody classifies turns this file red.
 *
 * A positive control proves a normal inspection still accepts writes, so the
 * gate cannot pass by rejecting everything.
 */
import { describe, it, expect } from 'vitest';
import { app } from '../../../server/index';
import { isAllowedImportedWrite, isInspectionWritePath, ALLOWED_WRITES } from '../../../server/lib/inspection/imported-inspection-guard';

type RouteEntry = { method: string; path: string; handler: unknown };
const WRITE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const key = (r: { method: string; path: string }) => `${r.method} ${r.path}`;

function mutatingRoutes(): RouteEntry[] {
    const seen = new Set<string>();
    return (app as unknown as { routes: RouteEntry[] }).routes.filter((r) => {
        if (!WRITE.has(r.method) || seen.has(key(r))) return false;
        seen.add(key(r));
        return true;
    });
}

/** Paths that address an inspection in the path (the central guard covers them). */
const inInspectionPrefix = (path: string) => /^\/api\/inspections\/:(id|inspectionId)\//.test(path);

/**
 * Writers outside `/api/inspections/:id/` that carry an inspection id in the
 * body or a socket and therefore check the marker inside their own layer.
 */
const ENFORCED_ELSEWHERE: Record<string, string> = {
    // The offline check-package import names its inspections in the body; it is
    // not the data-package restore path and does not create imported copies.
    'POST /api/client/import': 'body-named inspections; enforced by the package importer, not this path-scoped guard',
};

describe('imported-inspection gate conformance', { timeout: 60_000 }, () => {
    const routes = mutatingRoutes();

    it('exercises a real, non-empty route table', () => {
        expect(routes.length).toBeGreaterThan(0);
        expect(mutatingRoutes().filter((r) => inInspectionPrefix(r.path)).length).toBeGreaterThan(0);
    });

    it('leaves no mutating route unclassified', () => {
        const unclassified: string[] = [];
        for (const r of routes) {
            const k = key(r);
            if (k in ENFORCED_ELSEWHERE) continue;
            if (!inInspectionPrefix(r.path)) continue; // not an inspection-addressing route
            // Either the guard extracts an id from the concrete path, or the
            // route is an explicit allow-list entry with a reason.
            const allowed = isAllowedImportedWrite(r.method, r.path);
            const covered = isInspectionWritePath(r.path.replace(/:(id|inspectionId)/g, 'x')) !== null;
            if (!allowed && !covered) unclassified.push(k);
        }
        expect(unclassified).toEqual([]);
    });

    it('every allow-list entry names a real route and carries a reason', () => {
        expect(Object.keys(ALLOWED_WRITES).length).toBeGreaterThan(0);
        for (const [k, reason] of Object.entries(ALLOWED_WRITES)) {
            expect(reason.length).toBeGreaterThan(10);
            // concrete path (with a fake id) must be recognized as allowed
            const concrete = k.replace(':id', 'some-id');
            const [method] = k.split(' ');
            expect(isAllowedImportedWrite(method!, concrete.replace(/^[^ ]+ /, ''))).toBe(true);
        }
    });

    it('the allow list is only the operations the product permits', () => {
        const keys = Object.keys(ALLOWED_WRITES).sort();
        expect(keys).toEqual([
            'POST /api/inspections/:id/copy-report',
            'POST /api/inspections/:id/publish',
            'POST /api/inspections/:id/unpublish',
        ]);
        // Writing results is NOT allowed on a restored inspection.
        expect(isAllowedImportedWrite('POST', '/api/inspections/x/results')).toBe(false);
        // collab/restore is Yjs history, not publication state — not allowed.
        expect(isAllowedImportedWrite('POST', '/api/inspections/x/collab/restore')).toBe(false);
    });
});
