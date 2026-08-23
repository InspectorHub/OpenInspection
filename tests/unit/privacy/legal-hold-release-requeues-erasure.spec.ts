/**
 * A preservation order that ENDS has to give the erasure back.
 *
 * The defect these specs pin: `legal_holds` had a release shape in its schema —
 * `released_at`, `released_by`, `release_reason` — and no code anywhere wrote
 * any of the three. `loadActiveHolds` READ `released_at` and the whole product
 * treated a hold as permanent, so the sequence a subject actually experiences
 * had no ending:
 *
 *   1. the subject asks for erasure
 *   2. a hold covers the workspace, so the run is admitted, preserved, logged
 *      `held`, and the subject is told their data was kept
 *   3. the matter closes
 *   4. …nothing. The data kept ONLY because of the hold stays forever, and the
 *      erasure right has quietly become a deferral that never resolves.
 *
 * Step 4 is the whole subject of this file. A release is not a bookkeeping
 * update to a row nobody reads: it is the moment the reason for keeping the
 * data stops existing, and the only moment at which anything knows that.
 *
 * ── Why every assertion here is paired ──────────────────────────────────────
 * "The held rows are not erased while the hold stands" is satisfied by an
 * erasure that never works at all, and "the rows are erased after release" is
 * satisfied by a hold that never blocked anything. Neither sentence means
 * anything alone, so each appears beside the other, and — where the claim is
 * about a COLUMN being written — both readings are taken from the SAME row.
 * Asserting `released_at` is set on one fixture and null on a different one
 * passes cleanly against a release path that writes nothing.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { runErasure } from '../../../server/lib/compliance/erasure-orchestrator';
import {
    releaseHold,
    requeueHeldErasures,
    findOutstandingHeldErasures,
} from '../../../server/lib/compliance/legal-hold-release';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import { createTestDb, setupSchema } from '../db';
import { asAnyDb, asD1Db } from '../helpers/test-db';
import * as schema from '../../../server/lib/db/schema';

const TENANT = '00000000-0000-0000-0000-0000000000e1';
const SUBJECT = 'erase-me@example.com';
const OTHER_SUBJECT = 'also-erase-me@example.com';

/** The instant the hold is placed and the erasure is refused under it. */
const T_HELD = Date.UTC(2026, 0, 10, 9, 0, 0);
/** The instant the matter closes. Distinct, because "later" is the ordering. */
const T_RELEASED = Date.UTC(2026, 5, 1, 9, 0, 0);

let db: BetterSQLite3Database<typeof schema>;
let sqlite: ReturnType<typeof createTestDb>['sqlite'];

async function seedContact(email: string, suffix: string): Promise<void> {
    await db.insert(schema.contacts).values({
        id: `c-${suffix}`, tenantId: TENANT, type: 'client', name: 'Subject',
        email, phone: '+15555550123', createdAt: new Date(),
    });
}

async function placeHold(id: string, matter: string): Promise<void> {
    await db.insert(schema.legalHolds).values({
        id, tenantId: TENANT, matter,
        reason: 'Preservation ordered pending litigation.',
        placedBy: 'ops', placedAt: new Date(), releasedAt: null,
    });
}

/** Run the subject erasure the way the DSAR command path runs it. */
const erase = (email = SUBJECT, requestedBy = 'dsar:req-42') => runErasure(asAnyDb(db), {
    tenantId: TENANT, subjectEmail: email, retentionYears: 7,
    requestedBy, identityBasis: 'portal_dsar',
});

const contactsFor = (email: string) => db.select().from(schema.contacts)
    .where(and(eq(schema.contacts.tenantId, TENANT), eq(schema.contacts.email, email))).all();

const logsFor = (email: string) => db.select().from(schema.erasureLog)
    .where(and(eq(schema.erasureLog.tenantId, TENANT), eq(schema.erasureLog.subjectEmail, email))).all();

beforeEach(async () => {
    // Fake time, because the ordering of the log rows IS the record of what
    // happened: a held run and its re-attempt written in the same millisecond
    // are two rows a reader cannot put in order. The clock is moved once, to
    // the instant the matter closes.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(T_HELD));

    const fixture = createTestDb();
    db = fixture.db;
    sqlite = fixture.sqlite;
    await setupSchema(fixture.sqlite);
    await db.insert(schema.tenants).values({
        id: TENANT, slug: 'e1', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    await seedRoleProfiles(asD1Db(db), TENANT, new Date(1));
    await seedContact(SUBJECT, 'a');
    await placeHold('h-1', 'CASE-2026-001');
});

afterEach(() => {
    vi.useRealTimers();
});

describe('releaseHold', () => {
    it('re-attempts the erasure the hold blocked, and the data is actually gone', async () => {
        // ── The precondition, read through THIS fixture, not asserted about
        // some other one. Without it the paragraph below is satisfied by a
        // tenant that never had a contact to erase.
        const held = await erase();
        expect(held.status).toBe('held');
        expect(await contactsFor(SUBJECT)).toHaveLength(1);

        vi.setSystemTime(new Date(T_RELEASED));
        const outcome = await releaseHold(asAnyDb(db), {
            holdId: 'h-1', releasedBy: 'u-legal', releaseReason: 'Matter closed.',
        });

        expect(outcome.released).toBe(true);
        expect(outcome.stillHeld).toBe(false);
        // Asserted against what `runErasure` REPORTED, not against a literal:
        // a hand-written 'completed' here would pass for a re-queue that called
        // nothing and made the string up.
        expect(outcome.requeued.map((r) => ({ subjectEmail: r.subjectEmail, status: r.status })))
            .toEqual([{ subjectEmail: SUBJECT, status: 'completed' }]);

        // The assertion that matters. A status without it passes for a release
        // that reported a re-queue and erased nothing.
        expect(await contactsFor(SUBJECT)).toEqual([]);

        // Two rows for one subject, in the order the events happened: the
        // preservation is not overwritten by its own resolution.
        const rows = (await logsFor(SUBJECT))
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        expect(rows.map((r) => r.status)).toEqual(['held', 'completed']);
        expect(rows[0]?.createdAt.getTime()).toBe(T_HELD);
        expect(rows[1]?.createdAt.getTime()).toBe(T_RELEASED);
    });

    it('POSITIVE CONTROL — while the hold stands, the same call re-attempts nothing', async () => {
        // Without this, everything above passes for a re-queue that ignores
        // holds entirely and erases on demand — which would delete data under a
        // live preservation order, the direction `legal-hold.ts` calls
        // unrecoverable.
        const held = await erase();
        expect(held.status).toBe('held');

        const outcome = await requeueHeldErasures(asAnyDb(db), TENANT);
        expect(outcome.stillHeld).toBe(true);
        expect(outcome.requeued).toEqual([]);
        expect(await contactsFor(SUBJECT)).toHaveLength(1);
    });

    it('a SECOND hold on the same workspace keeps the erasure blocked — with its own release as the control', async () => {
        // The arbiter is "does any order still cover this workspace", not "did
        // this row just change". Releasing one of two holds must change
        // nothing; releasing the second must complete the request. Both halves
        // run against ONE fixture, in sequence, so the passing half cannot be
        // explained by a different seed.
        await placeHold('h-2', 'CASE-2026-002');
        expect((await erase()).status).toBe('held');

        vi.setSystemTime(new Date(T_RELEASED));
        const first = await releaseHold(asAnyDb(db), {
            holdId: 'h-1', releasedBy: 'u-legal', releaseReason: 'Matter closed.',
        });
        expect(first.released).toBe(true);
        expect(first.stillHeld).toBe(true);
        expect(first.requeued).toEqual([]);
        expect(await contactsFor(SUBJECT)).toHaveLength(1);

        const second = await releaseHold(asAnyDb(db), {
            holdId: 'h-2', releasedBy: 'u-legal', releaseReason: 'Second matter closed.',
        });
        expect(second.released).toBe(true);
        expect(second.stillHeld).toBe(false);
        expect(second.requeued.map((r) => r.status)).toEqual(['completed']);
        expect(await contactsFor(SUBJECT)).toEqual([]);
    });

    it('writes the release columns, read before and after on the SAME row', async () => {
        // Deliberately one row read twice. The trap this avoids is asserting
        // `released_at` is set on one hold and null on a different one, which
        // passes green against a path that never writes the column at all.
        const before = await db.select().from(schema.legalHolds)
            .where(eq(schema.legalHolds.id, 'h-1')).get();
        expect(before?.releasedAt).toBeNull();
        expect(before?.releasedBy).toBeNull();
        expect(before?.releaseReason).toBeNull();

        vi.setSystemTime(new Date(T_RELEASED));
        await releaseHold(asAnyDb(db), {
            holdId: 'h-1', releasedBy: 'u-legal', releaseReason: 'Matter closed.',
        });

        const after = await db.select().from(schema.legalHolds)
            .where(eq(schema.legalHolds.id, 'h-1')).get();
        expect(after?.releasedAt?.getTime()).toBe(T_RELEASED);
        expect(after?.releasedBy).toBe('u-legal');
        expect(after?.releaseReason).toBe('Matter closed.');
        // The row STAYS — a released hold is still the record of over which
        // period this workspace was preserved.
        expect(after?.placedAt.getTime()).toBe(T_HELD);
        expect(after?.matter).toBe('CASE-2026-001');
    });

    it('does not rewrite an already-released hold, and says it did not', async () => {
        vi.setSystemTime(new Date(T_RELEASED));
        const first = await releaseHold(asAnyDb(db), {
            holdId: 'h-1', releasedBy: 'u-legal', releaseReason: 'Matter closed.',
        });
        expect(first.released).toBe(true);

        vi.setSystemTime(new Date(T_RELEASED + 86_400_000));
        const again = await releaseHold(asAnyDb(db), {
            holdId: 'h-1', releasedBy: 'someone-else', releaseReason: 'Wrong.',
        });
        expect(again.released).toBe(false);

        const row = await db.select().from(schema.legalHolds)
            .where(eq(schema.legalHolds.id, 'h-1')).get();
        expect(row?.releasedAt?.getTime()).toBe(T_RELEASED);
        expect(row?.releasedBy).toBe('u-legal');
        expect(row?.releaseReason).toBe('Matter closed.');
    });

    it('reports an unknown hold instead of re-queueing on a workspace it never named', async () => {
        expect((await erase()).status).toBe('held');
        vi.setSystemTime(new Date(T_RELEASED));
        const outcome = await releaseHold(asAnyDb(db), {
            holdId: 'h-does-not-exist', releasedBy: 'u-legal', releaseReason: 'Typo.',
        });
        expect(outcome.released).toBe(false);
        expect(outcome.tenantId).toBeNull();
        expect(outcome.requeued).toEqual([]);
        // POSITIVE CONTROL — the real hold still stands and the data is intact,
        // so the null result above is a lookup miss and not a silent erasure.
        expect(await contactsFor(SUBJECT)).toHaveLength(1);
    });
});

describe('the re-attempt carries the request that authorised it', () => {
    it('re-runs under the ORIGINAL requester, not as an anonymous system action', async () => {
        // `erasure_log` keeps `requested_by` and `identity_basis` on the held
        // row. That is the whole linkage the re-queue has, and using it is what
        // keeps the second row pointing back at the console record that
        // authorised the first — rather than appearing as a deletion nobody
        // asked for.
        expect((await erase(SUBJECT, 'dsar:req-99')).status).toBe('held');

        vi.setSystemTime(new Date(T_RELEASED));
        await releaseHold(asAnyDb(db), {
            holdId: 'h-1', releasedBy: 'u-legal', releaseReason: 'Matter closed.',
        });

        const rows = (await logsFor(SUBJECT))
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        expect(rows.map((r) => r.status)).toEqual(['held', 'completed']);
        expect(rows[1]?.requestedBy).toBe('dsar:req-99');
        expect(rows[1]?.identityBasis).toBe('portal_dsar');
        // POSITIVE CONTROL — the value is carried, not defaulted: a different
        // authorising request produces a different value in the same column.
        expect(rows[0]?.requestedBy).toBe('dsar:req-99');
    });
});

describe('findOutstandingHeldErasures', () => {
    it('names a subject whose latest outcome is held', async () => {
        expect((await erase()).status).toBe('held');
        const outstanding = await findOutstandingHeldErasures(asAnyDb(db), TENANT);
        expect(outstanding.map((o) => o.subjectEmail)).toEqual([SUBJECT]);
    });

    it('POSITIVE CONTROL — and stops naming them once the erasure has run', async () => {
        // The settled predicate. A re-queue that could not tell a resolved
        // request from an unresolved one would re-run every held request the
        // workspace ever had, every time any hold was released.
        expect((await erase()).status).toBe('held');
        vi.setSystemTime(new Date(T_RELEASED));
        await releaseHold(asAnyDb(db), {
            holdId: 'h-1', releasedBy: 'u-legal', releaseReason: 'Matter closed.',
        });
        expect(await findOutstandingHeldErasures(asAnyDb(db), TENANT)).toEqual([]);
    });

    it('a subject erased BEFORE the hold and held after it is outstanding again', async () => {
        // Order, not membership. A subject can appear in the log as completed
        // and then as held — a second request, under a hold placed since — and
        // the earlier completion does not settle the later one.
        await db.delete(schema.legalHolds).where(eq(schema.legalHolds.id, 'h-1')).run();
        expect((await erase()).status).toBe('completed');
        expect(await findOutstandingHeldErasures(asAnyDb(db), TENANT)).toEqual([]);

        vi.setSystemTime(new Date(T_HELD + 1000));
        await seedContact(SUBJECT, 'a2');
        await placeHold('h-3', 'CASE-2026-003');
        expect((await erase()).status).toBe('held');

        const outstanding = await findOutstandingHeldErasures(asAnyDb(db), TENANT);
        expect(outstanding.map((o) => o.subjectEmail)).toEqual([SUBJECT]);
    });

    it('does not treat a refused run as a preservation to resolve', async () => {
        // `refused` means the holds table could not be read — a transient
        // fault the command queue retries. Folding it in here would make a
        // hold release the retry mechanism for an unrelated failure, and would
        // erase data on a workspace whose hold state was never established.
        await db.insert(schema.erasureLog).values({
            id: 'log-refused', tenantId: TENANT, subjectEmail: OTHER_SUBJECT,
            status: 'refused', decisionsJson: '[]',
            retainedCount: 0, anonymizedCount: 0, deletedCount: 0,
            responseNote: 'The legal-hold table could not be read, so nothing was erased.',
            createdAt: new Date(T_HELD),
        });
        // POSITIVE CONTROL in the same fixture — a held row IS picked up, so
        // the exclusion above is about the status and not about the query
        // finding nothing at all.
        expect((await erase()).status).toBe('held');

        const outstanding = await findOutstandingHeldErasures(asAnyDb(db), TENANT);
        expect(outstanding.map((o) => o.subjectEmail)).toEqual([SUBJECT]);
    });
});

describe('re-queueing is bounded and repeatable', () => {
    it('stops at the batch ceiling and reports what it did not reach', async () => {
        // An unbounded loop over every held request in a workspace is how one
        // release consumes the whole invocation budget and silently truncates.
        // The ceiling is explicit and the remainder is a number the caller gets.
        await seedContact(OTHER_SUBJECT, 'b');
        expect((await erase(SUBJECT)).status).toBe('held');
        expect((await erase(OTHER_SUBJECT)).status).toBe('held');

        vi.setSystemTime(new Date(T_RELEASED));
        await db.update(schema.legalHolds)
            .set({ releasedAt: new Date(T_RELEASED), releasedBy: 'ops', releaseReason: 'Closed.' })
            .where(eq(schema.legalHolds.id, 'h-1')).run();

        const first = await requeueHeldErasures(asAnyDb(db), TENANT, { maxBatch: 1 });
        expect(first.requeued).toHaveLength(1);
        expect(first.remaining).toBe(1);

        // POSITIVE CONTROL — the remainder is reachable, not lost: the next
        // pass picks up exactly the subject the first one left.
        const second = await requeueHeldErasures(asAnyDb(db), TENANT, { maxBatch: 1 });
        expect(second.requeued).toHaveLength(1);
        expect(second.remaining).toBe(0);
        expect(first.requeued[0]?.subjectEmail).not.toBe(second.requeued[0]?.subjectEmail);

        expect(await contactsFor(SUBJECT)).toEqual([]);
        expect(await contactsFor(OTHER_SUBJECT)).toEqual([]);
    });

    it('a repeated erasure is a no-op rather than a failure — the property the re-queue rests on', async () => {
        // Verified rather than assumed. The re-queue re-runs a request that may
        // already have been satisfied by hand, and `runErasure` is only safe to
        // call again if a second pass over erased data completes instead of
        // throwing. This asserts on what the SECOND real run returned.
        await db.delete(schema.legalHolds).where(eq(schema.legalHolds.id, 'h-1')).run();
        const first = await erase();
        expect(first.status).toBe('completed');
        expect(first.deletedCount).toBeGreaterThan(0);

        const second = await erase();
        expect(second.status).toBe('completed');
        expect(second.deletedCount).toBe(0);
        expect(second.anonymizedCount).toBe(0);
        expect(await contactsFor(SUBJECT)).toEqual([]);
    });

    it('refuses rather than re-queueing when the holds table cannot be read', async () => {
        // An unreadable holds table looks exactly like "no holds" from the
        // outside, and this is the one caller whose response to that would be
        // to start deleting. It must propagate.
        expect((await erase()).status).toBe('held');
        // Drop the table rather than stubbing a throw: the failure this guards
        // is a real unreadable table, and an empty result is what that looks
        // like from the outside if anyone catches the error.
        sqlite.exec('DROP TABLE legal_holds');
        await expect(requeueHeldErasures(asAnyDb(db), TENANT)).rejects.toThrow();

        // POSITIVE CONTROL — the data is still there, so the throw stopped the
        // run rather than happening after it had already deleted.
        expect(await contactsFor(SUBJECT)).toHaveLength(1);
    });
});
