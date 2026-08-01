/**
 * Unit tests for the agent-route prefix gate.
 *
 * `loginPathFor` (app/lib/session.server.ts) decides which sign-in page a
 * session ends on by reading the request path — anything under `agent-` goes to
 * `/agent-login`. That derivation removed a per-caller argument a new route
 * could forget, but it only MOVED the forgetting: a page mounted inside
 * `agent-layout` without the prefix silently gets the STAFF login, which has no
 * account for an agent and, in SaaS, bounces on to the portal's sign-in.
 *
 * No unit test would catch that, because the session specs pin the routes that
 * exist today. This gate is the part that cannot be forgotten — so these specs
 * cover the ways a gate like this fails SILENTLY, not just the happy path.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

let findAgentRouteViolations: (source: string) => string[];

beforeAll(async () => {
    const scriptPath = path.resolve(
        import.meta.dirname ?? path.join(process.cwd()),
        '../../../scripts/check-agent-routes.mjs',
    );
    // @vite-ignore — load the .mjs via native Node import; vitest's transform
    // cannot process this script (esbuild target) and throws a SyntaxError.
    ({ findAgentRouteViolations } = await import(/* @vite-ignore */ pathToFileURL(scriptPath).href));
});

const wrap = (children: string) => `
export default [
  route("login", "routes/login.tsx"),
  route("agent-login", "routes/agent/login.tsx"),
  layout("routes/auth-layout.tsx", [
    route("inspections", "routes/inspections.tsx"),
  ]),
  layout("routes/agent-layout.tsx", [
${children}
  ]),
] satisfies RouteConfig;
`;

describe('findAgentRouteViolations', () => {
    it('passes when every child carries the prefix', () => {
        expect(findAgentRouteViolations(wrap(`
    route("agent-dashboard", "routes/agent/dashboard.tsx"),
    route("agent-settings/profile", "routes/agent/settings-profile.tsx"),
        `))).toEqual([]);
    });

    it('flags a child without the prefix, and says what would go wrong', () => {
        const out = findAgentRouteViolations(wrap(`
    route("agent-dashboard", "routes/agent/dashboard.tsx"),
    route("partner-inspectors", "routes/agent/inspectors.tsx"),
        `));
        expect(out).toHaveLength(1);
        expect(out[0]).toContain('partner-inspectors');
        // The message has to name the consequence, or a reader "fixes" it by
        // adding an exemption.
        expect(out[0]).toContain('STAFF login');
    });

    it('does not look at routes OUTSIDE the agent layout', () => {
        // `/login` and `/inspections` are staff pages and must stay untouched —
        // a gate that flagged them would be renamed or deleted within a week.
        expect(findAgentRouteViolations(wrap(`
    route("agent-dashboard", "routes/agent/dashboard.tsx"),
        `))).toEqual([]);
    });

    it('does not end the block early on a NESTED array', () => {
        // The obvious implementation slices to the first `]`, which would stop
        // inside the nested layout and silently skip everything after it —
        // passing while covering nothing.
        const out = findAgentRouteViolations(`
export default [
  layout("routes/agent-layout.tsx", [
    layout("routes/agent-sub.tsx", [
      route("agent-nested-ok", "routes/agent/a.tsx"),
    ]),
    route("wrong-after-nested", "routes/agent/b.tsx"),
  ]),
] satisfies RouteConfig;
        `);
        expect(out).toHaveLength(1);
        expect(out[0]).toContain('wrong-after-nested');
    });

    it('FAILS LOUDLY when the layout block is missing', () => {
        // Silence is not success. A gate that quietly finds nothing to inspect
        // — because the file was restructured or the layout renamed — prints
        // OK forever while covering nothing.
        const out = findAgentRouteViolations(`export default [ route("login", "x") ] satisfies RouteConfig;`);
        expect(out).toHaveLength(1);
        expect(out[0]).toContain('not found');
    });

    it('FAILS LOUDLY when the layout has no route children', () => {
        expect(findAgentRouteViolations(wrap('    // nothing here yet'))[0])
            .toContain('matching nothing');
    });
});
