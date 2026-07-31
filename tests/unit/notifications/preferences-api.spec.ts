/**
 * The reader's own preferences, over HTTP.
 *
 * Two things are worth asserting here that no lower layer can: that the SUBJECT
 * comes from the session rather than the request, and that the route refuses
 * what the send boundary would refuse. The second is not redundancy — the
 * boundary makes the guarantee TRUE, and this makes the screen HONEST. A page
 * that accepts a change and then ignores it is worse than one that says no.
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
import notificationPreferenceRoutes from '../../../server/api/notification-preferences';

const TENANT = 't-prefs-api';
const ME = 'u-me';
const SOMEONE_ELSE = 'u-other';
/**
 * The ONLY staff notification that is not required. That is a fact about the
 * vocabulary, not about this test: everything else staff receive is either
 * account access, a money record, or office dispatch that an individual is not
 * allowed to silence for themselves (§2.5). If a second one ever appears, this
 * constant is where a reader will look to find out.
 */
const MUTABLE = 'concierge-inspector-review';

let db: BetterSQLite3Database<typeof schema>;
let sqlite: { close: () => void };

function buildApp(role = 'owner') {
    const app = new OpenAPIHono<HonoConfig>();
    app.onError((err, c) => {
        if (err instanceof AppError) {
            return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status);
        }
        return c.json({ success: false, error: { code: 'internal', message: String(err) } }, 500);
    });
    app.use('*', async (c, next) => {
        c.set('tenantId', TENANT);
        c.set('userRole', role);
        c.set('user', { sub: ME, role, tenantId: TENANT } as never);
        await next();
    });
    app.route('/api', notificationPreferenceRoutes);
    return app;
}

const put = (app: OpenAPIHono<HonoConfig>, body: unknown) =>
    app.request('/api/notification-preferences', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    }, { DB: {} });

beforeEach(async () => {
    const fx = createTestDb();
    db = fx.db as BetterSQLite3Database<typeof schema>;
    sqlite = fx.sqlite;
    await setupSchema(fx.sqlite);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockDrizzle as any).mockReturnValue(db);
});
afterEach(() => sqlite.close());

const rows = () => db.select().from(schema.notificationPreferences).all();

describe('PUT /api/notification-preferences', () => {
    it('writes the mute against the SIGNED-IN reader, whatever the body says', async () => {
        // The body carries what changed, never who. Accepting a subject id here
        // would let anyone silence anyone.
        const res = await put(buildApp(), {
            classId: MUTABLE, channel: 'email', enabled: false,
            subjectId: SOMEONE_ELSE, userId: SOMEONE_ELSE,
        });
        expect(res.status).toBe(200);

        const saved = await rows();
        expect(saved).toHaveLength(1);
        expect(saved[0].subjectId).toBe(ME);
        expect(saved[0].subjectKind).toBe('user');
    });

    it('refuses a notification that is always sent', async () => {
        const res = await put(buildApp(), { classId: 'password-reset', channel: 'email', enabled: false });
        expect(res.status).toBe(400);
        expect(await rows()).toHaveLength(0);
    });

    it('refuses a class it has never heard of', async () => {
        const res = await put(buildApp(), { classId: 'not.a.real.class', channel: 'email', enabled: false });
        expect(res.status).toBe(400);
        expect(await rows()).toHaveLength(0);
    });

    it('refuses a class this reader is never addressed by', async () => {
        // A staff member cannot mute an agent's referral notification. The row
        // would be invisible to them and unclearable — nothing renders it.
        const res = await put(buildApp('owner'), { classId: 'agent-new-referral', channel: 'email', enabled: false });
        expect(res.status).toBe(400);
        expect(await rows()).toHaveLength(0);
    });

    it('refuses a channel the notification never uses', async () => {
        // review-request has no in-app form. Storing this would put a row behind
        // a control the screen renders as an em dash.
        const res = await put(buildApp(), { classId: 'review-request', channel: 'in_app', enabled: false });
        expect(res.status).toBe(400);
        expect(await rows()).toHaveLength(0);
    });

    it('DELETES the row when switched back on, rather than storing the default', async () => {
        // §3.2 — never store a row that merely restates the default; it makes
        // the table grow with the user base instead of with the decisions.
        const app = buildApp();
        await put(app, { classId: MUTABLE, channel: 'email', enabled: false });
        expect(await rows()).toHaveLength(1);

        await put(app, { classId: MUTABLE, channel: 'email', enabled: true });
        expect(await rows()).toHaveLength(0);
    });

    it('is idempotent — muting twice leaves one row, not two', async () => {
        const app = buildApp();
        await put(app, { classId: MUTABLE, channel: 'email', enabled: false });
        await put(app, { classId: MUTABLE, channel: 'email', enabled: false });
        expect(await rows()).toHaveLength(1);
    });
});

describe('GET /api/notification-preferences', () => {
    const get = (app: OpenAPIHono<HonoConfig>) =>
        app.request('/api/notification-preferences', {}, { DB: {} });

    it('reports a mute this reader holds as off', async () => {
        const app = buildApp();
        await put(app, { classId: MUTABLE, channel: 'email', enabled: false });

        const body = await (await get(app)).json() as {
            data: { youChoose: Array<{ id: string; channels: Record<string, string> }> };
        };
        expect(body.data.youChoose.find((r) => r.id === MUTABLE)!.channels.email).toBe('off');
    });

    it('does not show one reader another reader’s choices', async () => {
        await db.insert(schema.notificationPreferences).values({
            id: 'np-theirs', tenantId: TENANT, subjectKind: 'user', subjectId: SOMEONE_ELSE,
            classId: MUTABLE, channel: 'email', enabled: false,
            createdAt: new Date(), updatedAt: new Date(),
        } as never);

        const body = await (await get(buildApp())).json() as {
            data: { youChoose: Array<{ id: string; channels: Record<string, string> }> };
        };
        expect(body.data.youChoose.find((r) => r.id === MUTABLE)!.channels.email).toBe('on');
    });

    it('shows the STAFF list, and never another audience’s', async () => {
        // This route is the staff surface, full stop. An agent's JWT carries no
        // tenant at all, so the old "read the role and pick an audience" line
        // could only ever have been answering for a caller that cannot reach
        // here — and would have written rows under an undefined tenant.
        const body = await (await get(buildApp())).json() as {
            data: { alwaysSent: Array<{ id: string }>; youChoose: Array<{ id: string }> };
        };
        expect(body.data.alwaysSent.map((r) => r.id)).toContain('workspace-invitation');
        expect(body.data.youChoose.map((r) => r.id)).toEqual([MUTABLE]);
        expect(body.data.youChoose.map((r) => r.id)).not.toContain('agent-new-referral');
    });
});
