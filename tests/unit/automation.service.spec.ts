import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AutomationService } from '../../src/services/automation.service';
import { AgreementService } from '../../src/services/agreement.service';
import { createTestDb, setupSchema } from './db';
import * as schema from '../../src/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-000000000001';
const INSP   = '00000000-0000-0000-0000-000000000010';
const AGR    = '00000000-0000-0000-0000-000000000020';

async function seedFor(testDb: BetterSQLite3Database<typeof schema>, agreementRequired: boolean) {
    await testDb.insert(schema.tenants).values([
        { id: TENANT, name: 'T', subdomain: 't', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
    ]);
    await testDb.insert(schema.inspections).values([
        { id: INSP, tenantId: TENANT, propertyAddress: '1 St', clientName: 'J', clientEmail: 'j@t.com', date: '2026-06-01', status: 'draft', paymentStatus: 'unpaid', price: 0, agreementRequired, paymentRequired: false, createdAt: new Date() },
    ]);
    await testDb.insert(schema.agreements).values([
        { id: AGR, tenantId: TENANT, name: 'Std', content: 'text', version: 1, createdAt: new Date() },
    ]);
}

describe('AutomationService.trigger — agreement filter', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let svc: AutomationService;

    beforeEach(async () => {
        const fixture = createTestDb();
        testDb = fixture.db;
        await setupSchema(fixture.sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
        const agr = new AgreementService({} as D1Database);
        svc = new AutomationService({} as D1Database, undefined, agr);
        // Stub ensureSeeds so tests verify filter logic without seed-rule pollution.
        // Tests insert their own automation rules below.
        vi.spyOn(svc, 'ensureSeeds').mockResolvedValue();
    });

    it('skips rules with {{agreement_sign_url}} when agreementRequired=false', async () => {
        await seedFor(testDb, false);
        await testDb.insert(schema.automations).values({
            id: 'rule-1', tenantId: TENANT, name: 'Send agreement', trigger: 'inspection.created',
            recipient: 'client', delayMinutes: 0,
            subjectTemplate: 'Sign here', bodyTemplate: 'Click {{agreement_sign_url}}',
            active: true, isDefault: false, createdAt: new Date(),
        });
        await svc.trigger({ tenantId: TENANT, inspectionId: INSP, triggerEvent: 'inspection.created', companyName: 'T', reportBaseUrl: 'http://localhost' });
        const logs = await testDb.select().from(schema.automationLogs).all();
        expect(logs.length).toBe(0);
    });

    it('queues rules with {{agreement_sign_url}} when agreementRequired=true', async () => {
        await seedFor(testDb, true);
        await testDb.insert(schema.automations).values({
            id: 'rule-2', tenantId: TENANT, name: 'Send agreement', trigger: 'inspection.created',
            recipient: 'client', delayMinutes: 0,
            subjectTemplate: 'Sign here', bodyTemplate: 'Click {{agreement_sign_url}}',
            active: true, isDefault: false, createdAt: new Date(),
        });
        await svc.trigger({ tenantId: TENANT, inspectionId: INSP, triggerEvent: 'inspection.created', companyName: 'T', reportBaseUrl: 'http://localhost' });
        const logs = await testDb.select().from(schema.automationLogs).all();
        expect(logs.length).toBe(1);
    });

    it('does NOT skip ordinary rules without {{agreement_sign_url}}', async () => {
        await seedFor(testDb, false);
        await testDb.insert(schema.automations).values({
            id: 'rule-3', tenantId: TENANT, name: 'Booking confirmation', trigger: 'inspection.created',
            recipient: 'client', delayMinutes: 0,
            subjectTemplate: 'Hi', bodyTemplate: 'Confirmed for {{property_address}}',
            active: true, isDefault: false, createdAt: new Date(),
        });
        await svc.trigger({ tenantId: TENANT, inspectionId: INSP, triggerEvent: 'inspection.created', companyName: 'T', reportBaseUrl: 'http://localhost' });
        const logs = await testDb.select().from(schema.automationLogs).all();
        expect(logs.length).toBe(1);
    });
});
