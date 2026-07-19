import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MessageTemplateService } from '../../../server/services/message-template.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';

// The service calls drizzle(this.db) from 'drizzle-orm/d1'; tests run on
// better-sqlite3, so mock the d1 drizzle to return the in-memory db.
vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const T1 = 'tenant-1';
const T2 = 'tenant-2';

describe('MessageTemplateService', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let sqlite: InstanceType<typeof Database>;
    let svc: MessageTemplateService;

    beforeEach(async () => {
        const fixture = createTestDb();
        testDb = fixture.db;
        sqlite = fixture.sqlite;
        await setupSchema(fixture.sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
        svc = new MessageTemplateService({} as D1Database); // {} db is never used — the mock returns testDb
    });

    it('creates and lists tenant-scoped templates', async () => {
        await svc.create(T1, { name: 'Report Ready', channel: 'email', subject: 'Ready', body: '<p>Hi {{client_name}}</p>', variables: ['client_name'] });
        await svc.create(T2, { name: 'Other', channel: 'email', body: '<p>x</p>' });
        const rows = await svc.list(T1);
        expect(rows).toHaveLength(1);
        expect(rows[0].name).toBe('Report Ready');
        expect(rows[0].variables).toEqual(['client_name']);
    });

    it('list filters by channel', async () => {
        await svc.create(T1, { name: 'E', channel: 'email', body: 'e' });
        await svc.create(T1, { name: 'S', channel: 'sms', body: 's' });
        expect(await svc.list(T1, 'sms')).toHaveLength(1);
    });

    it('does not read another tenant by id', async () => {
        const t = await svc.create(T1, { name: 'A', channel: 'email', body: 'a' });
        expect(await svc.get(T2, t.id)).toBeNull();
    });

    it('duplicate copies content, clears is_seeded, appends (Copy)', async () => {
        const t = await svc.create(T1, { name: 'A', channel: 'sms', body: 's', variables: ['x'] });
        const d = await svc.duplicate(T1, t.id);
        expect(d.id).not.toBe(t.id);
        expect(d.name).toBe('A (Copy)');
        expect(d.isSeeded).toBe(false);
        expect(d.variables).toEqual(['x']);
    });

    it('delete blocks (Conflict) when referenced by an automation', async () => {
        const t = await svc.create(T1, { name: 'Ref', channel: 'email', body: 'b' });
        // The tenant_configs table rebuild (see #181 squash) leaves PRAGMA foreign_keys=ON;
        // temporarily disable it so we can insert an automation row without seeding a tenant
        // row (this test is scoped to delete-guard logic, not FK integrity).
        sqlite.pragma('foreign_keys = OFF');
        await testDb.insert(schema.automations).values({
            id: 'auto-1', tenantId: T1, name: 'Rule', trigger: 'report.published', recipientKind: 'inspector', recipientRoleProfileId: null,
            delayMinutes: 0,
            // subjectTemplate / bodyTemplate are NOT NULL DEAD columns — empty strings satisfy the constraint.
            subjectTemplate: '', bodyTemplate: '',
            channels: '["email"]',
            active: true, isDefault: false,
            createdAt: new Date(),
            emailTemplateId: t.id,
        });
        sqlite.pragma('foreign_keys = ON');
        await expect(svc.delete(T1, t.id)).rejects.toThrow();
        const refs = await svc.referencingAutomations(T1, t.id);
        expect(refs.map((r) => r.name)).toContain('Rule');
    });

    it('delete succeeds when unreferenced', async () => {
        const t = await svc.create(T1, { name: 'Free', channel: 'email', body: 'b' });
        await svc.delete(T1, t.id);
        expect(await svc.get(T1, t.id)).toBeNull();
    });
});
