/**
 * An agent is a third party, and now signs something that says so — once, for the
 * whole deployment.
 *
 * Round 20 A3 opened this: an agent is a `users` row with `tenant_id IS NULL`, a
 * global identity with no company behind it, so neither a tenant's Privacy URL nor
 * a company's contract governs them, and the signup path used to accept
 * `termsAccepted: undefined` and write NULL.
 *
 * ── What round 29 changed, and why this file was rewritten ───────────────────
 * The first implementation put the document in `tenant_legal_versions`, reasoning
 * that in standalone the operator IS the single tenant. That reasoning worked in
 * standalone and broke SaaS outright: the lookup went through
 * `profile.fixedTenantId`, which is null there, so every SaaS agent signup was
 * refused for a reason having nothing to do with the caller.
 *
 * Counsel round 29 settled the underlying question — ONE acceptance covers the
 * whole deployment, so the ledger is `agent × terms version` and never
 * `agent × company × terms version`. That makes the document tenant-less, which
 * removes the mode branch rather than parameterising it. `deployment_legal_versions`
 * is the store; `agent_terms` has been REMOVED from the tenant enum so nobody
 * re-wires the old way and is right to think it was intended.
 *
 * ── What the acceptance has to carry, and why a URL is not it ────────────────
 * The old shape held `termsUrl` and `privacyUrl`. A URL records where the text
 * WAS, not what it SAID — the page behind it can be edited, and then the
 * acceptance points at something the signer never read. Version plus content hash
 * is the only pair that survives the text changing.
 *
 * ── What ships versus what goes live ────────────────────────────────────────
 * The store, the acceptance shape, the fail-closed signup and the publish path
 * ship. GOING LIVE gates on counsel-approved text (round 24c, and round 29 says
 * the current draft is not it), which is why nothing below asserts any particular
 * wording — and why `agent-terms:publish` refuses a body that still carries
 * placeholders.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { users, deploymentLegalVersions } from '../../../server/lib/db/schema';
import { DeploymentLegalService } from '../../../server/services/deployment-legal.service';
import { signup } from '../../../server/services/agent/signup';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
vi.mock('../../../server/services/agent/auto-link', () => ({
    autoLinkSameEmail: vi.fn().mockResolvedValue(undefined),
}));

const HASH64 = /^[0-9a-f]{64}$/;

describe('agent terms belong to the deployment, not to a tenant', () => {
    let db: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fix = createTestDb();
        db = fix.db;
        await setupSchema(fix.sqlite);
        const { drizzle } = await import('drizzle-orm/d1');
        (drizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    });

    it('publishes a version and reads it back with a hash of the body', async () => {
        const svc = new DeploymentLegalService(db as never);
        const out = await svc.recordPublish({ doc: 'agent_terms', version: '2026-08-01', body: 'agent text' });
        expect(out.created).toBe(true);
        expect(out.contentHash).toMatch(HASH64);

        const stored = await svc.latest('agent_terms');
        expect(stored?.version).toBe('2026-08-01');
        expect(stored?.bodySnapshot).toBe('agent text');
        // The row retains the BODY, not just a pointer. A version nobody can show
        // a signer again is not evidence of anything.
        expect(stored?.contentHash).toBe(out.contentHash);
    });

    it('no tenant is involved — which is the whole point, and what SaaS needed', async () => {
        const svc = new DeploymentLegalService(db as never);
        await svc.recordPublish({ doc: 'agent_terms', version: '2026-08-01', body: 'agent text' });
        const rows = await db.select().from(deploymentLegalVersions).all();
        expect(rows).toHaveLength(1);
        // No tenant column to be null OR wrong. The previous model keyed this on
        // `profile.fixedTenantId`, which is null in SaaS, so the lookup returned
        // nothing and signup refused every SaaS caller.
        expect(Object.keys(rows[0]!)).not.toContain('tenantId');
    });

    it('republishing the same words returns the existing version instead of a second row', async () => {
        const svc = new DeploymentLegalService(db as never);
        const first = await svc.recordPublish({ doc: 'agent_terms', version: '2026-08-01', body: 'same words' });
        const again = await svc.recordPublish({ doc: 'agent_terms', version: '2026-08-09', body: 'same words' });
        expect(again.created).toBe(false);
        expect(again.version).toBe(first.version);
        expect(await db.select().from(deploymentLegalVersions).all()).toHaveLength(1);
    });

    it('a published version cannot come to mean different words', async () => {
        const svc = new DeploymentLegalService(db as never);
        await svc.recordPublish({ doc: 'agent_terms', version: '2026-08-01', body: 'original' });
        await expect(svc.recordPublish({
            doc: 'agent_terms', version: '2026-08-01', body: 'quietly edited',
        })).rejects.toThrow(/already published with different text/i);
        expect(await db.select().from(deploymentLegalVersions).all()).toHaveLength(1);
    });

    it('latest is the most recently published, not the highest version string', async () => {
        const svc = new DeploymentLegalService(db as never);
        await svc.recordPublish({ doc: 'agent_terms', version: '2026-09-01', body: 'first published' });
        await new Promise((r) => setTimeout(r, 2));
        await svc.recordPublish({ doc: 'agent_terms', version: '2026-08-01', body: 'published second' });
        // A correction published after a forward-dated version is the one in force.
        // Sorting by the version STRING would silently serve the withdrawn text.
        expect((await svc.latest('agent_terms'))?.bodySnapshot).toBe('published second');
    });

    it('returns null when the deployment has published nothing', async () => {
        const svc = new DeploymentLegalService(db as never);
        expect(await svc.latest('agent_terms')).toBeNull();
    });
});

describe('agent signup is fail-closed on acceptance', () => {
    let db: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fix = createTestDb();
        db = fix.db;
        await setupSchema(fix.sqlite);
        const { drizzle } = await import('drizzle-orm/d1');
        (drizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    });

    const args = {
        email: 'agent@example.com',
        password: 'correct horse battery staple',
        name: 'A Agent',
    };

    it('an agent account cannot be created without a recorded acceptance', async () => {
        await expect(signup({} as D1Database, args)).rejects.toThrow(/terms/i);
        // FAIL CLOSED means no row, not a row with a null acceptance. An account
        // that exists without one is the state this task removes.
        expect(await db.select().from(users).all()).toHaveLength(0);
    });

    it('an acceptance with no content hash is refused, not stored', async () => {
        await expect(signup({} as D1Database, {
            ...args,
            termsAccepted: { at: new Date().toISOString(), version: '2026-08-17' } as never,
        })).rejects.toThrow(/hash/i);
        expect(await db.select().from(users).all()).toHaveLength(0);
    });

    it('the acceptance carries a version and a content hash, not a URL', async () => {
        await signup({} as D1Database, {
            ...args,
            termsAccepted: {
                at: new Date().toISOString(),
                version: '2026-08-17',
                contentHash: 'a'.repeat(64),
            },
        });
        const row = await db.select().from(users).where(eq(users.email, args.email)).get();
        expect(row?.termsAccepted).toMatchObject({
            version: expect.any(String),
            contentHash: expect.stringMatching(HASH64),
        });
        // A URL records where the text WAS, not what it SAID. The page behind it
        // can be edited, and the acceptance would then point at something the
        // signer never read.
        expect(JSON.stringify(row?.termsAccepted)).not.toMatch(/https?:/);
    });

    it('a rejected signup leaves no half-made account for the retry to collide with', async () => {
        // The refusal happens before the insert, not after. A caller who fixes
        // their payload and retries must not hit a 409 from their own first
        // attempt.
        await expect(signup({} as D1Database, args)).rejects.toThrow();
        await signup({} as D1Database, {
            ...args,
            termsAccepted: { at: new Date().toISOString(), version: '2026-08-17', contentHash: 'b'.repeat(64) },
        });
        expect(await db.select().from(users).all()).toHaveLength(1);
    });
});
