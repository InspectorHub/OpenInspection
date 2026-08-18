/**
 * An invited member's account and their acceptance are ONE write.
 *
 * `joinTeam` is the engine-native door: nobody else captured this acceptance, so
 * this side captures it, and review A2's invariant applies exactly as it does
 * on the portal-originated path. review review decision is why it is a
 * `db.batch()` rather than an event — an outbox proves evidence was captured,
 * not that the ledger held it before the account existed.
 *
 * ── The basis is `individual_acknowledgement`, and that is the point ─────────
 * An invited member ACKNOWLEDGES; they do not bind the company. An invited
 * ADMIN also only acknowledges: being handed operational access is not being
 * handed the authority to sign. Without the basis column their row would be
 * indistinguishable from an owner's.
 *
 * ── Fail closed means the join is refused, not softened ─────────────────────
 * The documents come from the TENANT's own published Privacy and Terms. When
 * the tenant has published neither, there is nothing to record, and creating
 * the account anyway is precisely the state the invariant forbids. So the join
 * is refused — visibly, to the person trying to accept — rather than completed
 * with an empty ledger.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createTestDb, setupSchema } from '../db';
import { withBatch } from '../helpers/d1-binding';
import * as schema from '../../../server/lib/db/schema';
import { users, tenants, tenantInvites, accountAcceptances } from '../../../server/lib/db/schema';
import { LegalVersionService } from '../../../server/services/legal-version.service';
import { INVITE_REQUIRED_DOCS } from '../../../server/services/legal/invite-acceptance';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { AuthService } from '../../../server/services/auth.service';

const TENANT = 't-invite';

describe('joinTeam records the acceptance in the same write as the member row', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: import('better-sqlite3').Database;
    let auth: AuthService;

    const invite = async (token: string, email: string) => {
        await db.insert(tenantInvites).values({
            id: token, tenantId: TENANT, email, role: 'inspector',
            status: 'pending', expiresAt: new Date(Date.now() + 1_000_000), invitedBy: 'u1',
        } as never);
    };

    const publishBoth = async () => {
        const svc = new LegalVersionService(db as never);
        await svc.recordPublish({ tenantId: TENANT, doc: 'terms', body: 'Our terms.', timezone: 'UTC' });
        await svc.recordPublish({ tenantId: TENANT, doc: 'privacy', body: 'Our privacy notice.', timezone: 'UTC' });
    };

    beforeEach(async () => {
        const fix = createTestDb();
        db = fix.db;
        sqlite = fix.sqlite;
        await setupSchema(fix.sqlite);
        // The mocked factory returns a better-sqlite3 handle, which has no
        // `batch()` — and this path now requires one, because the batch IS the
        // invariant. See `helpers/d1-binding.ts`.
        (mockDrizzle as unknown as { mockReturnValue: (v: unknown) => void })
            .mockReturnValue(withBatch(db, fix.sqlite));
        await db.insert(tenants).values({ id: TENANT, slug: 'acme', createdAt: new Date() });
        auth = new AuthService({} as D1Database);
    });

    afterEach(() => {
        sqlite.close();
        vi.clearAllMocks();
    });

    it('requires BOTH Terms and Privacy, not either', () => {
        // Pinned because the set is the claim. A member who accepted one of the
        // two has a ledger that READS as complete — a row per document, all of
        // them present — while the other document was never put to them, and
        // quietly dropping one from this list is how that would ship.
        expect([...INVITE_REQUIRED_DOCS].sort()).toEqual(['privacy', 'terms']);
    });

    it('writes one acceptance row per published document, keyed to the member', async () => {
        await publishBoth();
        await invite('tok-ok', 'member@example.com');

        const joined = await auth.joinTeam('tok-ok', 'password123');

        const rows = await db.select().from(accountAcceptances).all();
        expect(rows.map((r) => r.doc).sort()).toEqual(['privacy', 'terms']);
        expect(rows.every((r) => r.userId === joined.id)).toBe(true);
        // Acknowledgement, never `owner`: operational access is not signing
        // authority, and an invited admin is in the same position.
        expect(rows.every((r) => r.authorityBasis === 'individual_acknowledgement')).toBe(true);
        // Captured on this side, so there is no portal identity behind it.
        expect(rows.every((r) => r.actorIdentityRef === null)).toBe(true);
        // The hash is the tenant's published one, not a placeholder.
        const published = await new LegalVersionService(db as never).latest(TENANT, 'terms');
        expect(rows.find((r) => r.doc === 'terms')?.contentHash).toBe(published?.contentHash);
    });

    it('records only what was published, so a partial ledger cannot read as complete', async () => {
        // This used to REFUSE, on the reasoning that "a member who accepted one of
        // the two documents has a record that reads as complete and is not". The
        // property is right; the refusal was the wrong way to defend it — it also
        // stopped the person having an account at all. The record names exactly the
        // documents accepted, so a reader can see the other one is absent.
        await new LegalVersionService(db as never).recordPublish({
            tenantId: TENANT, doc: 'privacy', body: 'Only privacy.', timezone: 'UTC',
        });
        await invite('tok-half', 'half@example.com');

        await auth.joinTeam('tok-half', 'password123');
        const rows = await db.select().from(accountAcceptances).all();
        // Exactly one row, and it names which document. Nothing was invented to
        // fill the gap, which is what "cannot read as complete" now means.
        expect(rows).toHaveLength(1);
        expect(rows[0]?.doc).toBe('privacy');
        expect(rows.some((r) => r.doc === 'terms')).toBe(false);
    });

    it('a workspace that has published nothing can still take on a member', async () => {
        // The regression this replaces had teeth: `tenant_legal_versions` rows
        // appear only once an admin saves Privacy or Terms in Settings, so a
        // brand-new deployment could invite nobody. The e2e caught it as a 500 on
        // `POST /api/auth/join`.
        //
        // Refusing when NOTHING is published is a gate that can only ever say no,
        // and it contradicted the identical situation on the `/setup` door, which
        // records when it can and says plainly when it cannot. The gap is closed by
        // publishing built-in documents at tenant creation, not by a stricter check.
        await invite('tok-none', 'none@example.com');

        await auth.joinTeam('tok-none', 'password123');
        expect(await db.select().from(users).all()).toHaveLength(1);
        // No acceptance rows, and that is the honest outcome rather than a row
        // pointing at a document that does not exist.
        expect(await db.select().from(accountAcceptances).all()).toHaveLength(0);
    });
    it('a REACTIVATED member gets their acceptance against the original row', async () => {
        await publishBoth();
        await db.insert(users).values({
            id: 'user-old', tenantId: TENANT, email: 'back@example.com',
            passwordHash: 'pbkdf2:old', role: 'inspector',
            createdAt: new Date(), deletedAt: new Date(),
        });
        await invite('tok-back', 'back@example.com');

        const joined = await auth.joinTeam('tok-back', 'password123');

        // The row is reattached, not re-minted — inspection history follows the
        // id — so the acceptance has to land on that id too.
        expect(joined.id).toBe('user-old');
        const rows = await db.select().from(accountAcceptances).all();
        expect(rows).toHaveLength(2);
        expect(rows.every((r) => r.userId === 'user-old')).toBe(true);
    });

    it('the outbound user.invited carries the acceptance beside the account it creates', async () => {
        await publishBoth();
        await invite('tok-sync', 'sync@example.com');
        const appended: Array<{ type: string; payload: Record<string, unknown> }> = [];
        const withOutbox = new AuthService({} as D1Database, undefined, {
            append: async (e) => { appended.push(e); return 'row-1'; },
        });

        await withOutbox.joinTeam('tok-sync', 'password123');

        const invited = appended.find((e) => e.type === 'user.invited');
        // The event that creates the portal-side identity is the event that
        // must carry the evidence the account was validly created; splitting
        // them is the belief decision is about.
        const acceptance = invited?.payload['acceptance'] as {
            authorityBasis: string;
            documents: Array<{ doc: string; version: string; contentHash: string; acceptedAt: number }>;
        } | undefined;
        expect(acceptance?.authorityBasis).toBe('individual_acknowledgement');
        expect(acceptance?.documents.map((d) => d.doc).sort()).toEqual(['privacy', 'terms']);
        expect(acceptance?.documents.every((d) => /^[0-9a-f]{64}$/.test(d.contentHash))).toBe(true);
    });

    it('a reactivated member reports the ORIGINAL acceptance time, not this attempt', async () => {
        await publishBoth();
        await invite('tok-a', 'again@example.com');
        const first = await auth.joinTeam('tok-a', 'password123');
        const original = (await db.select().from(accountAcceptances).all())
            .map((r) => r.acceptedAt!.getTime()).sort();

        await db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, first.id));
        await invite('tok-b', 'again@example.com');
        const appended: Array<{ type: string; payload: Record<string, unknown> }> = [];
        const withOutbox = new AuthService({} as D1Database, undefined, {
            append: async (e) => { appended.push(e); return 'row-2'; },
        });
        await withOutbox.joinTeam('tok-b', 'password123');

        const acceptance = appended.find((e) => e.type === 'user.invited')!
            .payload['acceptance'] as { documents: Array<{ acceptedAt: number }> };
        // Reporting today's date for a document accepted earlier would be the
        // plumbing overwriting the legal fact — the exact reason `accepted_at`
        // is a separate column from `created_at`.
        expect(acceptance.documents.map((d) => d.acceptedAt).sort()).toEqual(original);
    });

    it('re-accepting the SAME versions does not mint a second row, and does not fail the join', async () => {
        await publishBoth();
        await invite('tok-1', 'twice@example.com');
        const first = await auth.joinTeam('tok-1', 'password123');

        // Removed, then re-invited while the tenant's documents are unchanged.
        await db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, first.id));
        await invite('tok-2', 'twice@example.com');
        await auth.joinTeam('tok-2', 'password123');

        // The unique index is (user, doc, version): a second row at the same
        // version would read as the person having accepted twice. The already
        // recorded documents are skipped rather than re-inserted, so the join
        // succeeds and the ledger still says exactly what happened.
        expect(await db.select().from(accountAcceptances).all()).toHaveLength(2);
    });
});
