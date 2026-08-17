/**
 * An agent is a third party, and now signs something that says so.
 *
 * Round 20 A3. An agent is a `users` row with `tenant_id IS NULL` — a global
 * identity with a direct relationship to the operator and no company behind it.
 * So neither a tenant's Privacy URL nor a company's contract governs them, and
 * until now the signup path accepted `termsAccepted: undefined` and wrote NULL.
 *
 * ── What the acceptance has to carry, and why a URL is not it ────────────────
 * The old shape held `termsUrl` and `privacyUrl`. A URL records where the text
 * WAS, not what it SAID — the page behind it can be edited, and then the
 * acceptance points at something the signer never read. Version plus content
 * hash is the only pair that survives the text changing, and it is the same
 * standard every other legal artefact in this repository already meets.
 *
 * ── Scope: the standalone half ───────────────────────────────────────────────
 * Here the counterparty is the OPERATOR, so `tenant_legal_versions` gains
 * `'agent_terms'`. The SaaS half — where the counterparty is the platform and a
 * SaaS agent has no portal identity to hang a consent row on — is a separate
 * plan's, and the plan that owns it changed after this one was written. This
 * spec deliberately asserts nothing about SaaS.
 *
 * ── What ships versus what goes live ────────────────────────────────────────
 * The document type, the acceptance shape and the fail-closed signup ship here.
 * GOING LIVE gates on counsel-approved text (round 24c), which is why nothing
 * below asserts any particular wording.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { users, tenants, tenantLegalVersions } from '../../../server/lib/db/schema';
import { LegalVersionService } from '../../../server/services/legal-version.service';
import { signup } from '../../../server/services/agent/signup';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
vi.mock('../../../server/services/agent/auto-link', () => ({
    autoLinkSameEmail: vi.fn().mockResolvedValue(undefined),
}));

const OPERATOR = '00000000-0000-0000-0000-0000000000d1';
const HASH64 = /^[0-9a-f]{64}$/;

describe('agent_terms as a document type', () => {
    let db: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fix = createTestDb();
        db = fix.db;
        await setupSchema(fix.sqlite);
        const { drizzle } = await import('drizzle-orm/d1');
        (drizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
        await db.insert(tenants).values({
            id: OPERATOR, slug: 'operator', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
    });

    it('the version registry accepts agent_terms and versions it independently', async () => {
        const svc = new LegalVersionService(db as never);
        const version = await svc.recordPublish({ tenantId: OPERATOR, doc: 'agent_terms', body: 'agent text' });
        expect(version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        const stored = await svc.latest(OPERATOR, 'agent_terms');
        expect(stored?.contentHash).toMatch(HASH64);

        // Independently: publishing agent terms must not mint a Terms row, or the
        // "latest in force" lookup for one document answers with the other's.
        const rows = await db.select().from(tenantLegalVersions).all();
        expect(rows.map((r) => r.doc)).toEqual(['agent_terms']);
    });

    it('agent terms and tenant terms do not share a version sequence', async () => {
        const svc = new LegalVersionService(db as never);
        await svc.recordPublish({ tenantId: OPERATOR, doc: 'terms', body: 'tenant text' });
        await svc.recordPublish({ tenantId: OPERATOR, doc: 'agent_terms', body: 'agent text' });
        const rows = await db.select().from(tenantLegalVersions).all();
        expect(rows).toHaveLength(2);
        expect(new Set(rows.map((r) => r.doc))).toEqual(new Set(['terms', 'agent_terms']));
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
