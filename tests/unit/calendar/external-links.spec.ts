import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    upsertLink,
    getLink,
    deleteLink,
    listOwnExternalIds,
} from '../../../server/lib/calendar/external-links';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTHER_TENANT = '00000000-0000-0000-0000-000000000002';
const USER = '00000000-0000-0000-0000-000000000010';
const OTHER_USER = '00000000-0000-0000-0000-000000000011';

describe('calendar_external_links store', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: ReturnType<typeof createTestDb>['sqlite'];

    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        sqlite = fixture.sqlite;
        await setupSchema(sqlite);
    });

    afterEach(() => sqlite.close());

    const key = {
        tenantId: TENANT,
        provider: 'google' as const,
        entityType: 'inspection' as const,
        entityId: 'insp-1',
    };

    it('records a link and reads it back', async () => {
        await upsertLink(db as AnyDb, { ...key, userId: USER, externalId: 'gcal-abc' });
        const row = await getLink(db as AnyDb, key);
        expect(row?.externalId).toBe('gcal-abc');
        expect(row?.userId).toBe(USER);
    });

    /**
     * The reason the table exists. A second push must UPDATE the same row, not
     * append: a duplicate row means the next delete leaves an orphan event on
     * someone's calendar, and the next import sees an id it no longer skips.
     */
    it('a second push for the same entity updates in place instead of adding a row', async () => {
        await upsertLink(db as AnyDb, { ...key, userId: USER, externalId: 'gcal-abc' });
        await upsertLink(db as AnyDb, { ...key, userId: USER, externalId: 'gcal-def' });

        const all = await db.select().from(schema.calendarExternalLinks).all();
        expect(all).toHaveLength(1);
        expect(all[0]!.externalId).toBe('gcal-def');
    });

    it('re-points user_id when the entity moves to another inspector', async () => {
        await upsertLink(db as AnyDb, { ...key, userId: USER, externalId: 'gcal-abc' });
        await upsertLink(db as AnyDb, { ...key, userId: OTHER_USER, externalId: 'gcal-xyz' });

        const row = await getLink(db as AnyDb, key);
        expect(row?.userId).toBe(OTHER_USER);
        expect(row?.externalId).toBe('gcal-xyz');
    });

    it('separates entity types that happen to share an id', async () => {
        await upsertLink(db as AnyDb, { ...key, userId: USER, externalId: 'from-inspection' });
        await upsertLink(db as AnyDb, {
            ...key, entityType: 'calendar_block', userId: USER, externalId: 'from-block',
        });

        expect((await getLink(db as AnyDb, key))?.externalId).toBe('from-inspection');
        expect((await getLink(db as AnyDb, { ...key, entityType: 'calendar_block' }))?.externalId)
            .toBe('from-block');
    });

    it('scopes by tenant — the same entity id in another tenant is a different link', async () => {
        await upsertLink(db as AnyDb, { ...key, userId: USER, externalId: 'mine' });
        await upsertLink(db as AnyDb, { ...key, tenantId: OTHER_TENANT, userId: USER, externalId: 'theirs' });

        expect((await getLink(db as AnyDb, key))?.externalId).toBe('mine');
        expect((await getLink(db as AnyDb, { ...key, tenantId: OTHER_TENANT }))?.externalId).toBe('theirs');
    });

    it('deletes the link on cancel, and deleting again is a no-op', async () => {
        await upsertLink(db as AnyDb, { ...key, userId: USER, externalId: 'gcal-abc' });
        await deleteLink(db as AnyDb, key);
        expect(await getLink(db as AnyDb, key)).toBeNull();
        await expect(deleteLink(db as AnyDb, key)).resolves.toBeUndefined();
    });

    it('lists this user own external ids without leaking another user rows', async () => {
        await upsertLink(db as AnyDb, { ...key, userId: USER, externalId: 'mine-1' });
        await upsertLink(db as AnyDb, {
            ...key, entityId: 'insp-2', userId: OTHER_USER, externalId: 'theirs-1',
        });

        const ids = await listOwnExternalIds(db as AnyDb, {
            tenantId: TENANT, userId: USER, provider: 'google',
        });
        expect([...ids]).toEqual(['mine-1']);
    });
});
