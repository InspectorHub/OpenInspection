/**
 * The agent-terms gate reads routers from source. Routers are written two ways, as a chain
 * (`createApiRouter().openapi(a, …).route('/', b)`) and as plain statements
 * (`const app = createApiRouter(); app.openapi(a, …); app.route('/', b);`), and the reader has to give the same
 * answer for both: a router converted from one to the other must not change what the gate examines.
 *
 * Everything here runs over literal fixtures, never over the tree, so each case can state what it expects
 * and a negative control can break exactly one thing. The companion spec
 * (`agent-terms-classification.spec.ts`) is the check over the real tree against the running application.
 */
import { describe, it, expect } from 'vitest';
import {
    collectAgentRoutes,
    evaluate,
    run,
    // @ts-expect-error — a build script, deliberately untyped and loaded natively.
} from '../../../scripts/check-agent-terms-classification.mjs';

type Files = Record<string, string>;
const reader = (files: Files) => (path: string) => files[path] ?? null;

const REASON = 'a reason long enough to be a reason';

const ROUTES = `
import { createRoute } from '@hono/zod-openapi';
const listRoute = createRoute(withMcpMetadata({ method: 'get', path: '/referrals' }, {}));
const noticeRoute = createRoute({ method: 'delete', path: '/notices/{id}' });
const prefsRoute = createRoute({ method: 'get', path: '/notification-preferences' });
const exportRoute = createRoute({ method: 'post', path: '/account/export' });
const inviteRoute = createRoute({ method: 'post', path: '/invite' });
`;

const ENTRY = `
import agentRoutes from './api/agent';
import identityRoutes from './api/identity';
import agentsRoutes from './api/agents';
const app = new OpenAPIHono()
  .route('/api/agent', agentRoutes)
  .route('/api/identities', identityRoutes)
  .route('/api/agents', agentsRoutes);
`;

/** The same four agent routes plus a staff route, once as chains and once as statements. */
const CHAIN: Files = {
    'server/index.ts': ENTRY,
    'server/api/agent.ts': `${ROUTES}
import prefRoutes from './agent/prefs';
const agentRoutes = createApiRouter()
  .route('/', prefRoutes)
  .openapi(listRoute, async () => {})
  .openapi(noticeRoute, async () => {});
export default agentRoutes;
`,
    'server/api/agent/prefs.ts': `${ROUTES}
const prefRoutes = createApiRouter().openapi(prefsRoute, async () => {});
export default prefRoutes;
`,
    'server/api/identity.ts': `${ROUTES}
const identityRoutes = createApiRouter().openapi(exportRoute, async () => {});
export default identityRoutes;
`,
    'server/api/agents.ts': `${ROUTES}
export const agentsRoutes = createApiRouter().openapi(inviteRoute, async () => {});
`,
};

const STATEMENTS: Files = {
    'server/index.ts': ENTRY,
    'server/api/agent.ts': `${ROUTES}
import prefRoutes, { prefRouteConfigs } from './agent/prefs';
const app = createApiRouter();
app.route('/', prefRoutes);
app.openapi(listRoute, async () => {});
app.openapi(noticeRoute, async () => {});
export const agentRouteParts = [mounted('/', prefRoutes, prefRouteConfigs), listRoute, noticeRoute] as const;
export default app;
`,
    'server/api/agent/prefs.ts': `${ROUTES}
const app = createApiRouter();
app.openapi(prefsRoute, async () => {});
export const prefRouteConfigs = [prefsRoute] as const;
export default app;
`,
    'server/api/identity.ts': `${ROUTES}
export const identityRoutes = createApiRouter();
identityRoutes.openapi(exportRoute, async () => {});
export default identityRoutes;
`,
    'server/api/agents.ts': `${ROUTES}
export const agentsRoutes = createApiRouter();
agentsRoutes.openapi(inviteRoute, async () => {});
`,
};

const EXPECTED = [
    '/api/agent/notices/:id',
    '/api/agent/notification-preferences',
    '/api/agent/referrals',
    '/api/identities/account/export',
];

const TABLE_SOURCE = (paths: string[]) =>
    `export const AGENT_ROUTE_BINDING = [${paths.map((path) => `{ path: '${path}', requiresBinding: true, why: '${REASON}' }`).join(', ')}];`;

describe('the reader gives one answer for a router written either way', () => {
    it('finds the same routes in the chain form and the statement form', () => {
        const chain = collectAgentRoutes({ readFile: reader(CHAIN) });
        const statements = collectAgentRoutes({ readFile: reader(STATEMENTS) });
        expect(chain.problems).toEqual([]);
        expect(statements.problems).toEqual([]);
        expect(chain.paths).toEqual(EXPECTED);
        expect(statements.paths).toEqual(EXPECTED);
        expect(statements.mountsExamined).toBe(chain.mountsExamined);
        expect(statements.mountsSeen).toBe(chain.mountsSeen);
        expect(statements.skipped).toEqual(chain.skipped);
    });

    it('reads a router that mixes both forms', () => {
        const mixed: Files = {
            ...CHAIN,
            'server/api/agent.ts': `${ROUTES}
import prefRoutes from './agent/prefs';
const agentRoutes = createApiRouter().route('/', prefRoutes).openapi(listRoute, async () => {});
agentRoutes.openapi(noticeRoute, async () => {});
export default agentRoutes;
`,
        };
        const result = collectAgentRoutes({ readFile: reader(mixed) });
        expect(result.problems).toEqual([]);
        expect(result.paths).toEqual(EXPECTED);
    });

    it('reads a child mounted at a prefix, in both forms', () => {
        const chain: Files = {
            ...CHAIN,
            'server/api/agent.ts': CHAIN['server/api/agent.ts']!.replace("'/', prefRoutes", "'/preferences', prefRoutes"),
        };
        const statements: Files = {
            ...STATEMENTS,
            'server/api/agent.ts': STATEMENTS['server/api/agent.ts']!.replace("app.route('/', prefRoutes)", "app.route('/preferences', prefRoutes)"),
        };
        const expected = EXPECTED.map((p: string) => p.replace('/api/agent/notification-preferences', '/api/agent/preferences/notification-preferences')).sort();
        expect(collectAgentRoutes({ readFile: reader(chain) }).paths).toEqual(expected);
        expect(collectAgentRoutes({ readFile: reader(statements) }).paths).toEqual(expected);
    });
});

describe('negative controls: the reader still says no', () => {
    it('keeps the plural staff mount out, in both forms', () => {
        for (const files of [CHAIN, STATEMENTS]) {
            const result = collectAgentRoutes({ readFile: reader(files) });
            expect(result.skipped).toEqual(['/api/agents → agentsRoutes']);
            expect(result.paths.filter((p: string) => p.startsWith('/api/agents'))).toEqual([]);
            expect(result.paths).not.toContain('/api/agents/invite');
        }
    });

    it('flags a statement-form route that has no row, and names it', () => {
        const result = collectAgentRoutes({ readFile: reader(STATEMENTS) });
        const rows = EXPECTED.filter((p) => p !== '/api/agent/notices/:id').map((path) => ({ path, requiresBinding: true, why: REASON }));
        const judged = evaluate(result.paths, rows);
        expect(judged.flagged).toBe(1);
        expect(judged.findings[0][1]).toEqual(['/api/agent/notices/:id']);
        // The positive control: with every row present the same universe is clean.
        const all = EXPECTED.map((path) => ({ path, requiresBinding: true, why: REASON }));
        expect(evaluate(result.paths, all).flagged).toBe(0);
    });

    it('reads a registration it cannot follow as a problem, never as nothing', () => {
        const inline: Files = {
            ...STATEMENTS,
            'server/api/identity.ts': `const app = createApiRouter();
app.openapi(createRoute({ method: 'post', path: '/account/export' }), async () => {});
export default app;
`,
        };
        const nested: Files = {
            ...STATEMENTS,
            'server/api/identity.ts': `${ROUTES}
const app = createApiRouter();
function register() { app.openapi(exportRoute, async () => {}); }
register();
export default app;
`,
        };
        const assigned: Files = {
            ...STATEMENTS,
            'server/api/identity.ts': `${ROUTES}
const app = createApiRouter();
const wired = app.openapi(exportRoute, async () => {});
export default app;
`,
        };
        for (const files of [inline, nested, assigned]) {
            expect(collectAgentRoutes({ readFile: reader(files) }).problems.length).toBeGreaterThan(0);
        }
    });

    it('reports a route constant with no readable path', () => {
        const missing: Files = {
            ...STATEMENTS,
            'server/api/identity.ts': `const app = createApiRouter();
app.openapi(exportRoute, async () => {});
export default app;
`,
        };
        expect(collectAgentRoutes({ readFile: reader(missing) }).problems).toEqual([
            'server/api/identity.ts: route constant exportRoute has no readable path',
        ]);
    });
});

describe('the command line keeps its guarantees over statement-form routers', () => {
    const capture = () => {
        const lines: string[] = [];
        return { lines, io: { log: (m: string) => lines.push(m), error: (m: string) => lines.push(m) } };
    };

    it('prints both numbers on a pass', () => {
        const { lines, io } = capture();
        const code = run(reader({ ...STATEMENTS, 'server/lib/middleware/agent-terms-routes.ts': TABLE_SOURCE(EXPECTED) }), io);
        expect(code).toBe(0);
        expect(lines[0]).toContain('examined 4 agent-reachable route(s)');
        expect(lines[0]).toContain('flagged 0');
        expect(lines[0]).toContain('mounts descended 2 of 3 declared');
    });

    it('prints both numbers on a failure, and exits non-zero for an unclassified route', () => {
        const { lines, io } = capture();
        const code = run(reader({ ...STATEMENTS, 'server/lib/middleware/agent-terms-routes.ts': TABLE_SOURCE(EXPECTED.slice(1)) }), io);
        expect(code).toBe(1);
        expect(lines[0]).toContain('examined 4 agent-reachable route(s)');
        expect(lines[0]).toContain('flagged 1');
        expect(lines.join('\n')).toContain(EXPECTED[0]);
    });

    it('fails hard when no route is examined at all', () => {
        // Every agent router exists but registers nothing the reader can see: the case a statement-form
        // router would have been in, had the reader known only the chain.
        const blind: Files = {
            ...STATEMENTS,
            'server/api/agent.ts': 'const app = createApiRouter();\nexport default app;\n',
            'server/api/agent/prefs.ts': 'const app = createApiRouter();\nexport default app;\n',
            'server/api/identity.ts': 'const app = createApiRouter();\nexport default app;\n',
            'server/lib/middleware/agent-terms-routes.ts': TABLE_SOURCE(EXPECTED),
        };
        const { lines, io } = capture();
        expect(run(reader(blind), io)).toBe(1);
        expect(lines[0]).toContain('examined 0 agent-reachable route(s)');
        expect(lines.join('\n')).toContain('ZERO routes examined');
    });

    it('fails when the mounted routers cannot be resolved', () => {
        const { lines, io } = capture();
        const noAgent: Files = { 'server/index.ts': ENTRY, 'server/lib/middleware/agent-terms-routes.ts': TABLE_SOURCE(EXPECTED) };
        expect(run(reader(noAgent), io)).toBe(1);
        expect(lines.join('\n')).toContain('ZERO routes examined');
    });
});
