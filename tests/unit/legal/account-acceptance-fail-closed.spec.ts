/**
 * An account and its acceptance are ONE write, or there is no account.
 *
 * Why it is enforced this way rather than the obvious way: the first design
 * enqueued the acceptance atomically with the account insert and let the ledger
 * catch up, and that is NOT fail-closed. The distinction: an outbox proves
 * *acceptance evidence was durably captured*, but not *acceptance was recorded
 * in the acceptance ledger before account creation* — and while the event is unconsumed
 * the state is `account = EXISTS, acceptance_ledger = ABSENT`, which violates the
 * invariant whatever the envelope holds.
 *
 * So the builder hands back STATEMENTS and never executes them, and the caller
 * puts them in the same `db.batch()` as the `users` row. These specs pin the two
 * halves of that: the builder refuses anything that would produce an unusable
 * row, and it produces statements rather than performing writes.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { accountAcceptances } from '../../../server/lib/db/schema';
import { buildAcceptanceStatement } from '../../../server/services/legal/account-acceptance';
import { deriveAuthorityBasis } from '../../../server/lib/auth/authority-basis';

const TENANT = '00000000-0000-0000-0000-0000000000a1';
const USER = '11111111-1111-1111-1111-111111111111';
const HASH = 'a'.repeat(64);

const doc = (over: Record<string, unknown> = {}) => ({
    doc: 'terms', version: '2026-08-01', contentHash: HASH, acceptedAt: 1_700_000_000_000, ...over,
});

describe('buildAcceptanceStatement refuses what it cannot record honestly', () => {
    let db: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fix = createTestDb();
        db = fix.db;
        await setupSchema(fix.sqlite);
    });

    it('returns statements WITHOUT writing anything', async () => {
        const stmts = buildAcceptanceStatement(db as never, {
            tenantId: TENANT, userId: USER,
            authorityBasis: 'individual_acknowledgement',
            documents: [doc(), doc({ doc: 'privacy' })],
        });
        expect(stmts).toHaveLength(2);
        // The whole point: nothing is in the ledger until the CALLER runs
        // these inside the batch that also creates the account. A builder that
        // executed its own insert would look correct and would reopen the exact
        // window the invariant closes.
        expect(await db.select().from(accountAcceptances).all()).toHaveLength(0);

        for (const s of stmts) await s;
        expect(await db.select().from(accountAcceptances).all()).toHaveLength(2);
    });

    it('refuses an empty document list instead of returning an empty batch', () => {
        // A caller reaching here believes it is recording an acceptance. Handing
        // back nothing would let the account be created with nothing beside it
        // and report success.
        expect(() => buildAcceptanceStatement(db as never, {
            tenantId: TENANT, userId: USER,
            authorityBasis: 'owner', documents: [],
        })).toThrow(/no documents/i);
    });

    it('refuses a document with no content hash', () => {
        // An acceptance without a hash points at nothing checkable, and stored it
        // would read as evidence while proving nothing.
        expect(() => buildAcceptanceStatement(db as never, {
            tenantId: TENANT, userId: USER, authorityBasis: 'owner',
            documents: [doc({ contentHash: '' })],
        })).toThrow(/content hash/i);
        expect(() => buildAcceptanceStatement(db as never, {
            tenantId: TENANT, userId: USER, authorityBasis: 'owner',
            documents: [doc({ contentHash: 'not-a-hash' })],
        })).toThrow(/content hash/i);
    });

    it('refuses a document with no version, and one with no acceptance time', () => {
        expect(() => buildAcceptanceStatement(db as never, {
            tenantId: TENANT, userId: USER, authorityBasis: 'owner',
            documents: [doc({ version: '' })],
        })).toThrow(/version/i);
        expect(() => buildAcceptanceStatement(db as never, {
            tenantId: TENANT, userId: USER, authorityBasis: 'owner',
            documents: [doc({ acceptedAt: 0 })],
        })).toThrow(/acceptance time/i);
    });

    it('refuses an authority basis the seam does not share', () => {
        // The two repositories duplicate the vocabulary because they cannot import
        // from each other, so drift is possible — and this is where it surfaces,
        // rather than as a row nobody can interpret.
        expect(() => buildAcceptanceStatement(db as never, {
            tenantId: TENANT, userId: USER,
            authorityBasis: 'trust_me' as never, documents: [doc()],
        })).toThrow(/vocabulary has drifted/i);
    });

    it('records when the HUMAN accepted, not when the row was built', async () => {
        const humanAcceptedAt = 1_600_000_000_000;
        const [stmt] = buildAcceptanceStatement(db as never, {
            tenantId: TENANT, userId: USER, authorityBasis: 'owner',
            documents: [doc({ acceptedAt: humanAcceptedAt })],
        });
        await stmt;
        const row = await db.select().from(accountAcceptances).get();
        // On the portal-originated path these differ by however long the
        // onboarding workflow took; collapsing them would forge the legal fact to
        // match the plumbing.
        expect(row?.acceptedAt?.getTime()).toBe(humanAcceptedAt);
        expect(row?.createdAt?.getTime()).not.toBe(humanAcceptedAt);
    });

    it('the same acceptance delivered twice cannot mint a second row', async () => {
        const build = () => buildAcceptanceStatement(db as never, {
            tenantId: TENANT, userId: USER, authorityBasis: 'owner', documents: [doc()],
        });
        await build()[0]!;
        // The seam is at-least-once. A redelivered command must not read as the
        // person having accepted twice.
        await expect(build()[0]!).rejects.toThrow();
        expect(await db.select().from(accountAcceptances).all()).toHaveLength(1);
    });
});

describe('the authority basis comes from the door, never from a lookup', () => {
    it('the setup wizard binds; an invite only acknowledges', () => {
        expect(deriveAuthorityBasis({ path: 'setup' })).toBe('owner');
        // An invited ADMIN also only acknowledges: operational access is not
        // signing authority.
        expect(deriveAuthorityBasis({ path: 'invite' })).toBe('individual_acknowledgement');
    });

    it('a portal-originated acceptance carries its basis, and is refused without one', () => {
        expect(deriveAuthorityBasis({ path: 'portal_command', declared: 'owner' })).toBe('owner');
        // Substituting one would be a second writer for a fact the other side
        // owns, and the two would disagree the first time either door changed.
        expect(() => deriveAuthorityBasis({ path: 'portal_command' }))
            .toThrow(/refusing to substitute/i);
    });
});
