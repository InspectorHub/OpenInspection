/**
 * A portal command may not CREATE an account without the acceptance it carries.
 *
 * ⚠️ TWICE-AMENDED. The first amendment was wrong, and it is worth keeping the
 * story because of HOW it was wrong.
 *
 * The original header said the portal has been shipping an acceptance block on the
 * credential-bearing `cmd.tenant.update` all along, and that this side discarded
 * it. An amendment then replaced that with the opposite — "`buildCommandAcceptance`
 * does not exist in the portal", "checked by reading that repository's working
 * tree, zero occurrences of either name" — and concluded these specs fence a gap
 * rather than close one.
 *
 * The original was right. `apps/portal/server/lib/legal/acceptance-command.ts` and
 * `server/lib/sync/project-acceptance.ts` both exist; `onboarding-workflow.ts`
 * calls `buildCommandAcceptance` and `apply-envelope.ts` calls `projectAcceptance`.
 * They live on the unmerged `release/2026-08-17-acceptance-and-authority` branch
 * (PR #117), and the portal checkout happened to be sitting on `main`.
 *
 * So the check that produced the amendment — reading the working tree — was a real
 * check that answered a different question than the one asked. That is the part to
 * remember: "I read the files and they are not there" sounds like verification and
 * is not, when a sibling repository can be on any branch. Ask `git ls-tree` of the
 * branch you mean, not the filesystem you happen to have.
 *
 * What this means for these specs: they DO close a gap. Evidence the portal
 * captures and transmits was arriving here and being dropped, and now it is
 * recorded in the same write as the account. The deploy ordering in PR #117 is the
 * matching half — the engine must ship before the portal's block has a reader.
 *
 * ── The asymmetry is the design, not an oversight ───────────────────────────
 * The INSERT branch creates an account, so it owes an acceptance and refuses
 * without one. The UPDATE branch rotates a credential on an account that already
 * exists — it creates nothing, and demanding an acceptance there would refuse a
 * password change for a person who accepted years ago.
 *
 * ── Why the refusal is loud rather than a park ──────────────────────────────
 * A credential-bearing command that would create an account with no acceptance is
 * not a message we cannot understand; it is one we understand and must not obey.
 * Throwing exhausts the retries and surfaces it as a `failed` row against the
 * tenant that is stuck, where somebody is still looking.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createTestDb, setupSchema } from '../db';
import { toD1Binding } from '../helpers/d1-binding';
import * as schema from '../../../server/lib/db/schema';
import { users, tenants, accountAcceptances } from '../../../server/lib/db/schema';
import { applyAdminCredential } from '../../../server/portal/admin-credential';

const TENANT = '00000000-0000-0000-0000-0000000000a1';
const EMAIL = 'owner@example.com';
const HASH = 'a'.repeat(64);

const acceptance = () => ({
    actorIdentityRef: 'identity-1',
    authorityBasis: 'owner' as const,
    documents: [
        { doc: 'terms', version: '2026-08-01', contentHash: HASH, acceptedAt: 1_700_000_000_000 },
        { doc: 'privacy', version: '2026-08-01', contentHash: 'b'.repeat(64), acceptedAt: 1_700_000_000_000 },
    ],
});

describe('a portal command that creates an account must carry its acceptance', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let binding: D1Database;

    beforeEach(async () => {
        const fix = createTestDb();
        db = fix.db;
        // A D1-SHAPED stub, not the raw better-sqlite3 handle. The applier takes
        // a binding and builds its own `drizzle(binding)` — the production shape
        // — and it calls `db.batch()`, which the plain cast has no method for and
        // whose `raw()` it answers with a Statement object rather than rows. See
        // `helpers/d1-binding.ts` for what that silently did to this spec.
        binding = toD1Binding(fix.sqlite);
        await setupSchema(fix.sqlite);
        await db.insert(tenants).values({
            id: TENANT, slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
    });

    it('creates the account and its acceptance rows together', async () => {
        await applyAdminCredential(binding, {
            tenantId: TENANT, adminEmail: EMAIL, adminPasswordHash: 'pbkdf2:x:y',
            acceptance: acceptance(),
        });
        const user = await db.select().from(users).where(eq(users.email, EMAIL)).get();
        expect(user).toBeDefined();
        const rows = await db.select().from(accountAcceptances).all();
        expect(rows).toHaveLength(2);
        // Keyed to the user that was created in the same write, and carrying the
        // basis the PORTAL determined rather than one this side invented.
        expect(rows.every((r) => r.userId === user!.id)).toBe(true);
        expect(rows.every((r) => r.authorityBasis === 'owner')).toBe(true);
        expect(rows.every((r) => r.actorIdentityRef === 'identity-1')).toBe(true);
    });

    it('REFUSES to create an account when the command carries no acceptance', async () => {
        await expect(applyAdminCredential(binding, {
            tenantId: TENANT, adminEmail: EMAIL, adminPasswordHash: 'pbkdf2:x:y',
        })).rejects.toThrow(/acceptance/i);
        // Fail closed means no account, not an account with nothing beside it.
        expect(await db.select().from(users).all()).toHaveLength(0);
        expect(await db.select().from(accountAcceptances).all()).toHaveLength(0);
    });

    it('rotating a credential on an EXISTING account needs no acceptance', async () => {
        await db.insert(users).values({
            id: 'user-1', tenantId: TENANT, email: EMAIL,
            passwordHash: 'pbkdf2:old', role: 'owner', createdAt: new Date(),
        });
        // No acceptance passed, and that is correct: nothing is created, and
        // demanding one here would refuse a password change for somebody who
        // accepted long ago.
        await applyAdminCredential(binding, {
            tenantId: TENANT, adminEmail: EMAIL, adminPasswordHash: 'pbkdf2:new',
        });
        const user = await db.select().from(users).where(eq(users.email, EMAIL)).get();
        expect(user?.passwordHash).toBe('pbkdf2:new');
        expect(await db.select().from(accountAcceptances).all()).toHaveLength(0);
    });

    it('an acceptance the ledger cannot hold refuses BEFORE the account exists', async () => {
        await expect(applyAdminCredential(binding, {
            tenantId: TENANT, adminEmail: EMAIL, adminPasswordHash: 'pbkdf2:x:y',
            acceptance: { ...acceptance(), documents: [
                { doc: 'terms', version: '2026-08-01', contentHash: 'nope', acceptedAt: 1 },
            ] },
        })).rejects.toThrow(/content hash/i);
        // The builder validates before producing statements, so a bad document
        // cannot leave a half-built batch behind.
        expect(await db.select().from(users).all()).toHaveLength(0);
    });
});
