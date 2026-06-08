import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as schema from '../../server/lib/db/schema';
import { createTestDb, setupSchema } from './db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { AutomationService } from '../../server/services/automation.service';

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

describe('AutomationService create/update — conditions + channel (Track J)', () => {
    it('serializes conditions to JSON and defaults channel to email', async () => {
        const row = await svc.create(TENANT, {
            name: 'Follow-up', trigger: 'report.published', recipient: 'client',
            delayMinutes: 1440, subjectTemplate: 's', bodyTemplate: 'b',
            conditions: { requirePaid: true, serviceIds: ['svc-1'] },
        });
        expect(row.channel).toBe('email');
        expect(JSON.parse(row.conditions!)).toEqual({ requirePaid: true, serviceIds: ['svc-1'] });
    });

    it('update can clear conditions and set channel', async () => {
        const created = await svc.create(TENANT, {
            name: 'R', trigger: 'report.published', recipient: 'client',
            delayMinutes: 0, subjectTemplate: 's', bodyTemplate: 'b',
            conditions: { requireSigned: true },
        });
        const updated = await svc.update(TENANT, created.id, { conditions: null, channel: 'sms' });
        expect(updated.conditions).toBeNull();
        expect(updated.channel).toBe('sms');
    });
});
