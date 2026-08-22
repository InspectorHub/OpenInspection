/**
 * What an agent accepted, and when — every time, not just the last time.
 *
 * `users.terms_accepted` is one JSON slot. Accepting a new version overwrites the
 * previous one, so the deployment could state which text an agent is bound by
 * TODAY and nothing at all about what they agreed to before — which is precisely
 * the moment an earlier acceptance matters, because the only reason the slot
 * changed is that the words changed.
 *
 * `agent_terms_acceptances` is the append-only record beside it. The slot stays,
 * demoted to a projection of the newest row: the request-path gate reads it on
 * every agent request and a per-request join is the wrong price for a fast
 * "is this agent bound by the text in force".
 *
 * Both properties are asserted here, and the second one is not decoration.
 * Breaking the projection would stop an agent who HAS accepted at the door, and
 * a suite that only checked the new table would not notice.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { users, agentTermsAcceptances } from '../../../server/lib/db/schema';
import { DeploymentLegalService } from '../../../server/services/deployment-legal.service';
import {
    recordAgentTermsAcceptance,
    agentTermsHistory,
} from '../../../server/services/agent/terms-acceptance';
import { agentTermsRoutes } from '../../../server/api/agent/terms';
import { AppError } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

const AGENT = '00000000-0000-0000-0000-0000000000a1';
const OTHER_AGENT = '00000000-0000-0000-0000-0000000000a2';

describe('an agent acceptance is appended, never overwritten', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: ReturnType<typeof createTestDb>['sqlite'];

    beforeEach(async () => {
        const fix = createTestDb();
        db = fix.db;
        sqlite = fix.sqlite;
        await setupSchema(sqlite);
        for (const [id, email] of [[AGENT, 'a1@example.com'], [OTHER_AGENT, 'a2@example.com']]) {
            await db.insert(users).values({
                id, tenantId: null, email, name: 'Agent', role: 'agent',
                createdAt: new Date(), termsAccepted: null, passwordHash: 'x',
            } as never);
        }
    });

    afterEach(() => sqlite.close());

    /** Publish `body` as `version` and accept it as `userId`. */
    async function publishAndAccept(version: string, body: string, userId = AGENT) {
        const svc = new DeploymentLegalService(db as never);
        const out = await svc.recordPublish({ doc: 'agent_terms', version, body });
        return recordAgentTermsAcceptance(db as never, {
            userId,
            shownContentHash: out.contentHash,
        });
    }

    it('keeps every acceptance, so an earlier version survives a later one', async () => {
        await publishAndAccept('2026-08-01', 'first');
        await publishAndAccept('2026-08-02', 'second');

        const rows = await db.select().from(agentTermsAcceptances)
            .where(eq(agentTermsAcceptances.userId, AGENT)).all();
        expect(rows.map((r) => r.version).sort()).toEqual(['2026-08-01', '2026-08-02']);
        // Two DIFFERENT hashes. Same-version rows with one hash would mean the
        // row copied the version string and not the words, which is the whole
        // fact the table exists to hold.
        expect(new Set(rows.map((r) => r.contentHash)).size).toBe(2);
    });

    // The projection is what the gate reads on every request. Breaking it would
    // let an agent who HAS accepted be stopped at the door, so it is asserted,
    // not assumed.
    it('still leaves users.terms_accepted holding the newest acceptance', async () => {
        await publishAndAccept('2026-08-01', 'first');
        await publishAndAccept('2026-08-02', 'second');

        const [u] = await db.select({ t: users.termsAccepted }).from(users)
            .where(eq(users.id, AGENT)).all();
        expect(u?.t?.version).toBe('2026-08-02');
    });

    it('stamps the row and the projection with the SAME instant', async () => {
        await publishAndAccept('2026-08-01', 'first');
        const [row] = await db.select().from(agentTermsAcceptances)
            .where(eq(agentTermsAcceptances.userId, AGENT)).all();
        const [u] = await db.select({ t: users.termsAccepted }).from(users)
            .where(eq(users.id, AGENT)).all();
        // One clock read, not two. Two would let the ledger and its projection
        // disagree by a millisecond about an event that happened once.
        expect(row?.acceptedAt?.toISOString()).toBe(u?.t?.at);
    });

    it('records the request evidence it was given, and NULL where it was not', async () => {
        const svc = new DeploymentLegalService(db as never);
        const out = await svc.recordPublish({ doc: 'agent_terms', version: '2026-08-01', body: 'first' });
        await recordAgentTermsAcceptance(db as never, {
            userId: AGENT, shownContentHash: out.contentHash, ip: '203.0.113.7', country: 'US',
        });
        await recordAgentTermsAcceptance(db as never, {
            userId: OTHER_AGENT, shownContentHash: out.contentHash,
        });

        const [withEvidence] = await db.select().from(agentTermsAcceptances)
            .where(eq(agentTermsAcceptances.userId, AGENT)).all();
        expect(withEvidence?.ip).toBe('203.0.113.7');
        expect(withEvidence?.country).toBe('US');
        const [without] = await db.select().from(agentTermsAcceptances)
            .where(eq(agentTermsAcceptances.userId, OTHER_AGENT)).all();
        expect(without?.ip).toBeNull();
        expect(without?.country).toBeNull();
    });

    it('writes no row when there is nothing published to accept', async () => {
        await expect(recordAgentTermsAcceptance(db as never, {
            userId: AGENT, shownContentHash: 'f'.repeat(64),
        })).rejects.toThrow();
        expect(await db.select().from(agentTermsAcceptances).all()).toHaveLength(0);
    });

    it('writes no row when the page rendered text no longer in force', async () => {
        const svc = new DeploymentLegalService(db as never);
        await svc.recordPublish({ doc: 'agent_terms', version: '2026-08-01', body: 'first' });
        await expect(recordAgentTermsAcceptance(db as never, {
            userId: AGENT, shownContentHash: 'a'.repeat(64),
        })).rejects.toThrow();
        expect(await db.select().from(agentTermsAcceptances).all()).toHaveLength(0);
    });

    describe('reading an agent their own history', () => {
        it('returns the acceptances newest first', async () => {
            await publishAndAccept('2026-08-01', 'first');
            await publishAndAccept('2026-08-02', 'second');

            const history = await agentTermsHistory(db as never, AGENT);
            expect(history.map((h) => h.version)).toEqual(['2026-08-02', '2026-08-01']);
        });

        // The positive control. A suite whose every assertion is "unavailable"
        // passes against an implementation that never finds a body at all.
        it('says the text IS available while the version is still published', async () => {
            await publishAndAccept('2026-08-01', 'first');
            const [row] = await agentTermsHistory(db as never, AGENT);
            expect(row?.bodyAvailable).toBe(true);
            expect(row?.body).toBe('first');
        });

        it('says the text is unavailable when the operator removed that version', async () => {
            await publishAndAccept('2026-08-01', 'first');
            await publishAndAccept('2026-08-02', 'second');
            // The operator deleted the older published version. The acceptance
            // stays — it happened — but its words are no longer archived.
            await db.delete(schema.deploymentLegalVersions)
                .where(eq(schema.deploymentLegalVersions.version, '2026-08-01')).run();

            const history = await agentTermsHistory(db as never, AGENT);
            const older = history.find((h) => h.version === '2026-08-01');
            expect(older?.bodyAvailable).toBe(false);
            // NOT the current text. Substituting it would show the agent
            // something they never agreed to.
            expect(older?.body).toBeNull();
            // And the surviving one is still readable — the failure above is
            // about one row, not about the reader giving up.
            expect(history.find((h) => h.version === '2026-08-02')?.body).toBe('second');
        });

        // An agent must never see another agent's acceptances. The gate is on
        // the route, but the service is what a future caller will reach for.
        it('returns nothing for a different user', async () => {
            await publishAndAccept('2026-08-01', 'first');
            expect(await agentTermsHistory(db as never, OTHER_AGENT)).toEqual([]);
        });
    });
});

/**
 * The route in front of it.
 *
 * Driven over real HTTP rather than by calling the handler, because the two
 * things worth pinning here are both about the request: that the user id comes
 * from the SESSION and from nowhere else, and that a caller with no session gets
 * nothing. A handler invoked directly with a hand-made context proves neither.
 */
describe('GET /api/agent/terms/history', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: ReturnType<typeof createTestDb>['sqlite'];

    beforeEach(async () => {
        const fix = createTestDb();
        db = fix.db;
        sqlite = fix.sqlite;
        await setupSchema(sqlite);
        const { drizzle } = await import('drizzle-orm/d1');
        (drizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
        for (const [id, email] of [[AGENT, 'a1@example.com'], [OTHER_AGENT, 'a2@example.com']]) {
            await db.insert(users).values({
                id, tenantId: null, email, name: 'Agent', role: 'agent',
                createdAt: new Date(), termsAccepted: null, passwordHash: 'x',
            } as never);
        }
        const svc = new DeploymentLegalService(db as never);
        const out = await svc.recordPublish({ doc: 'agent_terms', version: '2026-08-01', body: 'first' });
        await recordAgentTermsAcceptance(db as never, { userId: AGENT, shownContentHash: out.contentHash });
    });

    afterEach(() => sqlite.close());

    /** `signedInAs` null stands in for a request the JWT middleware classified as nobody. */
    function buildApp(signedInAs: string | null) {
        const app = new OpenAPIHono<HonoConfig>();
        // The same envelope server/index.ts installs. Without it an AppError
        // surfaces as a 500 and the 401 assertion below would pass for the
        // wrong reason.
        app.onError((err, c) => (err instanceof AppError
            ? c.json({ success: false, error: { code: err.code, message: err.message } }, err.status)
            : c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500)));
        app.use('*', async (c, next) => {
            c.env = { DB: {} } as unknown as HonoConfig['Bindings'];
            if (signedInAs) c.set('agentUserId', signedInAs);
            await next();
        });
        app.route('/api/agent', agentTermsRoutes);
        return app;
    }

    it('answers the signed-in agent with their own acceptances', async () => {
        const res = await buildApp(AGENT).request('https://x.test/api/agent/terms/history');
        expect(res.status).toBe(200);
        const body = await res.json() as { data: { version: string; bodyAvailable: boolean }[] };
        expect(body.data.map((r) => r.version)).toEqual(['2026-08-01']);
        expect(body.data[0]?.bodyAvailable).toBe(true);
    });

    // The positive control above is what makes this one mean anything: an
    // endpoint that always returned [] would satisfy this assertion alone.
    it('answers an agent with no acceptances with an empty list, not an error', async () => {
        const res = await buildApp(OTHER_AGENT).request('https://x.test/api/agent/terms/history');
        expect(res.status).toBe(200);
        expect((await res.json() as { data: unknown[] }).data).toEqual([]);
    });

    it('ignores a userId supplied by the CALLER', async () => {
        const res = await buildApp(OTHER_AGENT)
            .request(`https://x.test/api/agent/terms/history?userId=${AGENT}`);
        expect(res.status).toBe(200);
        // The query string named an agent with an acceptance. The session did not.
        expect((await res.json() as { data: unknown[] }).data).toEqual([]);
    });

    it('refuses a request with no agent session', async () => {
        const res = await buildApp(null).request('https://x.test/api/agent/terms/history');
        expect(res.status).toBe(401);
    });
});
