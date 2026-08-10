/**
 * A partner agent's preferences, which are PER COMPANY.
 *
 * That is the part worth pinning. An agent account is global and its JWT
 * carries no tenant, so there is no session tenant to scope a row to; what the
 * agent has is one `contacts` row per company that works with them. Everything
 * below follows from that: the company comes from the agent's own bindings
 * (never from the body), a revoked binding stops being a target, and `scope:
 * 'all'` is what makes "I mean everyone" a single action instead of N.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import type { HonoConfig } from '../../../server/types/hono';
import { AppError } from '../../../server/lib/errors';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

// eslint-disable-next-line import/order
import agentNotificationPreferenceRoutes from '../../../server/api/agent/notification-preferences';
import type { Role } from '../../../server/lib/auth/roles';

const AGENT = 'ag1';
const ACME = 't-acme';
const BOLT = 't-bolt';

let db: BetterSQLite3Database<typeof schema>;
let sqlite: { close: () => void };

function buildApp(role: Role = 'agent', sub = AGENT) {
    const app = new OpenAPIHono<HonoConfig>();
    app.onError((err, c) => {
        if (err instanceof AppError) {
            return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status);
        }
        return c.json({ success: false, error: { code: 'internal', message: String(err) } }, 500);
    });
    app.use('*', async (c, next) => {
        // No tenantId — an agent JWT deliberately carries none.
        c.set('userRole', role);
        c.set('user', { sub, role } as never);
        await next();
    });
    app.route('/api/agent', agentNotificationPreferenceRoutes);
    return app;
}

const put = (app: OpenAPIHono<HonoConfig>, body: unknown) =>
    app.request('/api/agent/notification-preferences', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    }, { DB: {} });

const get = (app: OpenAPIHono<HonoConfig>, qs = '') =>
    app.request(`/api/agent/notification-preferences${qs}`, {}, { DB: {} });

beforeEach(async () => {
    const fx = createTestDb();
    db = fx.db as BetterSQLite3Database<typeof schema>;
    sqlite = fx.sqlite;
    await setupSchema(fx.sqlite);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockDrizzle as any).mockReturnValue(db);

    for (const [id, name] of [[ACME, 'Acme Inspections'], [BOLT, 'Bolt Home Services']]) {
        await db.insert(schema.tenants).values({
            id, name, slug: id, status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        } as never);
    }
    await db.insert(schema.users).values({
        id: AGENT, tenantId: null, email: 'jane@realty.com', name: 'Jane',
        role: 'agent', passwordHash: 'H', createdAt: new Date(),
    } as never);
});
afterEach(() => sqlite.close());

/** The per-tenant `contacts` row `autoLinkSameEmail` binds to an agent account. */
async function link(tenantId: string, contactId: string, revokedAt?: Date) {
    await db.insert(schema.contacts).values({
        id: contactId, tenantId, type: 'agent', name: 'Jane', email: 'jane@realty.com',
        agentUserId: AGENT, agentRevokedAt: revokedAt ?? null, createdAt: new Date(),
    } as never);
}

const rows = () => db.select().from(schema.notificationPreferences).all();

describe('GET /api/agent/notification-preferences', () => {
    it('lists the companies this agent works with, by name', async () => {
        await link(ACME, 'c-acme');
        await link(BOLT, 'c-bolt');

        const body = await (await get(buildApp())).json() as {
            data: { companies: Array<{ id: string; name: string }>; selected: string };
        };
        expect(body.data.companies).toEqual([
            { id: ACME, name: 'Acme Inspections' },
            { id: BOLT, name: 'Bolt Home Services' },
        ]);
        expect(body.data.selected).toBe(ACME);
    });

    it('leaves out a company that revoked this agent', async () => {
        // Revocation is stamped, not cleared, so the binding row still exists.
        // Listing it would offer a control over sends the agent no longer gets.
        await link(ACME, 'c-acme');
        await link(BOLT, 'c-bolt', new Date());

        const body = await (await get(buildApp())).json() as { data: { companies: Array<{ id: string }> } };
        expect(body.data.companies.map((x) => x.id)).toEqual([ACME]);
    });

    it('reads one company at a time, and they do not bleed into each other', async () => {
        await link(ACME, 'c-acme');
        await link(BOLT, 'c-bolt');
        const app = buildApp();
        await put(app, { classId: 'agent-new-referral', channel: 'email', enabled: false, companyId: ACME });

        const acme = await (await get(app, `?companyId=${ACME}`)).json() as {
            data: { youChoose: Array<{ id: string; channels: Record<string, string> }> };
        };
        const bolt = await (await get(app, `?companyId=${BOLT}`)).json() as {
            data: { youChoose: Array<{ id: string; channels: Record<string, string> }> };
        };
        expect(acme.data.youChoose.find((r) => r.id === 'agent-new-referral')!.channels.email).toBe('off');
        expect(bolt.data.youChoose.find((r) => r.id === 'agent-new-referral')!.channels.email).toBe('on');
    });

    it('shows the AGENT list — not staff’s, not the client’s', async () => {
        await link(ACME, 'c-acme');
        const body = await (await get(buildApp())).json() as {
            data: { youChoose: Array<{ id: string }>; alwaysSent: Array<{ id: string }> };
        };
        expect(body.data.youChoose.map((r) => r.id)).toContain('agent-new-referral');
        expect(body.data.youChoose.map((r) => r.id)).not.toContain('review-request');
        expect(body.data.alwaysSent.map((r) => r.id)).not.toContain('workspace-invitation');
    });

    it('still answers for an agent no company is bound to', async () => {
        // A new signup, or someone every company revoked. An empty list is a
        // screen with something to say; a 400 on a read is a dead end.
        const body = await (await get(buildApp())).json() as {
            data: { companies: unknown[]; selected: string | null; youChoose: unknown[] };
        };
        expect(body.data.companies).toEqual([]);
        expect(body.data.selected).toBeNull();
        expect(body.data.youChoose.length).toBeGreaterThan(0);
    });
});

describe('PUT /api/agent/notification-preferences', () => {
    it('writes against the agent’s own contact at the named company', async () => {
        await link(ACME, 'c-acme');
        const res = await put(buildApp(), {
            classId: 'agent-new-referral', channel: 'email', enabled: false, companyId: ACME,
        });
        expect(res.status).toBe(200);

        const saved = await rows();
        expect(saved).toHaveLength(1);
        expect(saved[0].tenantId).toBe(ACME);
        expect(saved[0].subjectKind).toBe('contact');
        expect(saved[0].subjectId).toBe('c-acme');
    });

    it('applies to every linked company when the agent says all', async () => {
        await link(ACME, 'c-acme');
        await link(BOLT, 'c-bolt');
        const res = await put(buildApp(), {
            classId: 'agent-new-referral', channel: 'email', enabled: false, scope: 'all',
        });
        expect(await res.json()).toMatchObject({ applied: 2 });
        expect((await rows()).map((r) => r.tenantId).sort()).toEqual([ACME, BOLT]);
    });

    it('refuses a company this agent is not bound to', async () => {
        // The body names a company, never a subject — the contact id is looked
        // up from the agent's own bindings, so this is the whole attack surface
        // and it ends in a 400.
        await link(ACME, 'c-acme');
        const res = await put(buildApp(), {
            classId: 'agent-new-referral', channel: 'email', enabled: false, companyId: BOLT,
        });
        expect(res.status).toBe(400);
        expect(await rows()).toHaveLength(0);
    });

    it('refuses a company that revoked this agent', async () => {
        await link(BOLT, 'c-bolt', new Date());
        const res = await put(buildApp(), {
            classId: 'agent-new-referral', channel: 'email', enabled: false, companyId: BOLT,
        });
        expect(res.status).toBe(400);
        expect(await rows()).toHaveLength(0);
    });

    it('refuses a notification that is always sent', async () => {
        await link(ACME, 'c-acme');
        const res = await put(buildApp(), {
            classId: 'agent-login-link', channel: 'email', enabled: false, companyId: ACME,
        });
        expect(res.status).toBe(400);
        expect(await rows()).toHaveLength(0);
    });

    it('refuses a class this agent is never addressed by', async () => {
        await link(ACME, 'c-acme');
        const res = await put(buildApp(), {
            classId: 'concierge-inspector-review', channel: 'email', enabled: false, companyId: ACME,
        });
        expect(res.status).toBe(400);
        expect(await rows()).toHaveLength(0);
    });

    it('DELETES the row when switched back on, rather than storing the default', async () => {
        await link(ACME, 'c-acme');
        const app = buildApp();
        await put(app, { classId: 'agent-new-referral', channel: 'email', enabled: false, companyId: ACME });
        expect(await rows()).toHaveLength(1);
        await put(app, { classId: 'agent-new-referral', channel: 'email', enabled: true, companyId: ACME });
        expect(await rows()).toHaveLength(0);
    });

    it('STORES the row when invoice-paid is switched ON, because that one defaults to off', async () => {
        // The mirror of the test above, and the reason the rule is phrased as
        // "store only what differs from the default" rather than "delete on
        // enable": here the row is what says yes.
        await link(ACME, 'c-acme');
        const app = buildApp();
        await put(app, { classId: 'agent-invoice-paid', channel: 'email', enabled: true, companyId: ACME });
        const saved = await rows();
        expect(saved).toHaveLength(1);
        expect(saved[0].enabled).toBe(true);

        await put(app, { classId: 'agent-invoice-paid', channel: 'email', enabled: false, companyId: ACME });
        expect(await rows()).toHaveLength(0);
    });

    it('turns away a caller who is not an agent', async () => {
        await link(ACME, 'c-acme');
        const res = await put(buildApp('owner', 'u-staff'), {
            classId: 'agent-new-referral', channel: 'email', enabled: false, companyId: ACME,
        });
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(await rows()).toHaveLength(0);
    });
});
