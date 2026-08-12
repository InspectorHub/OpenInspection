import { describe, it, expect, beforeEach } from 'vitest';
import { vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { backfillAutomationTemplates } from '../../../server/services/message-template-backfill';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const T = 'tenant-1';

// The dead automations.subject_template/body_template/sms_body columns are
// gone, so backfillAutomationTemplates now recovers copy ONLY from the
// AUTOMATION_SEEDS entry matching (name, trigger) — there is nothing left on
// the row itself to override. Picking the real 'Report Ready' seed here (name
// AND trigger both match) means the email/sms assertions below check against
// that seed's actual text, not a custom fixture string.
async function seedAuto(testDb: BetterSQLite3Database<typeof schema>, over: Partial<typeof schema.automations.$inferInsert> = {}) {
    await testDb.insert(schema.automations).values({
        id: over.id ?? 'a1', tenantId: T, name: over.name ?? 'Report Ready',
        trigger: 'report.published', recipientKind: 'inspector', recipientRoleProfileId: null, delayMinutes: 0,
        channels: over.channels ?? '["email","sms"]',
        active: true, isDefault: true, createdAt: new Date(), ...over,
    });
}

describe('backfillAutomationTemplates', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    beforeEach(async () => {
        const fixture = createTestDb();
        testDb = fixture.db;
        await setupSchema(fixture.sqlite);
        fixture.sqlite.pragma('foreign_keys = OFF');   // FK is ON by default (baseline migration); these tests insert automations without a tenants row
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
    });

    it('creates seeded email + sms templates and sets the ids', async () => {
        await seedAuto(testDb);
        const { created } = await backfillAutomationTemplates({} as D1Database, T);
        expect(created).toBe(2);
        const a = await testDb.select().from(schema.automations).where(eq(schema.automations.id, 'a1')).get();
        expect(a!.emailTemplateId).toBeTruthy();
        expect(a!.smsTemplateId).toBeTruthy();
        const tpls = await testDb.select().from(schema.messageTemplates).where(eq(schema.messageTemplates.tenantId, T));
        const email = tpls.find((t) => t.channel === 'email')!;
        expect(email.isSeeded).toBe(true);
        expect(email.name).toBe('Report Ready — Email');
        expect(email.subject).toBe('Your inspection report is ready — {{property_address}}');
        expect(JSON.parse(email.variables!)).toEqual(expect.arrayContaining(['property_address', 'client_name', 'report_url']));
        const sms = tpls.find((t) => t.channel === 'sms')!;
        expect(sms.name).toBe('Report Ready — SMS');
        expect(sms.subject).toBeNull();
    });

    it('is idempotent — a second run creates nothing and keeps the same ids', async () => {
        await seedAuto(testDb);
        await backfillAutomationTemplates({} as D1Database, T);
        const before = await testDb.select().from(schema.automations).where(eq(schema.automations.id, 'a1')).get();
        const second = await backfillAutomationTemplates({} as D1Database, T);
        expect(second.created).toBe(0);
        const after = await testDb.select().from(schema.automations).where(eq(schema.automations.id, 'a1')).get();
        expect(after!.emailTemplateId).toBe(before!.emailTemplateId);
        const tpls = await testDb.select().from(schema.messageTemplates).where(eq(schema.messageTemplates.tenantId, T));
        expect(tpls).toHaveLength(2);
    });

    it('email-only automation gets only an email template', async () => {
        await seedAuto(testDb, { id: 'a2', name: 'Payment Received', channels: '["email"]' });
        const { created } = await backfillAutomationTemplates({} as D1Database, T);
        expect(created).toBe(1);
        const a = await testDb.select().from(schema.automations).where(eq(schema.automations.id, 'a2')).get();
        expect(a!.smsTemplateId).toBeNull();
    });
});
