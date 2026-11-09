/**
 * Agent signup writes the acceptance ledger, atomically with the account.
 *
 * Before this, signup stored the acceptance only in the `users.terms_accepted`
 * projection. The ledger row (`agent_terms_acceptances`) was written only by the
 * later "accept again" flow, so a freshly registered agent had an accepted
 * projection and an empty history. These tests pin: the row exists with the
 * version, hash and request evidence shown at signup; it is written in the same
 * batch as the user (a failed ledger write leaves no account); and the history
 * endpoint answers with it.
 *
 * Accounts that signed up before this change have NO ledger row and are not
 * backfilled here: a historical acceptance record is never created or rebuilt
 * after the fact. They keep passing the gate through their projection.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { users, agentTermsAcceptances } from '../../../server/lib/db/schema';
import { DeploymentLegalService } from '../../../server/services/deployment-legal.service';
import { signup } from '../../../server/services/agent/signup';
import { agentTermsHistory, agentTermsStatus } from '../../../server/services/agent/terms-acceptance';
import { agentTermsRoutes } from '../../../server/api/agent/terms';
import { AppError } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';
import { withBatch, lazyD1 } from '../helpers/d1-binding';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

const testD1 = lazyD1();
const ARGS = { email: 'new.agent@example.com', password: 'correct horse battery staple', name: 'New Agent' };

describe('agent signup records the acceptance in the ledger', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: ReturnType<typeof createTestDb>['sqlite'];
    let contentHash: string;

    beforeEach(async () => {
        const fix = createTestDb();
        db = fix.db;
        sqlite = fix.sqlite;
        await setupSchema(sqlite);
        const { drizzle } = await import('drizzle-orm/d1');
        vi.mocked(drizzle).mockReturnValue(withBatch(db, sqlite) as never);
        const out = await new DeploymentLegalService(db as never)
            .recordPublish({ doc: 'agent_terms', version: '2026-08-01', body: 'the agent terms' });
        contentHash = out.contentHash;
    });

    afterEach(() => sqlite.close());

    const accepted = () => ({
        at: new Date().toISOString(), version: '2026-08-01', contentHash,
        ip: '203.0.113.7', country: 'US',
    });

    it('writes one ledger row naming the version, hash, user and request evidence', async () => {
        const { userId } = await signup({} as D1Database, { ...ARGS, termsAccepted: accepted() });
        const rows = await db.select().from(agentTermsAcceptances).all();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            userId, doc: 'agent_terms', version: '2026-08-01', contentHash,
            ip: '203.0.113.7', country: 'US',
        });
    });

    it('stamps the ledger row and the projection with the same instant', async () => {
        const { userId } = await signup({} as D1Database, { ...ARGS, termsAccepted: accepted() });
        const [row] = await db.select().from(agentTermsAcceptances).all();
        const [u] = await db.select({ t: users.termsAccepted }).from(users).where(eq(users.id, userId)).all();
        expect(row?.acceptedAt.toISOString()).toBe(u?.t?.at);
    });

    it('stores NULL evidence where the request carried none', async () => {
        await signup({} as D1Database, {
            ...ARGS, termsAccepted: { at: new Date().toISOString(), version: '2026-08-01', contentHash },
        });
        const [row] = await db.select().from(agentTermsAcceptances).all();
        expect(row?.ip).toBeNull();
        expect(row?.country).toBeNull();
    });

    it('a failed ledger write leaves no account, so no accepted user lacks a record', async () => {
        sqlite.exec(`CREATE TRIGGER fail_ledger BEFORE INSERT ON agent_terms_acceptances
            BEGIN SELECT RAISE(ABORT, 'ledger down'); END;`);
        await expect(signup({} as D1Database, { ...ARGS, termsAccepted: accepted() })).rejects.toThrow();
        expect(await db.select().from(users).all()).toHaveLength(0);
        expect(await db.select().from(agentTermsAcceptances).all()).toHaveLength(0);
    });

    it('a repeat with the same email is a conflict and adds no second row', async () => {
        await signup({} as D1Database, { ...ARGS, termsAccepted: accepted() });
        await expect(signup({} as D1Database, { ...ARGS, termsAccepted: accepted() })).rejects.toThrow(/exists/i);
        expect(await db.select().from(agentTermsAcceptances).all()).toHaveLength(1);
    });

    it('the history read returns the signup acceptance with its archived body', async () => {
        const { userId } = await signup({} as D1Database, { ...ARGS, termsAccepted: accepted() });
        const history = await agentTermsHistory(db as never, userId);
        expect(history).toHaveLength(1);
        expect(history[0]).toMatchObject({ version: '2026-08-01', contentHash, bodyAvailable: true, body: 'the agent terms' });
    });

    it('the gate treats the new account as ACCEPTED', async () => {
        const { userId } = await signup({} as D1Database, { ...ARGS, termsAccepted: accepted() });
        expect((await agentTermsStatus(db as never, userId)).state).toBe('ACCEPTED');
    });

    it('does not create a ledger row for an account that predates the ledger (no backfill)', async () => {
        await db.insert(users).values({
            id: 'legacy-agent', tenantId: null, email: 'legacy@example.com', name: 'Legacy', role: 'agent',
            createdAt: new Date(), passwordHash: 'x',
            termsAccepted: { at: '2026-08-02T00:00:00.000Z', version: '2026-08-01', contentHash },
        } as never);
        await signup({} as D1Database, { ...ARGS, termsAccepted: accepted() });
        expect(await agentTermsHistory(db as never, 'legacy-agent')).toEqual([]);
        // The projection still satisfies the gate: they are not asked again.
        expect((await agentTermsStatus(db as never, 'legacy-agent')).state).toBe('ACCEPTED');
    });
});

describe('GET /api/agent/terms/history after signup', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: ReturnType<typeof createTestDb>['sqlite'];

    beforeEach(async () => {
        const fix = createTestDb();
        db = fix.db;
        sqlite = fix.sqlite;
        await setupSchema(sqlite);
        testD1.use(db);
        const { drizzle } = await import('drizzle-orm/d1');
        vi.mocked(drizzle).mockReturnValue(withBatch(db, sqlite) as never);
    });

    afterEach(() => sqlite.close());

    it('returns the acceptance made at signup, not []', async () => {
        const out = await new DeploymentLegalService(db as never)
            .recordPublish({ doc: 'agent_terms', version: '2026-08-01', body: 'the agent terms' });
        const { userId } = await signup({} as D1Database, {
            ...ARGS, termsAccepted: { at: new Date().toISOString(), version: '2026-08-01', contentHash: out.contentHash },
        });
        const app = new OpenAPIHono<HonoConfig>();
        app.onError((err, c) => (err instanceof AppError
            ? c.json({ success: false, error: { code: err.code, message: err.message } }, err.status)
            : c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500)));
        app.use('*', async (c, next) => {
            c.env = { DB: testD1.binding } as never;
            c.set('agentUserId', userId);
            await next();
        });
        app.route('/api/agent', agentTermsRoutes);
        const res = await app.request('https://x.test/api/agent/terms/history');
        const body = await res.json() as { data: { version: string }[] };
        expect(res.status).toBe(200);
        expect(body.data.map((r) => r.version)).toEqual(['2026-08-01']);
    });
});
