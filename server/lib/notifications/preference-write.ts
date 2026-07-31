import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { notificationPreferences } from '../db/schema';
import { defaultEnabled, isSuppressible, notificationClass, type Audience } from './classes';
import { classesFor } from './screen-model';
import { Errors } from '../errors';

/**
 * What a preference screen is allowed to write, and how.
 *
 * Two surfaces write these rows — the account screen (staff and agent) and the
 * client portal — and a third will exist the moment someone adds one. The
 * refusals below are what keep the SCREEN honest: the send boundary is what
 * makes a preference true, so a route that accepts a change the boundary would
 * ignore is worse than one that says no. Duplicating four `if`s per surface is
 * how the two would come to disagree, and the disagreement would be invisible
 * — nobody reports mail they did not receive.
 */

export interface PreferenceWrite {
    tenantId: string;
    subjectKind: 'user' | 'contact';
    subjectId: string;
    classId: string;
    channel: 'email' | 'sms' | 'in_app';
    enabled: boolean;
}

/**
 * Refuse anything the send boundary would not honour, for this reader.
 *
 * Ordering is deliberate: unknown class first (nothing else can be checked
 * without it), then required, then the channel, then the audience. Each throws
 * a 400 with a sentence a reader could act on rather than a code.
 */
export function assertChoosable(classId: string, channel: string, audience: Audience): void {
    const cls = notificationClass(classId);
    if (!cls) throw Errors.BadRequest('Unknown notification.');
    if (!isSuppressible(classId)) throw Errors.BadRequest('This notification is always sent.');
    if (!cls.channels.includes(channel as 'email' | 'sms' | 'in_app')) {
        throw Errors.BadRequest('This notification is not sent on that channel.');
    }
    // A class this reader is never addressed by cannot take effect for them, and
    // the row would be one they can neither see nor clear — nothing renders it.
    if (!cls.audience.includes(audience) || cls.recipientFacing === false) {
        throw Errors.BadRequest('This notification is not addressed to you.');
    }
}

/**
 * Persist one choice.
 *
 * STORE ONLY WHAT DIFFERS FROM THE CLASS DEFAULT; matching it deletes the row.
 * Stated that way rather than as "delete on enable" because one class defaults
 * to OFF (`agent-invoice-paid`, whose column defaulted to false and whose
 * default moved across with the data), and there the row is what expresses
 * "yes, send me this". The consequence is §3.2's: the table grows with the
 * decisions people make, not with the number of people.
 */
export async function writeChoice(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: any,
    w: PreferenceWrite,
): Promise<void> {
    const where = and(
        eq(notificationPreferences.tenantId, w.tenantId),
        eq(notificationPreferences.subjectKind, w.subjectKind),
        eq(notificationPreferences.subjectId, w.subjectId),
        eq(notificationPreferences.classId, w.classId),
        eq(notificationPreferences.channel, w.channel),
    );

    // Unconditional delete first, so a repeated mute leaves one row rather than
    // a second one the unique index would have to catch.
    await db.delete(notificationPreferences).where(where).run();
    if (w.enabled === defaultEnabled(w.classId)) return;

    const now = new Date();
    await db.insert(notificationPreferences).values({
        id: nanoid(), tenantId: w.tenantId, subjectKind: w.subjectKind, subjectId: w.subjectId,
        classId: w.classId, channel: w.channel, enabled: w.enabled, createdAt: now, updatedAt: now,
    }).run();
}

/** The explicit choices one subject holds, as `${classId}:${channel}` → enabled. */
export async function readChoices(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: any,
    tenantId: string,
    subjectKind: 'user' | 'contact',
    subjectId: string,
): Promise<Map<string, boolean>> {
    const rows = await db.select({
        classId: notificationPreferences.classId,
        channel: notificationPreferences.channel,
        enabled: notificationPreferences.enabled,
    }).from(notificationPreferences)
        .where(and(
            eq(notificationPreferences.tenantId, tenantId),
            eq(notificationPreferences.subjectKind, subjectKind),
            eq(notificationPreferences.subjectId, subjectId),
        )).all();
    return new Map(rows.map((r: { classId: string; channel: string; enabled: boolean }) =>
        [`${r.classId}:${r.channel}`, r.enabled]));
}

/**
 * A bulk change, scoped the way the GRID is scoped.
 *
 * The screen is notifications x channels, so the useful bulk actions are the
 * ones that match its shape: one row (every channel of one notification), one
 * column (one channel across every notification), or the corner (everything).
 * Three loose buttons above the table would have made the reader work out which
 * cells each one touched; a control that sits ON the row or column says it.
 */
export interface BulkChange {
    /** `reset` DELETES the rows in scope so each falls back to its default. */
    action: 'enable' | 'disable' | 'reset';
    /** Limit to one channel (a column). */
    channel?: 'email' | 'sms' | 'in_app' | undefined;
    /** Limit to one notification (a row). */
    classId?: string | undefined;
}

/**
 * Apply one bulk change to the cells this reader can actually choose.
 *
 * `reset` is NOT `enable`, and the difference is load-bearing: reset deletes
 * rows so every class returns to its own default — and one class defaults to
 * OFF (`agent-invoice-paid`, whose column defaulted to false). Treating them as
 * synonyms would silently switch that one on.
 *
 * The cells it touches come from `classesFor(audience)` intersected with each
 * class's own channel list, so a bulk change can never reach a class this
 * reader is not addressed by, a class that is always sent, or a channel the
 * class never uses — the three refusals `assertChoosable` makes one at a time,
 * made structural instead. A row's `unavailable` cells are skipped rather than
 * switched on, which is the whole reason the em dash is not a control.
 */
export async function applyBulk(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: any,
    subject: { tenantId: string; subjectKind: 'user' | 'contact'; subjectId: string },
    audience: Audience,
    change: BulkChange,
): Promise<number> {
    const targets = classesFor(audience)
        .filter((c) => !c.required)
        .filter((c) => !change.classId || c.id === change.classId)
        .flatMap((c) => c.channels
            .filter((ch) => !change.channel || ch === change.channel)
            .map((ch) => ({ cls: c, channel: ch })));

    if (change.action === 'reset') {
        // Delete only the cells in scope, so resetting one row leaves the rest
        // of the reader's decisions alone.
        for (const t of targets) {
            await db.delete(notificationPreferences).where(and(
                eq(notificationPreferences.tenantId, subject.tenantId),
                eq(notificationPreferences.subjectKind, subject.subjectKind),
                eq(notificationPreferences.subjectId, subject.subjectId),
                eq(notificationPreferences.classId, t.cls.id),
                eq(notificationPreferences.channel, t.channel),
            )).run();
        }
        return 0;
    }

    const enabled = change.action === 'enable';
    let written = 0;
    for (const t of targets) {
        await writeChoice(db, { ...subject, classId: t.cls.id, channel: t.channel, enabled });
        // `writeChoice` stores only what differs from the default, so this
        // counts the DECISIONS recorded, not the switches moved.
        if (enabled !== defaultEnabled(t.cls.id)) written++;
    }
    return written;
}
