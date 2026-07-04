import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { writeAuditLogWithSlug } from '../../../server/lib/audit';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

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
            { id: TENANT, name: 'A', slug: 'a', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
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
        await writeAuditLogWithSlug({} as D1Database, { tenantId: TENANT, actorUserId: USER, action: 'inspection.created', entityType: 'inspection', entityId: 'i-1' });
        const rows = await testDb.select().from(schema.auditLogs).all();
        expect(rows.length).toBe(1);
        expect(rows[0]?.inspectorSlug).toBe('mike');
    });

    it('leaves inspector_slug NULL on user.login.success (not in allowlist)', async () => {
        await writeAuditLogWithSlug({} as D1Database, { tenantId: TENANT, actorUserId: USER, action: 'user.login.success', entityType: 'user', entityId: USER });
        const rows = await testDb.select().from(schema.auditLogs).all();
        expect(rows.length).toBe(1);
        expect(rows[0]?.inspectorSlug).toBeNull();
    });

    it('handles inspector with no slug gracefully (NULL slug)', async () => {
        await testDb.update(schema.users).set({ slug: null }).where(eq(schema.users.id, USER));
        await writeAuditLogWithSlug({} as D1Database, { tenantId: TENANT, actorUserId: USER, action: 'inspection.created', entityType: 'inspection', entityId: 'i-2' });
        const rows = await testDb.select().from(schema.auditLogs).all();
        expect(rows[0]?.inspectorSlug).toBeNull();
    });

    it('writes inspector_slug for all 6 allowlist events', async () => {
        const allowlist = ['user.slug.set', 'inspection.created', 'inspection.published', 'agreement.sent', 'invoice.sent', 'invoice.paid'];
        for (const action of allowlist) {
            await writeAuditLogWithSlug({} as D1Database, { tenantId: TENANT, actorUserId: USER, action, entityType: 'inspection', entityId: 'i-' + action });
        }
        const rows = await testDb.select().from(schema.auditLogs).all();
        expect(rows.length).toBe(6);
        for (const row of rows) {
            expect(row.inspectorSlug).toBe('mike');
        }
    });
});
