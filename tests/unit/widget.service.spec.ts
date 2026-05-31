import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WidgetService } from '../../src/services/widget.service';
import { createTestDb, setupSchema } from './db';
import { tenants, tenantConfigs, auditLogs } from '../../src/lib/db/schema';
import * as schema from '../../src/lib/db/schema';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

describe('WidgetService.isOriginAllowed', () => {
    let svc: WidgetService;
    let testDb: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const setup = createTestDb();
        testDb = setup.db;
        await setupSchema(setup.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        svc = new WidgetService({} as any);

        await testDb.insert(tenants).values({
            id: TENANT_ID, name: 'T', subdomain: 't', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await testDb.insert(tenantConfigs).values({
            tenantId: TENANT_ID,
            widgetAllowedOrigins: ['https://acme.com', 'https://*.acme-staging.com'],
            updatedAt: new Date(),
        });
    });

    it('returns true for exact origin match', async () => {
        expect(await svc.isOriginAllowed(TENANT_ID, 'https://acme.com')).toBe(true);
    });

    it('returns true for wildcard subdomain match', async () => {
        expect(await svc.isOriginAllowed(TENANT_ID, 'https://shop.acme-staging.com')).toBe(true);
        expect(await svc.isOriginAllowed(TENANT_ID, 'https://api.acme-staging.com')).toBe(true);
    });

    it('returns false for non-matching origin', async () => {
        expect(await svc.isOriginAllowed(TENANT_ID, 'https://attacker.com')).toBe(false);
    });

    it('returns false when allowlist is empty/null', async () => {
        const setup2 = createTestDb();
        await setupSchema(setup2.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(setup2.db);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const svc2 = new WidgetService({} as any);
        const otherTenant = '00000000-0000-0000-0000-000000000002';
        await setup2.db.insert(tenants).values({
            id: otherTenant, name: 'T2', subdomain: 't2', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await setup2.db.insert(tenantConfigs).values({ tenantId: otherTenant, updatedAt: new Date() });
        expect(await svc2.isOriginAllowed(otherTenant, 'https://acme.com')).toBe(false);
    });

    it('returns false for missing tenant config', async () => {
        expect(await svc.isOriginAllowed('00000000-0000-0000-0000-000000000099', 'https://anything.com')).toBe(false);
    });

    it('returns false for protocol mismatch (http vs https)', async () => {
        expect(await svc.isOriginAllowed(TENANT_ID, 'http://acme.com')).toBe(false);
    });

    it('returns false for port mismatch', async () => {
        expect(await svc.isOriginAllowed(TENANT_ID, 'https://acme.com:8080')).toBe(false);
    });
});

describe('WidgetService.recordEvent', () => {
    it('writes an audit_logs row with widget.{event} action', async () => {
        const setup = createTestDb();
        await setupSchema(setup.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(setup.db);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const svc = new WidgetService({} as any);

        await setup.db.insert(tenants).values({
            id: TENANT_ID, name: 'T', subdomain: 't', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });

        await svc.recordEvent(TENANT_ID, 'view', { origin: 'https://acme.com' });

        const rows = await setup.db.select().from(auditLogs).where(eq(auditLogs.tenantId, TENANT_ID));
        expect(rows).toHaveLength(1);
        expect(rows[0].action).toBe('widget.view');
        expect(rows[0].metadata).toMatchObject({ origin: 'https://acme.com' });
    });
});
