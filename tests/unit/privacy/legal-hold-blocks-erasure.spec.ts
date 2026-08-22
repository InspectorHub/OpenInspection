/**
 * A preservation order outranks a subject erasure, not only the nightly sweep.
 *
 * The defect this guards is that it did not. `loadActiveHolds` had exactly two
 * callers and both were the scheduled sweep; the erasure orchestrator never
 * asked. So a hold stopped the sweep and did not stop an erasure — and the
 * module that loads holds had already written down why that direction cannot be
 * undone: "A sweep that skips a night is recoverable; a sweep that ran during a
 * preservation order is not."
 *
 * ── Three states, not two ───────────────────────────────────────────────────
 * The rule these specs encode is NOT "delete or hold". There are three separate
 * things that can be true of one workspace's data, and they are arbitrated
 * rather than ranked:
 *
 *   ordinary lifecycle — a retention window expired, so delete on schedule
 *   preservation order — a matter requires this data to stay
 *   subject erasure    — a person asked for their data to go
 *
 * A subject erasure is never refused at the door because a preservation order
 * exists. It enters, it is recorded, it deletes whatever the order does not
 * cover, and it records an exception for whatever the order does cover. That is
 * why a held run has its OWN outcome rather than being folded into a refusal:
 * refused means we could not act, held means we deliberately did not, and the
 * person who asked is entitled to be told which.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { holdDisposition, type ActiveHolds } from '../../../server/lib/compliance/legal-hold';
import { runErasure } from '../../../server/lib/compliance/erasure-orchestrator';
import { applySubjectErase } from '../../../server/portal/apply-subject-commands';
import { DATA_SCHEMAS } from '../../../server/lib/sync-events/envelope';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import { createTestDb, setupSchema } from '../db';
import { asAnyDb, asD1Db } from '../helpers/test-db';
import * as schema from '../../../server/lib/db/schema';

const HELD: ActiveHolds = { heldTenantIds: new Set(['t-held']), activeHoldCount: 1 };
const NONE: ActiveHolds = { heldTenantIds: new Set<string>(), activeHoldCount: 0 };

describe('holdDisposition', () => {
    it('preserves a tenant under an active hold', () => {
        expect(holdDisposition('t-held', HELD).action).toBe('preserve');
    });

    it('deletes for a tenant with no hold — the positive control', () => {
        // Without this, the assertion above passes for a function that always
        // preserves, which would stop every erasure in the product.
        expect(holdDisposition('t-free', HELD).action).toBe('delete');
        expect(holdDisposition('t-held', NONE).action).toBe('delete');
    });

    it('gives a reason a later reader can act on', () => {
        const d = holdDisposition('t-held', HELD);
        expect(d.action).toBe('preserve');
        if (d.action !== 'preserve') throw new Error('unreachable');
        expect(d.reason).toMatch(/legal hold/i);
    });
});

const HELD_TENANT = '00000000-0000-0000-0000-0000000000d1';
const FREE_TENANT = '00000000-0000-0000-0000-0000000000d2';
const SUBJECT = 'erase-me@example.com';

let db: BetterSQLite3Database<typeof schema>;

/** One tenant with a contact to erase. `held` decides whether it is covered. */
async function seedTenant(tenantId: string, held: boolean): Promise<void> {
    await db.insert(schema.tenants).values({
        id: tenantId, slug: tenantId.slice(-4), status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    await seedRoleProfiles(asD1Db(db), tenantId, new Date(1));
    await db.insert(schema.contacts).values({
        id: `c-${tenantId.slice(-4)}`, tenantId, type: 'client', name: 'Subject',
        email: SUBJECT, phone: '+15555550123', createdAt: new Date(),
    });
    if (held) {
        await db.insert(schema.legalHolds).values({
            id: `h-${tenantId.slice(-4)}`, tenantId,
            matter: 'CASE-2026-001', reason: 'Preservation ordered pending litigation.',
            placedBy: 'ops', placedAt: new Date(), releasedAt: null,
        });
    }
}

describe('runErasure under a legal hold', () => {
    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        await setupSchema(fixture.sqlite);
        await seedTenant(HELD_TENANT, true);
        await seedTenant(FREE_TENANT, false);
    });

    it('preserves instead of deleting, and says why', async () => {
        const summary = await runErasure(asAnyDb(db), {
            tenantId: HELD_TENANT, subjectEmail: SUBJECT, retentionYears: 7,
        });
        expect(summary.status).toBe('held');
        expect(summary.deletedCount).toBe(0);
        expect(summary.anonymizedCount).toBe(0);
        expect(summary.preservedCount).toBeGreaterThan(0);
        expect(summary.decisions.some((d) => d.action === 'preserve')).toBe(true);

        // The contact is still there. This is the assertion that matters —
        // a status without it would pass for a run that reported "held" and
        // deleted anyway.
        const remaining = await db.select().from(schema.contacts)
            .where(eq(schema.contacts.tenantId, HELD_TENANT)).all();
        expect(remaining).toHaveLength(1);
    });

    it('POSITIVE CONTROL — the same subject IS erased with no hold', async () => {
        // Without this, everything above passes for an orchestrator that erases
        // nothing at all, which is exactly what a broken run looks like from
        // the outside.
        const summary = await runErasure(asAnyDb(db), {
            tenantId: FREE_TENANT, subjectEmail: SUBJECT, retentionYears: 7,
        });
        expect(summary.status).not.toBe('held');
        expect(summary.preservedCount).toBe(0);
        expect(summary.deletedCount + summary.anonymizedCount).toBeGreaterThan(0);

        const remaining = await db.select().from(schema.contacts)
            .where(eq(schema.contacts.tenantId, FREE_TENANT)).all();
        expect(remaining).toEqual([]);
    });

    it('admits and RECORDS the request rather than turning it away at the door', async () => {
        // The third state. A preservation order does not make a subject
        // erasure disappear: it enters, it is written to the append-only log
        // with its own outcome, and the exception carries the sentence the
        // subject is owed. An erasure refused at the door leaves no such row,
        // which is how "we preserved it" becomes indistinguishable from
        // "we never looked".
        const summary = await runErasure(asAnyDb(db), {
            tenantId: HELD_TENANT, subjectEmail: SUBJECT, retentionYears: 7,
            requestedBy: 'dsar:req-42', identityBasis: 'portal_dsar',
        });
        expect(summary.logId).not.toBe('');

        const log = await db.select().from(schema.erasureLog)
            .where(eq(schema.erasureLog.id, summary.logId)).get();
        expect(log?.status).toBe('held');
        expect(log?.subjectEmail).toBe(SUBJECT);
        expect(log?.requestedBy).toBe('dsar:req-42');
        expect(log?.responseNote).toMatch(/legal hold/i);

        // POSITIVE CONTROL — an ordinary run records the OTHER outcome in the
        // same place, so "held" is a distinguishable state and not the only
        // thing this log is ever able to say.
        const ordinary = await runErasure(asAnyDb(db), {
            tenantId: FREE_TENANT, subjectEmail: SUBJECT, retentionYears: 7,
        });
        const ordinaryLog = await db.select().from(schema.erasureLog)
            .where(eq(schema.erasureLog.id, ordinary.logId)).get();
        expect(ordinaryLog?.status).toBe('completed');
        expect(ordinaryLog?.responseNote).toBeNull();
    });

    it('a RELEASED hold does not preserve', async () => {
        // `releasedAt` being non-null is the sweep's entire definition of
        // inactive. If the erasure used a different definition the two paths
        // would disagree again, which is the defect this whole change exists
        // to close.
        await db.update(schema.legalHolds)
            .set({ releasedAt: new Date(), releasedBy: 'ops', releaseReason: 'Matter closed.' })
            .where(eq(schema.legalHolds.tenantId, HELD_TENANT)).run();
        const summary = await runErasure(asAnyDb(db), {
            tenantId: HELD_TENANT, subjectEmail: SUBJECT, retentionYears: 7,
        });
        expect(summary.status).not.toBe('held');
    });

    it('refuses the run when the holds table cannot be read', async () => {
        // Drop the table rather than stubbing a throw: the failure this guards
        // is a real unreadable table, and an empty result is what that looks
        // like from the outside if anyone catches the error.
        const fixture = createTestDb();
        db = fixture.db;
        await setupSchema(fixture.sqlite);
        await seedTenant(FREE_TENANT, false);
        fixture.sqlite.exec('DROP TABLE legal_holds');

        const summary = await runErasure(asAnyDb(db), {
            tenantId: FREE_TENANT, subjectEmail: SUBJECT, retentionYears: 7,
        });
        expect(summary.status).toBe('refused');
        expect(summary.deletedCount).toBe(0);

        // POSITIVE CONTROL inside the same test: the contact survives, so the
        // refusal is a refusal and not a silent completion.
        const remaining = await db.select().from(schema.contacts)
            .where(eq(schema.contacts.tenantId, FREE_TENANT)).all();
        expect(remaining).toHaveLength(1);
    });
});

describe('applySubjectErase under a legal hold', () => {
    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        await setupSchema(fixture.sqlite);
        await seedTenant(HELD_TENANT, true);
        await seedTenant(FREE_TENANT, false);
    });

    it('does not reply with a coverage disclosure for data that was preserved', async () => {
        // The existing rule this follows: a run that did not erase everything
        // does not hand back the disclosure, because the disclosure is exactly
        // what marks a request complete. A held run is the same shape with a
        // different cause — and unlike a partial run it must still ANSWER,
        // because the hold may outlast every retry the queue has.
        const reply = await applySubjectErase(db, {
            tenantId: HELD_TENANT, subjectEmail: SUBJECT,
        }, { requestedBy: 'dsar:req-42' });
        expect(reply.outcome).toBe('held');
        // `coverage` is the field that means "this is what we erased". A held
        // reply carrying one would be read as a completion.
        expect('coverage' in reply).toBe(false);
    });

    it('POSITIVE CONTROL — an unheld run DOES reply with the disclosure', async () => {
        // Without this, everything above passes for an applier that answers
        // "held" to every request, which erases nobody's data at all.
        const reply = await applySubjectErase(db, {
            tenantId: FREE_TENANT, subjectEmail: SUBJECT,
        }, { requestedBy: 'dsar:req-43' });
        expect(reply.outcome).toBe('erased');
        if (reply.outcome !== 'erased') throw new Error('unreachable');
        expect(reply.coverage).toBeDefined();
        expect(reply.coverage.executedTables).toContain('contacts');
        expect(reply.deletedCount).toBeGreaterThan(0);
    });

    it('names the preservation, because that sentence is what the subject receives', async () => {
        // Asserted on the reply's OWN field rather than anywhere in the
        // serialized payload: the decisions array already carried the phrase
        // before this change, so a `JSON.stringify(reply)` match would have
        // been green against the defect.
        const reply = await applySubjectErase(db, {
            tenantId: HELD_TENANT, subjectEmail: SUBJECT,
        }, {});
        expect(reply.outcome).toBe('held');
        if (reply.outcome !== 'held') throw new Error('unreachable');
        expect(reply.reason).toMatch(/legal hold/i);
        expect(reply.preserved).toBeGreaterThan(0);
    });

    it('POSITIVE CONTROL — a run that could not READ the holds does not reply either', async () => {
        // The third state kept apart from the second. "We preserved your data"
        // and "we could not tell whether we had to" are different answers, and
        // only one of them is safe to send: an unreadable holds table is
        // transient, so this must retry rather than tell anyone anything. A
        // held reply emitted here would announce a preservation nobody
        // established.
        const fixture = createTestDb();
        db = fixture.db;
        await setupSchema(fixture.sqlite);
        await seedTenant(FREE_TENANT, false);
        fixture.sqlite.exec('DROP TABLE legal_holds');

        await expect(applySubjectErase(db, {
            tenantId: FREE_TENANT, subjectEmail: SUBJECT,
        }, {})).rejects.toThrow(/refused|legal_holds/);
    });

    it('POSITIVE CONTROL — a partial run still refuses to reply at all', async () => {
        // The rule a held reply must not weaken. `notification_preferences` is
        // dropped so one fail-closed step throws while the rest still land: the
        // applier raises rather than returning any reply, held or erased, and
        // the command retries. If a held outcome had been implemented as
        // "return something instead of throwing", this is the assertion that
        // would go red.
        //
        // That table specifically, because it is reached ONLY from inside
        // `step()`. The envelope lookup at the top of `runErasure` is not
        // wrapped, so dropping `agreement_signers` throws straight out of the
        // orchestrator and this spec would then be asserting on the raw SQLite
        // message rather than on the applier's refusal.
        const fixture = createTestDb();
        db = fixture.db;
        await setupSchema(fixture.sqlite);
        await seedTenant(FREE_TENANT, false);
        fixture.sqlite.exec('DROP TABLE notification_preferences');

        await expect(applySubjectErase(db, {
            tenantId: FREE_TENANT, subjectEmail: SUBJECT,
        }, {})).rejects.toThrow(/subject\.erase/);
    });
});

/**
 * The reply has to survive the wire it is sent on.
 *
 * `applySubjectErase` returns a discriminated union and `emitReply` merges it
 * with the `{tenantId, correlationId, replyto}` base before it goes onto the
 * queue. `DATA_SCHEMAS['reply.subject.erased']` is the declared shape of that
 * payload — the contract portal mirrors — and nothing validates against it at
 * emit time, so a producer that outgrew its own contract does so silently and
 * is only discovered by a consumer that rejects the message.
 *
 * These specs close that by parsing what the applier ACTUALLY returned rather
 * than a hand-written literal. A fixture cannot outgrow a schema; only real
 * output can.
 */
describe('the held reply against its declared wire contract', () => {
    const wire = () => DATA_SCHEMAS['reply.subject.erased'];

    /** What `emitReply` puts on the queue: the base fields plus the reply. */
    const onTheWire = (reply: object) => ({
        tenantId: HELD_TENANT, correlationId: 'cmd-1', replyto: 'dsar:req-42', ...reply,
    });

    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        await setupSchema(fixture.sqlite);
        await seedTenant(HELD_TENANT, true);
        await seedTenant(FREE_TENANT, false);
    });

    it('a real held reply validates against the schema it is published under', async () => {
        const reply = await applySubjectErase(db, { tenantId: HELD_TENANT, subjectEmail: SUBJECT }, {});
        expect(reply.outcome).toBe('held');
        const parsed = wire().safeParse(onTheWire(reply));
        // Named, because "success: false" alone would not say which field the
        // contract and the producer disagree about.
        expect(parsed.success ? [] : parsed.error.issues.map((i) => i.path.join('.')))
            .toEqual([]);
        expect(parsed.success).toBe(true);
    });

    it('POSITIVE CONTROL — a real erased reply validates too', async () => {
        // Without this, the spec above is equally satisfied by a schema that
        // accepts anything at all.
        const reply = await applySubjectErase(db, { tenantId: FREE_TENANT, subjectEmail: SUBJECT }, {});
        expect(reply.outcome).toBe('erased');
        expect(wire().safeParse(onTheWire(reply)).success).toBe(true);
    });

    it('REJECTS an erased reply with no coverage — paired with the acceptance above', async () => {
        // The rejection and its acceptance are asserted together on purpose: a
        // schema that had been deleted, or an import that resolved to
        // `undefined`, would make every rejection here pass for the wrong
        // reason. The line above proves the subject exists and says yes.
        const reply = await applySubjectErase(db, { tenantId: FREE_TENANT, subjectEmail: SUBJECT }, {});
        if (reply.outcome !== 'erased') throw new Error('unreachable');
        const { coverage: _dropped, ...withoutCoverage } = reply;
        expect(wire().safeParse(onTheWire(withoutCoverage)).success).toBe(false);
    });

    it('REJECTS a held reply that names no preservation ground', async () => {
        // The sentence the subject is given is the whole content of a held
        // answer. A held reply without it says "we kept your data" and stops.
        const reply = await applySubjectErase(db, { tenantId: HELD_TENANT, subjectEmail: SUBJECT }, {});
        if (reply.outcome !== 'held') throw new Error('unreachable');
        const { reason: _dropped, ...withoutReason } = reply;
        expect(wire().safeParse(onTheWire(withoutReason)).success).toBe(false);
        // …and the same payload WITH the ground is accepted, so the rejection
        // is about the missing field and not about the branch as a whole.
        expect(wire().safeParse(onTheWire(reply)).success).toBe(true);
    });

    it('REJECTS an unknown outcome rather than falling through to a branch', async () => {
        const reply = await applySubjectErase(db, { tenantId: HELD_TENANT, subjectEmail: SUBJECT }, {});
        expect(wire().safeParse(onTheWire({ ...reply, outcome: 'maybe' })).success).toBe(false);
    });
});
