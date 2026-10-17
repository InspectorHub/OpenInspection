import { describe, it, expect } from 'vitest';
import { app } from '../../../server/index';
import { RESERVED_INSPECTION_SEGMENTS } from '../../../server/lib/middleware/inspection-scope';

type R = { method: string; path: string; handler: { inspectionScopeGuard?: boolean } };
const routes = () => (app as unknown as { routes: R[] }).routes;
const covered = /^\/api\/inspections\/:[^/]+(\/|$)/;

describe('inspection scope guard wiring', { timeout: 30_000 }, () => {
    it('registers the guard on both patterns, ahead of every per-inspection handler', () => {
        const all = routes();
        const guards = all.map((r, i) => ({ r, i })).filter(({ r }) => r.handler?.inspectionScopeGuard);
        expect(guards.map(g => g.r.path).sort()).toEqual(['/api/inspections/:id', '/api/inspections/:id/*']);
        const firstGuard = Math.min(...guards.map(g => g.i));
        const handlers = all.map((r, i) => ({ r, i })).filter(({ r }) => covered.test(r.path) && !r.handler?.inspectionScopeGuard);
        expect(handlers.length, `handlers walked: ${handlers.length}`).toBeGreaterThan(50); // a vacuous walk must fail
        const early = handlers.filter(h => h.i < firstGuard).map(h => `${h.r.method} ${h.r.path}`);
        expect(early, early.join('\n')).toEqual([]);
    });

    it('RESERVED_INSPECTION_SEGMENTS equals the static first segments actually routed', () => {
        const statics = new Set<string>();
        for (const r of routes()) {
            const m = /^\/api\/inspections\/([^/:*]+)/.exec(r.path);
            if (m) statics.add(m[1]!);
        }
        expect([...statics].sort(), `routed: ${[...statics]}  reserved: ${[...RESERVED_INSPECTION_SEGMENTS]}`)
            .toEqual([...RESERVED_INSPECTION_SEGMENTS].sort());
    });
});
