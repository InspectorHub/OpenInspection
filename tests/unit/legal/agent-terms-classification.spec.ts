/**
 * Every agent-reachable endpoint must carry an explicit answer to one question,
 * and the answer must be written down where a reader can find it.
 *
 * The question is the one the gate's own doc comment already states: *does using
 * this require the agent to be bound by the Agent Terms?* The gate is mounted on
 * `*` and keyed on the actor, so a route added next year is behind it by
 * default. That default is the right one — it fails safe — but it also means the
 * decision NOT to gate something is invisible: it looks exactly like a route
 * nobody has thought about yet.
 *
 * ── Why this is a test and not a review checklist ───────────────────────────
 * The exemption list is short, exact, and hand-kept, and a hand-kept list has
 * one failure mode: the route that was never added to it. Prose in a doc comment
 * did not stop that — the tree already carries endpoints that were never
 * classified either way. So the universe is DERIVED here, from the routers the
 * application actually mounts, and compared against the table. A path in the
 * first set and not the second is a build failure, not a default.
 *
 * ── The universe, and why it stops where it does ────────────────────────────
 * `app.routes` is read from the real application, so this cannot drift from what
 * is served. It is narrowed to the three mounts an agent session reaches with
 * its own cookie. Anything under `/api/public` is deliberately NOT here and is
 * NOT "exempt" either: the JWT middleware short-circuits those paths before it
 * classifies anybody, `agentUserId` is never set, and the gate returns on its
 * first line. That is a third answer — outside the reckoning — and
 * `server/api/unsubscribe.ts` says in its own header that it must never be
 * moved into the exempt list. An exemption is a decision and decisions get
 * argued away; being structurally out of reach cannot be.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { EXEMPT_PATHS } from '../../../server/lib/middleware/agent-terms-gate';
import { AGENT_ROUTE_BINDING } from '../../../server/lib/middleware/agent-terms-routes';

const table = AGENT_ROUTE_BINDING;

/**
 * The mounts an authenticated agent session can reach.
 *
 * `server/index.ts` mounts every agent router at `/api/agent`, the self-serve
 * signup router at `/api/agent-signup`, and the account-identity router at
 * `/api/identities` — PLURAL, which is the spelling an exact-match Set cares
 * about and the one two comments in the tree used to get wrong.
 */
const AGENT_MOUNTS = ['/api/agent', '/api/agent-signup', '/api/identities'] as const;

/** `app.routes` also carries middleware, registered under the method `ALL`. */
const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

/**
 * The floor measured when this spec was written. It is asserted rather than
 * remembered so that a reader-side breakage — a mount renamed, `app.routes`
 * changing shape, an import failing quietly — shows up as "this test measured
 * almost nothing" instead of as a clean run over an empty set.
 */
const MINIMUM_AGENT_ROUTES = 20;

let universe: string[] = [];

beforeAll(async () => {
    const { app } = await import('../../../server/index');
    const paths = new Set<string>();
    for (const route of app.routes) {
        if (typeof route.path !== 'string') continue;
        if (!HTTP_METHODS.has(route.method)) continue;
        const reachable = AGENT_MOUNTS.some(
            (mount) => route.path === mount || route.path.startsWith(`${mount}/`),
        );
        if (!reachable) continue;
        paths.add(route.path);
    }
    universe = [...paths].sort();
}, 60_000);

describe('the agent-route classification table', () => {
    it('reads a non-empty universe — zero routes means the reader is broken', () => {
        expect(
            universe.length,
            `read ${universe.length} agent-reachable route(s) from the mounted application; ` +
            'a count at or near zero means this spec is measuring nothing, not that the ' +
            'agent API is empty',
        ).toBeGreaterThanOrEqual(MINIMUM_AGENT_ROUTES);
    });

    it('classifies every agent-reachable path explicitly', () => {
        const classified = new Set(table.map((entry) => entry.path));
        const unclassified = universe.filter((path) => !classified.has(path));

        expect(
            { examined: universe.length, unclassified: unclassified.length, paths: unclassified },
            'every path an agent session can reach must answer, in the table, whether ' +
            'using it requires the agent to be bound by the Agent Terms',
        ).toEqual({ examined: universe.length, unclassified: 0, paths: [] });
    });

    it('names no path the application does not mount', () => {
        // The other direction. An entry for a route that no longer exists is a
        // decision nobody can evaluate, and on an exempt row it is worse than
        // that: a stale string in an exact-match Set is indistinguishable from a
        // live exemption, right up until somebody re-adds the path.
        const mounted = new Set(universe);
        const orphans = table.map((entry) => entry.path).filter((path) => !mounted.has(path));
        expect(
            { entries: table.length, orphans },
            'a row here must name a path the application actually serves',
        ).toEqual({ entries: table.length, orphans: [] });
    });

    it('derives the exempt set from the table rather than repeating it', () => {
        // The property that makes this a derivation and not a second list: the
        // exempt set is exactly the rows that answered no, computed, with no
        // second edit anywhere. If these two ever have to be kept in step by
        // hand, the mechanism is back to the shape it replaced.
        const answeredNo = table.filter((entry) => !entry.requiresBinding).map((entry) => entry.path);
        expect([...EXEMPT_PATHS].sort()).toEqual([...answeredNo].sort());
        expect(EXEMPT_PATHS.size).toBe(answeredNo.length);
    });

    it('gates every row that answered yes', () => {
        // The positive control for the case above. Without it, "the exempt set
        // equals the no rows" is equally satisfied by a derivation that put
        // everything in the set.
        const answeredYes = table.filter((entry) => entry.requiresBinding).map((entry) => entry.path);
        expect(answeredYes.length).toBeGreaterThan(0);
        expect(answeredYes.filter((path) => EXEMPT_PATHS.has(path))).toEqual([]);
    });

    it('lists each path exactly once', () => {
        const seen = new Map<string, number>();
        for (const entry of table) seen.set(entry.path, (seen.get(entry.path) ?? 0) + 1);
        const duplicated = [...seen].filter(([, count]) => count > 1).map(([path]) => path);
        // Two rows for one path is two answers to one question, and the second
        // one wins silently in the derivation above.
        expect(duplicated).toEqual([]);
    });

    it('keeps the five paths that are already exempt exempt', () => {
        // A refactor that silently drops one of these is the worst outcome
        // available here: the gate keeps working, and an agent who wants to
        // leave, or to ask for their own data, is told to sign something first.
        expect([...EXEMPT_PATHS].sort()).toEqual([
            '/api/agent-signup',
            '/api/agent-signup/terms',
            '/api/agent/accept-terms',
            '/api/identities/account/delete',
            '/api/identities/account/export',
        ]);
    });

    it('gives every entry a reason a human wrote', () => {
        const reasonless = table.filter((entry) => !entry.why || entry.why.trim().length < 20);
        expect(
            { entries: table.length, reasonless: reasonless.map((entry) => entry.path) },
            'the table answers a question; an entry with no prose answers nothing',
        ).toEqual({ entries: table.length, reasonless: [] });
    });

    it('never exempts a path that carries a route parameter', () => {
        // The gate matches with `EXEMPT_PATHS.has(c.req.path)` against a
        // CONCRETE request path. A pattern such as `/api/agent/notices/:id` can
        // never equal one, so an exemption written that way compiles, reviews
        // clean and exempts nothing at all — the same silent-no-op shape as the
        // singular `/api/identity/…` spelling that was caught earlier.
        const patterned = table
            .filter((entry) => !entry.requiresBinding)
            .filter((entry) => entry.path.includes(':') || entry.path.includes('*'));
        expect(
            { exempt: table.filter((e) => !e.requiresBinding).length, patterned: patterned.map((e) => e.path) },
            'an exemption must be a literal path, because the match is exact',
        ).toEqual({ exempt: table.filter((e) => !e.requiresBinding).length, patterned: [] });
    });

    it('does not reach into the structurally unreachable public surface', () => {
        // `/api/public/*` is outside the gate's reckoning, not inside its
        // exemption list. If either of these ever fails, something moved a
        // public path inside the gate and the fix is to move it back out.
        expect(universe.filter((path) => path.startsWith('/api/public'))).toEqual([]);
        expect([...EXEMPT_PATHS].filter((path) => path.startsWith('/api/public'))).toEqual([]);
    });
});
