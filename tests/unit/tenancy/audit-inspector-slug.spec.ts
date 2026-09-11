import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { writeAuditLogWithSlug, writeAuditRow, INSPECTOR_SLUG_AUDIT_ALLOWLIST, type AuditAction } from '../../../server/lib/audit';
import { AUDIT_REGISTRY } from '../../../server/lib/audit-registry';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

/**
 * The allowlist deliberately holds names that are NOT `AuditAction` members —
 * see the comment on it in `server/lib/audit.ts`. Exercising the runtime
 * behaviour therefore needs a cast, and it is written once, here, with the
 * reason attached rather than sprinkled through the cases. The consequence of
 * that gap is asserted at the bottom of this file, so the cast documents a
 * finding instead of papering over one.
 */
const asAction = (a: string) => a as AuditAction;

const TENANT = '00000000-0000-0000-0000-000000000001';
const USER   = '00000000-0000-0000-0000-000000000010';

describe('writeAuditLogWithSlug — Sprint B-3', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let sqlite: ReturnType<typeof createTestDb>['sqlite'];

    beforeEach(async () => {
        const fixture = createTestDb();
        testDb = fixture.db;
        sqlite = fixture.sqlite;
        await setupSchema(sqlite);
        await testDb.insert(schema.tenants).values([
            { id: TENANT, slug: 'a', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
        ]);
        await testDb.insert(schema.users).values([
            { id: USER, tenantId: TENANT, email: 'mike@test.com', name: 'Mike', role: 'inspector', slug: 'mike', createdAt: new Date(), passwordHash: 'x' },
        ]);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
    });

    afterEach(() => {
        sqlite.close();
        vi.clearAllMocks();
    });

    it('writes inspector_slug on inspection.created', async () => {
        await writeAuditLogWithSlug({} as D1Database, { tenantId: TENANT, actorUserId: USER, action: asAction('inspection.created'), entityType: 'inspection', entityId: 'i-1' });
        const rows = await testDb.select().from(schema.auditLogs).all();
        expect(rows.length).toBe(1);
        expect(rows[0]?.inspectorSlug).toBe('mike');
    });

    it('leaves inspector_slug NULL on user.login.success (not in allowlist)', async () => {
        await writeAuditLogWithSlug({} as D1Database, { tenantId: TENANT, actorUserId: USER, action: asAction('user.login.success'), entityType: 'user', entityId: USER });
        const rows = await testDb.select().from(schema.auditLogs).all();
        expect(rows.length).toBe(1);
        expect(rows[0]?.inspectorSlug).toBeNull();
    });

    it('handles inspector with no slug gracefully (NULL slug)', async () => {
        await testDb.update(schema.users).set({ slug: null }).where(eq(schema.users.id, USER));
        await writeAuditLogWithSlug({} as D1Database, { tenantId: TENANT, actorUserId: USER, action: asAction('inspection.created'), entityType: 'inspection', entityId: 'i-2' });
        const rows = await testDb.select().from(schema.auditLogs).all();
        expect(rows[0]?.inspectorSlug).toBeNull();
    });

    it('writes inspector_slug for all 6 allowlist events', async () => {
        const allowlist = ['user.slug.set', 'inspection.created', 'inspection.published', 'agreement.sent', 'invoice.sent', 'invoice.paid'];
        for (const action of allowlist) {
            await writeAuditLogWithSlug({} as D1Database, { tenantId: TENANT, actorUserId: USER, action: asAction(action), entityType: 'inspection', entityId: 'i-' + action });
        }
        const rows = await testDb.select().from(schema.auditLogs).all();
        expect(rows.length).toBe(6);
        for (const row of rows) {
            expect(row.inspectorSlug).toBe('mike');
        }
    });
    /**
     * The finding this file carries, restated after `inspection.published`
     * joined the vocabulary.
     *
     * `inspector_slug` exists so an audit dashboard can group a company's events
     * by inspector. TWO things have to be true for the column to fill, and only
     * the first one now is:
     *
     *  1. an allowlisted action has to be writable at all. `inspection.published`
     *     now is — union member, `live` registry entry, emitted by the publish
     *     route. Of the rest, four are not in the union and `agreement.sent` is
     *     `in-esign-log`, so its record is the hash-chained row.
     *  2. the emitter has to reach `writeAuditLogWithSlug`. The publish route
     *     reaches `auditFromContext` → `writeAuditRow`, which does not set the
     *     column at all.
     *
     * So the column is still NULL on every row, for a DIFFERENT reason than
     * before — the writer rather than the vocabulary. Both halves are asserted
     * separately, so whichever one moves, this test names which.
     */
    it('inspection.published is writable, but the writer it uses still cannot set inspector_slug', async () => {
        const declared = [...INSPECTOR_SLUG_AUDIT_ALLOWLIST].filter((a) => a in AUDIT_REGISTRY);
        expect(INSPECTOR_SLUG_AUDIT_ALLOWLIST.size, 'the allowlist is not empty — the control').toBe(6);
        expect(declared, 'published joined the vocabulary; agreement.sent is in-esign-log').toEqual(['inspection.published', 'agreement.sent']);
        const live = declared.filter((a) => AUDIT_REGISTRY[a as AuditAction]?.status.kind === 'live');
        expect(live, 'exactly one allowlisted action is writable today').toEqual(['inspection.published']);

        // Half two, asserted behaviourally rather than described: the ordinary
        // writer is what the publish route actually uses.
        await writeAuditRow({ db: {} as D1Database, tenantId: TENANT, userId: USER, action: 'inspection.published', entityType: 'inspection', entityId: 'i-pub' });
        const rows = await testDb.select().from(schema.auditLogs).all();
        expect(rows.length, 'the control — the row itself did land').toBe(1);
        expect(rows[0]?.inspectorSlug, 'writeAuditRow never sets the column').toBeNull();
    });
});
