/**
 * The invariant, proven against a REAL D1 binding.
 *
 * review A2: an account and its acceptance are one write. review review
 * decision: an outbox does not satisfy it, because while the event sits
 * unconsumed the state is `account = EXISTS, acceptance_ledger = ABSENT`. So
 * the implementation puts both in one `db.batch()` and the invariant reduces to
 * a single claim about D1: A FAILED STATEMENT IN A BATCH UNDOES THE ONES BEFORE
 * IT.
 *
 * That claim cannot be tested in `tests/unit/`. The node suite runs
 * better-sqlite3, where `batch()` either does not exist or is a fixture we
 * wrote ourselves (`tests/unit/helpers/d1-binding.ts`) — and a test whose
 * subject is D1's transaction semantics, asserted against our own emulation of
 * them, proves only that our emulation agrees with itself. This spec runs in
 * workerd against the binding, so the answer comes from the thing being relied
 * on.
 *
 * The probe is a duplicate `(user, doc, version)`, which the schema's unique
 * index refuses. That is deliberately a LATE statement: the `users` insert has
 * already executed by the time it fails, so a non-atomic batch would leave an
 * account behind and this spec would see it.
 */
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { applyAdminCredential } from '../../server/portal/admin-credential';
import { StandaloneProvider } from '../../server/lib/integration/standalone';
import { applyMigrations as replayMigrations } from './migration-replay';

const b = env as unknown as { DB: D1Database };

// The pool's bundler inlines the migration bodies via import.meta.glob ?raw;
// the glob must be literal HERE for that to happen. Replaying the real
// migrations rather than hand-writing DDL is what makes the unique index in
// this test the SAME index production has — a hand-copied one would go on
// passing after the real one was dropped.
const migrationSql = import.meta.glob('../../migrations/*.sql', {
    query: '?raw',
    import: 'default',
    eager: true,
}) as Record<string, string>;

const TENANT = 'tenant-acceptance-atomicity';
const EMAIL = 'owner@atomicity.test';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

const doc = (over: Partial<{ doc: string; version: string; contentHash: string; acceptedAt: number }> = {}) => ({
    doc: 'terms', version: '2026-08-01', contentHash: HASH_A, acceptedAt: 1_700_000_000_000, ...over,
});

async function countUsers(): Promise<number> {
    const row = await b.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE email = ?')
        .bind(EMAIL).first<{ n: number }>();
    return row?.n ?? 0;
}

async function countAcceptances(): Promise<number> {
    const row = await b.DB.prepare('SELECT COUNT(*) AS n FROM account_acceptances WHERE tenant_id = ?')
        .bind(TENANT).first<{ n: number }>();
    return row?.n ?? 0;
}

// ONE replay for the whole file, at module scope rather than per-describe. The
// pool gives a file a single D1, and a second `beforeAll` replaying the same
// migrations answers `table … already exists` — the first version of this spec
// did exactly that and skipped the standalone tests without failing them.
beforeAll(async () => {
    await replayMigrations(b.DB, migrationSql);
});

describe('account_acceptances — real-D1 batch atomicity', () => {
    beforeEach(async () => {
        await b.DB.exec('DELETE FROM account_acceptances;');
        await b.DB.exec('DELETE FROM users;');
        await b.DB.exec('DELETE FROM tenants;');
        await b.DB.prepare(
            'INSERT INTO tenants (id, slug, status, tier, deployment_mode, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        ).bind(TENANT, 'atomicity', 'active', 'free', 'shared', Date.now()).run();
    });

    it('the account and both acceptance rows land together', async () => {
        await applyAdminCredential(b.DB, {
            tenantId: TENANT, adminEmail: EMAIL, adminPasswordHash: 'pbkdf2:x:y',
            acceptance: {
                actorIdentityRef: 'identity-1',
                authorityBasis: 'owner',
                documents: [doc(), doc({ doc: 'privacy', contentHash: HASH_B })],
            },
        });

        expect(await countUsers()).toBe(1);
        expect(await countAcceptances()).toBe(2);
        const row = await b.DB.prepare(
            'SELECT a.user_id AS user_id, u.id AS uid FROM account_acceptances a JOIN users u ON u.id = a.user_id LIMIT 1',
        ).first<{ user_id: string; uid: string }>();
        // Keyed to the user created in the SAME write, not to a dangling id.
        expect(row?.user_id).toBe(row?.uid);
    });

    it('WHEN THE ACCEPTANCE INSERT FAILS, THE USERS ROW DOES NOT SURVIVE', async () => {
        // Two documents that collide on uq_account_acceptances_user_doc_version.
        // The users insert is statement 0 and has already run when statement 2
        // fails; on a non-atomic batch the account would be left standing with a
        // partial ledger beside it, which is the state the invariant forbids.
        await expect(applyAdminCredential(b.DB, {
            tenantId: TENANT, adminEmail: EMAIL, adminPasswordHash: 'pbkdf2:x:y',
            acceptance: {
                authorityBasis: 'owner',
                documents: [doc(), doc({ contentHash: HASH_B })],
            },
        })).rejects.toThrow();

        expect(await countUsers()).toBe(0);
        expect(await countAcceptances()).toBe(0);
    });

    it('a redelivered command cannot mint a second account or a second acceptance', async () => {
        const command = {
            tenantId: TENANT, adminEmail: EMAIL, adminPasswordHash: 'pbkdf2:x:y',
            acceptance: { authorityBasis: 'owner' as const, documents: [doc()] },
        };
        await applyAdminCredential(b.DB, command);
        // The seam is at-least-once. The second delivery finds the account and
        // takes the UPDATE branch, which owes no acceptance — so the ledger is
        // untouched rather than growing a row that would read as the person
        // having accepted twice.
        await applyAdminCredential(b.DB, command);

        expect(await countUsers()).toBe(1);
        expect(await countAcceptances()).toBe(1);
    });

    it('refuses to create an account when the command carries no acceptance — and creates nothing', async () => {
        await expect(applyAdminCredential(b.DB, {
            tenantId: TENANT, adminEmail: EMAIL, adminPasswordHash: 'pbkdf2:x:y',
        })).rejects.toThrow(/acceptance/i);

        expect(await countUsers()).toBe(0);
    });
});

/**
 * The `/setup` door, which is the same batch and a DIFFERENT answer on absence.
 *
 * The basis is `owner` — the person is bringing the workspace into existence in
 * this same request — and it comes from the door rather than from anything the
 * caller declares.
 *
 * ⚠️ An absent acceptance is NOT refused here, and the second test pins that on
 * purpose rather than leaving it to be discovered. There is nothing for a
 * self-host operator to accept: `deployment_legal_versions` holds only
 * `agent_terms`, and the tenant's own legal versions cannot exist yet because
 * the tenant is created by this call. A test that asserted a refusal would be
 * asserting that `/setup` is impossible. When a document exists, this
 * expectation is what has to change, and it is written down so the change is a
 * decision instead of a surprise.
 */
describe('standalone /setup owner — same batch, different answer on absence', () => {
    // A TENANT PER TEST, and no `DELETE FROM tenants` between them. The setup
    // path seeds templates, agreements, services, comments and role profiles
    // against the tenant it just created, several of which carry legacy foreign
    // keys back to it — so wiping the tenant row is answered with
    // `FOREIGN KEY constraint failed` rather than a clean slate. Isolating by id
    // costs nothing and does not require this spec to keep a list of every table
    // the seeder touches, which is a list that would go stale.
    const SETUP_EMAIL = 'first@atomicity.test';
    let setupTenant = '';
    let n = 0;

    beforeEach(async () => {
        setupTenant = `tenant-setup-atomicity-${++n}`;
        await b.DB.prepare('DELETE FROM account_acceptances WHERE tenant_id = ?').bind(setupTenant).run();
        await b.DB.prepare('DELETE FROM users WHERE email = ?').bind(SETUP_EMAIL).run();
    });

    it('records the owner acceptance in the same write as the owner account', async () => {
        await new StandaloneProvider(b.DB).handleTenantUpdate({
            // The slug varies with the tenant too: it is UNIQUE, and the provider
            // falls back to matching on it when the id misses — so a reused slug
            // would silently send the second test down the UPDATE branch.
            id: setupTenant, slug: setupTenant, status: 'active',
            adminEmail: SETUP_EMAIL, adminPasswordHash: 'pbkdf2:x:y', adminName: 'First Owner',
            acceptance: {
                authorityBasis: 'owner',
                documents: [doc({ acceptedAt: 1_700_000_000_000 })],
            },
        });

        const user = await b.DB.prepare('SELECT id FROM users WHERE email = ?')
            .bind(SETUP_EMAIL).first<{ id: string }>();
        expect(user?.id).toBeTruthy();
        const acc = await b.DB.prepare(
            'SELECT user_id, authority_basis FROM account_acceptances WHERE tenant_id = ?',
        ).bind(setupTenant).first<{ user_id: string; authority_basis: string }>();
        expect(acc?.user_id).toBe(user?.id);
        // `owner`, from the door — not the `individual_acknowledgement` an
        // invited member gets, and not whatever a caller might have declared.
        expect(acc?.authority_basis).toBe('owner');
    });

    it('still creates the owner when no acceptance is supplied — the KNOWN GAP', async () => {
        await new StandaloneProvider(b.DB).handleTenantUpdate({
            // The slug varies with the tenant too: it is UNIQUE, and the provider
            // falls back to matching on it when the id misses — so a reused slug
            // would silently send the second test down the UPDATE branch.
            id: setupTenant, slug: setupTenant, status: 'active',
            adminEmail: SETUP_EMAIL, adminPasswordHash: 'pbkdf2:x:y', adminName: 'First Owner',
        });

        expect(await b.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE email = ?')
            .bind(SETUP_EMAIL).first<{ n: number }>().then((r) => r?.n)).toBe(1);
        // Zero rows, and this assertion is the record of it. Change it when the
        // deployment publishes something for the first operator to accept.
        expect(await b.DB.prepare('SELECT COUNT(*) AS n FROM account_acceptances WHERE tenant_id = ?')
            .bind(setupTenant).first<{ n: number }>().then((r) => r?.n)).toBe(0);
    });
});
