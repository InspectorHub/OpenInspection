/**
 * Default-deny on the API surface, through the REAL application and middleware
 * chain (no auth mocking): in-memory SQLite, real JWT keyring, both deployment
 * modes. Pins four hardening rules:
 *
 *  1. a request with no session is refused on every protected /api/ path, in
 *     standalone as well as multi-tenant mode (the tenant resolving from
 *     configuration must not turn a missing session into access);
 *  2. an agent principal never receives staff context on staff endpoints;
 *  3. an inspector cannot change the assignee/date or delete someone else's
 *     inspection without `scheduleOthers`;
 *  4. the company-level external access policy is owner/manager only.
 *
 * Every denial is paired with an allowed control.
 */
import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { app } from '../../../server/index';
import { makeExecutionContext } from '../helpers/exec-ctx';
import * as schema from '../../../server/lib/db/schema';
import { buildKeyring, signJwt } from '../../../server/lib/jwt-keyring';
import {
    createHarness, mintAgentToken, TENANT_ID, OWNER_ID, INSPECTOR_ID, type Harness, type HarnessMode,
} from '../helpers/tenant-email-harness';
import { isUnauthenticatedPath } from '../../../server/lib/auth/public-paths';
import { ANONYMOUS_API_ALLOW, AGENT_API_ALLOW, matchesRule } from '../../../server/lib/auth/api-access-policy';

const MANAGER_ID = '22222222-0000-4000-8000-000000000003';
const OTHER_INSPECTOR_ID = '22222222-0000-4000-8000-000000000004';
const AGENT_ID = '22222222-0000-4000-8000-0000000000a1';
const THEIRS = '44444444-0000-4000-8000-000000000001';
const MINE = '44444444-0000-4000-8000-000000000002';
const UUID = '00000000-0000-4000-8000-0000000000aa';

type Actor = 'anon' | 'agent' | 'inspector' | 'manager' | 'owner';

async function seed(h: Harness) {
    const now = new Date();
    await h.db.insert(schema.users).values([
        { id: MANAGER_ID, tenantId: TENANT_ID, email: 'mgr@x.test', passwordHash: 'h', role: 'manager', name: 'Mona', createdAt: now },
        { id: OTHER_INSPECTOR_ID, tenantId: TENANT_ID, email: 'ines@x.test', passwordHash: 'h', role: 'inspector', name: 'Ines', createdAt: now },
    ]);
    const base = {
        tenantId: TENANT_ID, propertyAddress: '99 Secret Lane', date: '2026-06-01', status: 'requested',
        paymentStatus: 'unpaid', price: 123456, agreementRequired: false, paymentRequired: false,
        reportStatus: 'in_progress', createdAt: now,
    };
    await h.db.insert(schema.inspections).values([
        { ...base, id: THEIRS, inspectorId: OTHER_INSPECTOR_ID },
        { ...base, id: MINE, inspectorId: INSPECTOR_ID },
    ] as never);
    await h.db.insert(schema.inspectionInspectors).values([
        { inspectionId: THEIRS, userId: OTHER_INSPECTOR_ID, tenantId: TENANT_ID, role: 'lead', createdAt: now },
        { inspectionId: MINE, userId: INSPECTOR_ID, tenantId: TENANT_ID, role: 'lead', createdAt: now },
    ]);
}

async function tokenFor(h: Harness, actor: Actor): Promise<string | null> {
    if (actor === 'anon') return null;
    if (actor === 'agent') return mintAgentToken(h.env, AGENT_ID);
    const keyring = await buildKeyring(h.env as unknown as Record<string, string | undefined>);
    const sub = { owner: OWNER_ID, manager: MANAGER_ID, inspector: INSPECTOR_ID }[actor];
    const now = Math.floor(Date.now() / 1000);
    return signJwt({ sub, 'custom:tenantId': TENANT_ID, 'custom:userRole': actor, iat: now, exp: now + 3600 }, keyring);
}

async function setup(mode: HarnessMode) {
    const h = await createHarness(mode);
    await seed(h);
    // The delete cascade sweeps R2; an empty bucket is all these specs need.
    (h.env as unknown as Record<string, unknown>).PHOTOS = { list: async () => ({ objects: [], truncated: false }), delete: async () => undefined };
    const tokens = new Map<Actor, string | null>();
    for (const a of ['anon', 'agent', 'inspector', 'manager', 'owner'] as const) tokens.set(a, await tokenFor(h, a));
    const call = async (actor: Actor, method: string, path: string, body?: unknown) => {
        const headers: Record<string, string> = {};
        const t = tokens.get(actor);
        if (t) headers.authorization = `Bearer ${t}`;
        const init: RequestInit = { method, headers };
        if (body !== undefined) { headers['content-type'] = 'application/json'; init.body = JSON.stringify(body); }
        const exec = makeExecutionContext({ label: 'deny' });
        const res = await app.request(path, init, h.env, exec.ctx);
        await exec.settle();
        return res;
    };
    return { h, call };
}

const fill = (p: string) => p.replace(/:([A-Za-z]+)(\{[^}]*\})?/g, (_m, n: string) => (/^id$|inspectionId/i.test(n) ? THEIRS : UUID));

function mountedApiRoutes(): Array<{ method: string; path: string }> {
    const routes = (app as unknown as { routes: Array<{ method: string; path: string }> }).routes;
    const seen = new Set<string>();
    const out: Array<{ method: string; path: string }> = [];
    for (const r of routes) {
        if (r.method === 'ALL' || r.path.includes('*') || !r.path.startsWith('/api/')) continue;
        const k = `${r.method} ${r.path}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(r);
    }
    return out;
}

describe('allow-lists are reviewed', () => {
    it('every entry carries a reason and matches a real mounted route', () => {
        const paths = mountedApiRoutes().map((r) => fill(r.path));
        for (const rule of [...ANONYMOUS_API_ALLOW, ...AGENT_API_ALLOW]) {
            expect(rule.why.length, String(rule.match)).toBeGreaterThan(10);
            expect(paths.some((p) => matchesRule([rule], p)), `stale allow-list entry ${String(rule.match)}`).toBe(true);
        }
    });
});

describe.each(['standalone', 'saas'] as const)('anonymous matrix (%s)', (mode) => {
    it('every mounted /api/ route is public-by-design (with a reason) or answers 401 without a session', { timeout: 120_000 }, async () => {
        const { h, call } = await setup(mode);
        try {
            const open: string[] = [];
            let denied = 0;
            let allowed = 0;
            for (const r of mountedApiRoutes()) {
                const path = fill(r.path);
                const publicByDesign = isUnauthenticatedPath(path) || matchesRule(ANONYMOUS_API_ALLOW, path);
                if (publicByDesign) { allowed += 1; continue; }
                if (/\/ws$|presence|collab/.test(path)) continue;
                const res = await call('anon', r.method, path, r.method === 'GET' ? undefined : {});
                if (res.status === 401) denied += 1;
                else open.push(`${res.status} ${r.method} ${r.path}`);
            }
            // Both numbers are printed: a vacuous matrix (0 denied) must not read as green.
            expect(denied, `denied=${denied} allowed=${allowed}`).toBeGreaterThan(300);
            expect(allowed).toBeGreaterThan(30);
            expect(open, open.join('\n')).toEqual([]);
        } finally { h.close(); }
    });
});

describe('standalone: no session means no access (defect 1)', () => {
    it('anonymous PATCH of company preferences is refused and persists nothing', async () => {
        const { h, call } = await setup('standalone');
        try {
            const res = await call('anon', 'PATCH', '/api/tenant/inspection-prefs', { agentRepairAccess: 'off' });
            expect(res.status).toBe(401);
            const row = await h.db.select({ p: schema.tenantConfigs.inspectionPrefs }).from(schema.tenantConfigs).where(eq(schema.tenantConfigs.tenantId, TENANT_ID)).get();
            expect(JSON.stringify(row?.p ?? null)).not.toContain('"off"');
            // control: the owner's identical request is applied
            expect((await call('owner', 'PATCH', '/api/tenant/inspection-prefs', { agentRepairAccess: 'off' })).status).toBe(200);
        } finally { h.close(); }
    });

    it.each([
        ['GET', `/api/inspections/${THEIRS}/report-data`],
        ['GET', '/api/analytics/growth'],
        ['GET', '/api/usage/summary'],
        ['GET', '/api/billing/summary'],
        ['GET', '/api/integrations/status'],
        ['POST', '/api/tenant/inspection-prefs/report-link-expiry'],
    ])('anonymous %s %s is refused; the owner is not', async (method, path) => {
        const { h, call } = await setup('standalone');
        try {
            expect((await call('anon', method, path, method === 'GET' ? undefined : { ttl: 'never' })).status).toBe(401);
            expect((await call('owner', method, path, method === 'GET' ? undefined : { ttl: 'never' })).status).not.toBe(401);
        } finally { h.close(); }
    });

    it('public surfaces still answer anonymously (positive controls)', async () => {
        const { h, call } = await setup('standalone');
        try {
            expect((await call('anon', 'GET', '/api/auth/setup-status')).status).toBe(200);
            expect((await call('anon', 'GET', '/status')).status).toBe(200);
            expect((await call('anon', 'GET', '/api/public/services')).status).toBe(200);
        } finally { h.close(); }
    });
});

describe.each(['standalone', 'saas'] as const)('agent principal on staff endpoints (%s) (defect 2)', (mode) => {
    it.each([
        `/api/inspections/${THEIRS}`,
        `/api/inspections/${THEIRS}/results`,
        `/api/inspections/${THEIRS}/versions`,
        `/api/inspections/${THEIRS}/documents`,
        '/api/agent/leaderboard',
        '/api/tenant/inspection-prefs',
    ])('agent GET %s is refused', async (path) => {
        const { h, call } = await setup(mode);
        try {
            const res = await call('agent', 'GET', path);
            expect([401, 403]).toContain(res.status);
            expect(await res.text()).not.toContain('99 Secret Lane');
        } finally { h.close(); }
    });

    it('agent PATCH of company preferences is refused', async () => {
        const { h, call } = await setup(mode);
        try {
            expect((await call('agent', 'PATCH', '/api/tenant/inspection-prefs', { agentRepairAccess: 'off' })).status).toBe(403);
        } finally { h.close(); }
    });

    it('agent portal and session endpoints still work (positive controls)', async () => {
        const { h, call } = await setup(mode);
        try {
            expect((await call('agent', 'GET', '/api/agent/referrals')).status).toBe(200);
            expect((await call('agent', 'GET', '/api/session/context')).status).toBe(200);
        } finally { h.close(); }
    });

    it('the leaderboard is owner/manager only; the inspector is refused', async () => {
        const { h, call } = await setup(mode);
        try {
            expect((await call('owner', 'GET', '/api/agent/leaderboard')).status).toBe(200);
            expect((await call('manager', 'GET', '/api/agent/leaderboard')).status).toBe(200);
            expect((await call('inspector', 'GET', '/api/agent/leaderboard')).status).toBe(403);
        } finally { h.close(); }
    });
});

describe('inspector, roster and scheduleOthers on PATCH/DELETE /api/inspections/:id (defect 3)', () => {
    const rowOf = (h: Harness, id: string) => h.db.select().from(schema.inspections).where(eq(schema.inspections.id, id)).get();
    const makeHelper = (h: Harness, inspectionId: string) => h.db.insert(schema.inspectionInspectors).values({
        inspectionId, userId: INSPECTOR_ID, tenantId: TENANT_ID, role: 'helper', createdAt: new Date(),
    });

    it('a non-roster inspector can neither reassign, move nor delete another inspectors inspection', async () => {
        const { h, call } = await setup('standalone');
        try {
            expect((await call('inspector', 'PATCH', `/api/inspections/${THEIRS}`, { inspectorId: INSPECTOR_ID })).status).toBe(403);
            expect((await call('inspector', 'PATCH', `/api/inspections/${THEIRS}`, { date: '2030-01-01' })).status).toBe(403);
            // a date-only stored value is NOT unchanged when a time is submitted
            expect((await call('inspector', 'PATCH', `/api/inspections/${THEIRS}`, { date: '2026-06-01T09:00:00.000Z' })).status).toBe(403);
            expect((await call('inspector', 'DELETE', `/api/inspections/${THEIRS}`)).status).toBe(403);
            expect((await rowOf(h, THEIRS))?.inspectorId).toBe(OTHER_INSPECTOR_ID);
            expect(String((await rowOf(h, THEIRS))?.date)).toContain('2026-06-01');
            expect(await rowOf(h, THEIRS)).toBeTruthy();
        } finally { h.close(); }
    });

    it('a roster inspector may change the date of their own inspection, but not reassign it', async () => {
        const { h, call } = await setup('standalone');
        try {
            expect((await call('inspector', 'PATCH', `/api/inspections/${MINE}`, { date: '2030-01-01' })).status).toBe(200);
            expect(String((await rowOf(h, MINE))?.date)).toContain('2030-01-01');
            expect((await call('inspector', 'PATCH', `/api/inspections/${MINE}`, { inspectorId: OTHER_INSPECTOR_ID })).status).toBe(403);
            expect((await rowOf(h, MINE))?.inspectorId).toBe(INSPECTOR_ID);
            // a helper counts as roster for the date
            await makeHelper(h, THEIRS);
            expect((await call('inspector', 'PATCH', `/api/inspections/${THEIRS}`, { date: '2031-02-02' })).status).toBe(200);
            expect((await call('inspector', 'PATCH', `/api/inspections/${THEIRS}`, { inspectorId: INSPECTOR_ID })).status).toBe(403);
        } finally { h.close(); }
    });

    it('PATCH /:id/schedule follows the same own-date rule', async () => {
        const { h, call } = await setup('standalone');
        try {
            const start = Date.UTC(2030, 0, 2, 15, 0, 0);
            expect((await call('inspector', 'PATCH', `/api/inspections/${MINE}/schedule`, { scheduledStartMs: start })).status).toBe(200);
            expect((await call('inspector', 'PATCH', `/api/inspections/${MINE}/schedule`, { scheduledStartMs: start, leadInspectorId: OTHER_INSPECTOR_ID })).status).toBe(403);
            expect((await call('inspector', 'PATCH', `/api/inspections/${THEIRS}/schedule`, { scheduledStartMs: start })).status).toBe(403);
            expect((await call('manager', 'PATCH', `/api/inspections/${THEIRS}/schedule`, { scheduledStartMs: start })).status).toBe(200);
        } finally { h.close(); }
    });

    it('delete: the lead, owner, manager and scheduleOthers may; a helper may not', async () => {
        const { h, call } = await setup('standalone');
        try {
            await makeHelper(h, THEIRS);
            expect((await call('inspector', 'DELETE', `/api/inspections/${THEIRS}`)).status).toBe(403);
            expect(await rowOf(h, THEIRS)).toBeTruthy();
            expect((await call('inspector', 'DELETE', `/api/inspections/${MINE}`)).status).toBe(200);
            expect(await rowOf(h, MINE)).toBeFalsy();
            await h.db.update(schema.users).set({ permissionOverrides: { scheduleOthers: true } as never }).where(eq(schema.users.id, INSPECTOR_ID));
            expect((await call('inspector', 'DELETE', `/api/inspections/${THEIRS}`)).status).toBe(200);
        } finally { h.close(); }
    });

    it('controls: other fields, repeating stored values, owner and manager', async () => {
        const { h, call } = await setup('standalone');
        try {
            expect((await call('inspector', 'PATCH', `/api/inspections/${THEIRS}`, { propertyAddress: '1 Updated Street' })).status).toBe(200);
            expect((await call('inspector', 'PATCH', `/api/inspections/${THEIRS}`, { inspectorId: OTHER_INSPECTOR_ID, date: '2026-06-01' })).status).toBe(200);
            expect((await call('owner', 'PATCH', `/api/inspections/${THEIRS}`, { inspectorId: INSPECTOR_ID })).status).toBe(200);
            expect((await call('manager', 'PATCH', `/api/inspections/${MINE}`, { date: '2032-03-03' })).status).toBe(200);
            await h.db.update(schema.users).set({ permissionOverrides: { scheduleOthers: true } as never }).where(eq(schema.users.id, INSPECTOR_ID));
            expect((await call('inspector', 'PATCH', `/api/inspections/${THEIRS}`, { inspectorId: OTHER_INSPECTOR_ID })).status).toBe(200);
            expect((await call('manager', 'DELETE', `/api/inspections/${MINE}`)).status).toBe(200);
        } finally { h.close(); }
    });
});

describe('review follow-ups: allow-list and agent surface', () => {
    it('anonymous callers cannot spend the Places quota or activate TOTP', async () => {
        const { h, call } = await setup('standalone');
        try {
            expect((await call('anon', 'GET', '/api/places/autocomplete?q=ab&session=12345678')).status).toBe(401);
            expect((await call('anon', 'POST', '/api/auth/2fa/verify', {})).status).toBe(401);
            // controls: the real sign-in second step and the booking geocoder stay public
            expect((await call('anon', 'POST', '/api/auth/login/2fa', {})).status).not.toBe(401);
            expect((await call('anon', 'GET', '/api/public/geocode')).status).not.toBe(401);
        } finally { h.close(); }
    });

    it('an agent keeps /api/auth/me and logout but not the rest of /api/auth/', async () => {
        const { h, call } = await setup('standalone');
        try {
            expect((await call('agent', 'GET', '/api/auth/me')).status).toBe(200);
            expect((await call('agent', 'POST', '/api/auth/logout')).status).toBe(200);
            expect((await call('agent', 'POST', '/api/auth/2fa/setup', {})).status).toBe(403);
            expect((await call('agent', 'POST', '/api/auth/checklist/dismiss', {})).status).toBe(403);
        } finally { h.close(); }
    });
});

describe('company external-access policy is owner/manager only (defect 4)', () => {
    const prefs = (h: Harness) => h.db.select({ p: schema.tenantConfigs.inspectionPrefs }).from(schema.tenantConfigs).where(eq(schema.tenantConfigs.tenantId, TENANT_ID)).get();

    it('an inspector cannot change agentRepairAccess or reportLinkTtl, or mass-expire links', async () => {
        for (const mode of ['standalone', 'saas'] as const) {
            const { h, call } = await setup(mode);
            try {
                expect((await call('inspector', 'PATCH', '/api/tenant/inspection-prefs', { agentRepairAccess: 'off' })).status).toBe(403);
                expect((await call('inspector', 'PATCH', '/api/tenant/inspection-prefs', { reportLinkTtl: { count: 1, unit: 'days' } })).status).toBe(403);
                expect((await call('inspector', 'POST', '/api/tenant/inspection-prefs/report-link-expiry', { ttl: 'never' })).status).toBe(403);
                expect(JSON.stringify((await prefs(h))?.p ?? null)).not.toContain('"off"');
            } finally { h.close(); }
        }
    });

    it('controls: an inspector still saves editor preferences; owner and manager change the policy', async () => {
        const { h, call } = await setup('standalone');
        try {
            expect((await call('manager', 'PATCH', '/api/tenant/inspection-prefs', { agentRepairAccess: 'read' })).status).toBe(200);
            expect((await call('inspector', 'PATCH', '/api/tenant/inspection-prefs', { autoAdvance: 'off' })).status).toBe(200);
            // An editor-pref save must not reset the policy (a defaulted patch field did exactly that).
            const after = await (await call('inspector', 'GET', '/api/tenant/inspection-prefs')).json() as { agentRepairAccess: string; autoAdvance: string };
            expect(after.agentRepairAccess).toBe('read');
            expect(after.autoAdvance).toBe('off');
            expect((await call('owner', 'PATCH', '/api/tenant/inspection-prefs', { reportLinkTtl: { count: 1, unit: 'years' } })).status).toBe(200);
            expect((await call('manager', 'POST', '/api/tenant/inspection-prefs/report-link-expiry', { ttl: 'never' })).status).toBe(200);
        } finally { h.close(); }
    });
});
