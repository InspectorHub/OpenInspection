/**
 * The constraint that decided the table's shape.
 *
 * The obvious design is a nullable `user_id` and a nullable `contact_id` with a
 * rule that exactly one is set. It does not work: SQLite treats NULLs as
 * DISTINCT in a unique index, so a row with `user_id = NULL` never conflicts
 * with another row with `user_id = NULL`. The constraint meant to guarantee one
 * answer per (who, what, how) would silently admit duplicates — and a duplicate
 * here is two contradictory answers with no rule for which one wins.
 *
 * `subject_kind` + `subject_id`, both NOT NULL, make the index hold. These
 * tests are what says so.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';

const TENANT = 't-prefs';

let db: BetterSQLite3Database<typeof schema>;
let sqlite: { close: () => void };

beforeEach(async () => {
    const fx = createTestDb();
    db = fx.db as BetterSQLite3Database<typeof schema>;
    sqlite = fx.sqlite;
    await setupSchema(fx.sqlite);
});
afterEach(() => sqlite.close());

const row = (over: Partial<schema.NewNotificationPreference> = {}) => ({
    id: 'np-1', tenantId: TENANT, subjectKind: 'contact' as const, subjectId: 'c1',
    classId: 'booking-confirmation', channel: 'email' as const, enabled: false,
    createdAt: new Date(), updatedAt: new Date(), ...over,
});

describe('notification_preferences — one answer per (subject, class, channel)', () => {
    it('rejects a second answer for the same subject, class and channel', async () => {
        await db.insert(schema.notificationPreferences).values(row());
        await expect(
            db.insert(schema.notificationPreferences).values(row({ id: 'np-2', enabled: true })),
        ).rejects.toThrow(/UNIQUE/i);
    });

    it('keeps the two id spaces apart — a user and a contact may share an id string', async () => {
        // `subject_kind` is part of the key, not a label. `users.id` and
        // `contacts.id` are independent id spaces and can collide.
        await db.insert(schema.notificationPreferences).values(row());
        await db.insert(schema.notificationPreferences).values(
            row({ id: 'np-2', subjectKind: 'user' }),
        );
        const all = await db.select().from(schema.notificationPreferences).all();
        expect(all).toHaveLength(2);
    });

    it('allows the same class on a different channel', async () => {
        await db.insert(schema.notificationPreferences).values(row());
        await db.insert(schema.notificationPreferences).values(row({ id: 'np-2', channel: 'sms' }));
        expect(await db.select().from(schema.notificationPreferences).all()).toHaveLength(2);
    });

    it('scopes to the tenant — the same contact id in another tenant is another subject', async () => {
        await db.insert(schema.notificationPreferences).values(row());
        await db.insert(schema.notificationPreferences).values(row({ id: 'np-2', tenantId: 't-other' }));
        expect(await db.select().from(schema.notificationPreferences).all()).toHaveLength(2);
    });
});
