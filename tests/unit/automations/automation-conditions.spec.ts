import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { AutomationService } from '../../../server/services/automation.service';

const TENANT = '00000000-0000-0000-0000-000000000001';
let db: BetterSQLite3Database<typeof schema>;
let svc: AutomationService;

beforeEach(async () => {
    const fx = createTestDb();
    db = fx.db;
    await setupSchema(fx.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    await db.insert(schema.tenants).values({
        id: TENANT, name: 'Acme', slug: 'acme', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    svc = new AutomationService({} as D1Database);
});

describe('AutomationService create/update — conditions + channels (Track J/L)', () => {
    it('serializes conditions to JSON and defaults channels to email-only', async () => {
        const row = await svc.create(TENANT, {
            name: 'Follow-up', trigger: 'report.published', recipient: 'client',
            delayMinutes: 1440, subjectTemplate: 's', bodyTemplate: 'b',
            conditions: { requirePaid: true, serviceIds: ['svc-1'] },
        });
        // Track L (Part A) — channels parsed on output; conditions stays a JSON string.
        expect(row.channels).toEqual(['email']);
        expect(JSON.parse(row.conditions!)).toEqual({ requirePaid: true, serviceIds: ['svc-1'] });
    });

    it('update can clear conditions and change channels', async () => {
        const created = await svc.create(TENANT, {
            name: 'R', trigger: 'report.published', recipient: 'client',
            delayMinutes: 0, subjectTemplate: 's', bodyTemplate: 'b',
            conditions: { requireSigned: true },
        });
        const updated = await svc.update(TENANT, created.id, {
            conditions: null, channels: ['email', 'sms'], smsBody: 'hi',
        });
        expect(updated.conditions).toBeNull();
        expect(updated.channels).toEqual(['email', 'sms']);
    });
});

