/**
 * Row, column and grid actions.
 *
 * The screen is notifications x channels, so these are the shapes a reader can
 * batch. Two things need pinning and neither is obvious from the call site:
 * that a bulk change cannot reach cells the single-cell route would refuse, and
 * that `reset` is not a synonym for `enable`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

// eslint-disable-next-line import/order
import { applyBulk } from '../../../server/lib/notifications/preference-write';
// eslint-disable-next-line import/order
import { classesFor } from '../../../server/lib/notifications/screen-model';
// eslint-disable-next-line import/order
import { defaultEnabled } from '../../../server/lib/notifications/classes';

const TENANT = 't-bulk';
const SUBJECT = { tenantId: TENANT, subjectKind: 'user' as const, subjectId: 'u1' };

let db: BetterSQLite3Database<typeof schema>;
let sqlite: { close: () => void };

beforeEach(async () => {
    const fx = createTestDb();
    db = fx.db as BetterSQLite3Database<typeof schema>;
    sqlite = fx.sqlite;
    await setupSchema(fx.sqlite);
});
afterEach(() => sqlite.close());

const rows = () => db.select().from(schema.notificationPreferences).all();

describe('bulk preference changes', () => {
    it('turns off every choosable cell an AGENT has — storing only what differs', async () => {
        await applyBulk(db, SUBJECT, 'agent', { action: 'disable' });

        // One FEWER row than there are cells: `agent-invoice-paid` already
        // defaults to off, so switching it off matches the default and stores
        // nothing (§3.2). This is the storage rule, not an off-by-one.
        const cells = classesFor('agent')
            .filter((c) => !c.required)
            .reduce((n, c) => n + c.channels.length, 0);
        const defaultOff = classesFor('agent')
            .filter((c) => !c.required && !defaultEnabled(c.id))
            .reduce((n, c) => n + c.channels.length, 0);
        expect(defaultOff).toBeGreaterThan(0);

        expect(await rows()).toHaveLength(cells - defaultOff);
        expect((await rows()).every((r) => r.enabled === false)).toBe(true);
    });

    it('never touches a notification that is always sent', async () => {
        await applyBulk(db, SUBJECT, 'agent', { action: 'disable' });
        const ids = new Set((await rows()).map((r) => r.classId));
        expect(ids.has('agent-login-link')).toBe(false);
        expect(ids.has('password-reset')).toBe(false);
    });

    it('never writes a channel the notification does not use', async () => {
        // The em dash is not a control, so a column action must skip it rather
        // than switch it on — otherwise a row would carry a preference behind a
        // cell the screen renders as a dash.
        await applyBulk(db, SUBJECT, 'agent', { action: 'disable', channel: 'sms' });
        for (const r of await rows()) {
            const cls = classesFor('agent').find((c) => c.id === r.classId)!;
            expect(cls.channels).toContain('sms');
        }
    });

    it('never reaches a class this audience is not addressed by', async () => {
        await applyBulk(db, SUBJECT, 'client', { action: 'disable' });
        const ids = new Set((await rows()).map((r) => r.classId));
        expect(ids.has('agent-new-referral')).toBe(false);
    });

    it('limits a column action to that column', async () => {
        await applyBulk(db, SUBJECT, 'client', { action: 'disable', channel: 'email' });
        expect((await rows()).every((r) => r.channel === 'email')).toBe(true);
    });

    it('limits a row action to that row', async () => {
        await applyBulk(db, SUBJECT, 'agent', { action: 'disable', classId: 'agent-new-referral' });
        expect((await rows()).every((r) => r.classId === 'agent-new-referral')).toBe(true);
    });

    it('RESET is not ENABLE — it clears rows, and one class defaults to off', async () => {
        // The whole reason the two are separate verbs. `agent-invoice-paid`
        // defaults to OFF, so "enable everything" must store a row for it while
        // "reset" must remove that row and leave the class silent.
        await applyBulk(db, SUBJECT, 'agent', { action: 'enable' });
        const paid = (await rows()).filter((r) => r.classId === 'agent-invoice-paid');
        expect(paid).toHaveLength(1);
        expect(paid[0].enabled).toBe(true);

        await applyBulk(db, SUBJECT, 'agent', { action: 'reset' });
        expect(await rows()).toHaveLength(0);
    });

    it('ENABLE stores nothing for classes that already default to on', async () => {
        // §3.2 — a row that merely restates the default makes the table grow
        // with the user base instead of with the decisions.
        await applyBulk(db, SUBJECT, 'agent', { action: 'enable', classId: 'agent-new-referral' });
        expect(await rows()).toHaveLength(0);
    });

    it('resets only the cells in scope, leaving the rest of the decisions alone', async () => {
        await applyBulk(db, SUBJECT, 'agent', { action: 'disable' });
        const before = (await rows()).length;

        await applyBulk(db, SUBJECT, 'agent', { action: 'reset', classId: 'agent-new-referral' });
        const after = await rows();
        expect(after.length).toBeLessThan(before);
        expect(after.some((r) => r.classId === 'agent-new-referral')).toBe(false);
        expect(after.some((r) => r.classId === 'agent-report-ready')).toBe(true);
    });
});
