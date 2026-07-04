import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EmailTemplateService } from '../../../server/services/email-template.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT_1 = '00000000-0000-0000-0000-000000000001';
const TENANT_2 = '00000000-0000-0000-0000-000000000002';

async function seedTenants(testDb: BetterSQLite3Database<typeof schema>) {
    await testDb.insert(schema.tenants).values([
        { id: TENANT_1, name: 'Tenant One', slug: 't1', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
        { id: TENANT_2, name: 'Tenant Two', slug: 't2', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
    ]);
}

describe('EmailTemplateService', () => {
    let svc: EmailTemplateService;
    let testDb: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fixture = createTestDb();
        testDb = fixture.db;
        await setupSchema(fixture.sqlite);
        await seedTenants(testDb);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
        svc = new EmailTemplateService({} as D1Database);
    });

    it('listForTenant returns [] when nothing saved', async () => {
        expect(await svc.listForTenant(TENANT_1)).toEqual([]);
    });

    it('upsert then listForTenant returns the override', async () => {
        await svc.upsert(TENANT_1, 'report-ready', { subject: 'S', blocks: { body: 'B' }, enabled: true }, 1000);
        const list = await svc.listForTenant(TENANT_1);
        expect(list).toHaveLength(1);
        expect(list[0]).toMatchObject({ trigger: 'report-ready', subject: 'S', blocks: { body: 'B' }, enabled: true });
    });

    it('upsert is idempotent (updates existing row)', async () => {
        await svc.upsert(TENANT_1, 'report-ready', { subject: 'A', blocks: null, enabled: true }, 1000);
        await svc.upsert(TENANT_1, 'report-ready', { subject: 'B', blocks: null, enabled: false }, 2000);
        const list = await svc.listForTenant(TENANT_1);
        expect(list).toHaveLength(1);
        expect(list[0].subject).toBe('B');
        expect(list[0].enabled).toBe(false);
    });

    it('remove deletes the override', async () => {
        await svc.upsert(TENANT_1, 'report-ready', { subject: 'A', blocks: null, enabled: true }, 1000);
        await svc.remove(TENANT_1, 'report-ready');
        expect(await svc.listForTenant(TENANT_1)).toEqual([]);
    });

    it('scopes by tenant', async () => {
        await svc.upsert(TENANT_1, 'report-ready', { subject: 'A', blocks: null, enabled: true }, 1000);
        expect(await svc.listForTenant(TENANT_2)).toEqual([]);
    });
});
