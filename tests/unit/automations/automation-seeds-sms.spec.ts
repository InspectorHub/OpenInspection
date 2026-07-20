import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { and, eq } from 'drizzle-orm';
import { backfillAutomationTemplates } from '../../../server/services/message-template-backfill';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { AutomationService } from '../../../server/services/automation.service';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';

const TENANT = '00000000-0000-0000-0000-000000000001';
let db: BetterSQLite3Database<typeof schema>;

beforeEach(async () => {
    const fx = createTestDb();
    db = fx.db; await setupSchema(fx.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    await db.insert(schema.tenants).values({
        id: TENANT, name: 'Acme', slug: 'acme', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    // Spec 2 Task 0 — ensureSeeds now resolves each seed's recipientRoleKey to a
    // per-tenant contact_role_profiles.id and SKIPS a rule whose role isn't
    // seeded yet, so role profiles must exist before ensureSeeds runs.
    await seedRoleProfiles(db, TENANT, new Date(1));
});

describe('Track L seeds', () => {
    it('touchpoint seeds default to email-only channels; disclosure v1 seeded', async () => {
        const svc = new AutomationService({} as D1Database);
        await svc.ensureSeeds(TENANT);
        const booking = await db.select().from(schema.automations)
            .where(and(eq(schema.automations.tenantId, TENANT), eq(schema.automations.name, 'Booking Confirmation'))).get();
        expect(JSON.parse(booking!.channels)).toEqual(['email']);
        const disc = await db.select().from(schema.smsDisclosureVersions).get();
        expect(disc?.version).toBe(1);
    });

    // automations.sms_body is a DEAD column (see automation.schema.ts comment) —
    // never read at send time. The delivered TCPA disclosure text lives in the
    // referenced message_templates row (sms_template_id), which is only backfilled
    // once the automation's channels actually include 'sms'. Assert against that
    // interpolated body, not the dead column (mirrors automation-flush-sms.spec.ts's
    // "resolves the referenced sms template body" pattern).
    it('once SMS channel is enabled, the backfilled message_templates body carries the TCPA "Reply STOP" disclosure', async () => {
        const svc = new AutomationService({} as D1Database);
        await svc.ensureSeeds(TENANT);
        const booking = await db.select().from(schema.automations)
            .where(and(eq(schema.automations.tenantId, TENANT), eq(schema.automations.name, 'Booking Confirmation'))).get();
        expect(booking?.smsTemplateId).toBeNull(); // not backfilled while channel is email-only

        // Tenant enables the SMS channel for this touchpoint.
        await db.update(schema.automations)
            .set({ channels: JSON.stringify(['email', 'sms']) })
            .where(eq(schema.automations.id, booking!.id));
        await backfillAutomationTemplates({} as D1Database, TENANT);

        const updated = await db.select().from(schema.automations)
            .where(eq(schema.automations.id, booking!.id)).get();
        expect(updated?.smsTemplateId).toBeTruthy();
        const tmpl = await db.select().from(schema.messageTemplates)
            .where(eq(schema.messageTemplates.id, updated!.smsTemplateId!)).get();
        expect(tmpl?.channel).toBe('sms');
        expect(tmpl?.body).toContain('{{company_name}}');
        expect(tmpl?.body).toMatch(/Reply STOP/);
    });
    it('is idempotent (second ensureSeeds adds no duplicate disclosure)', async () => {
        const svc = new AutomationService({} as D1Database);
        await svc.ensureSeeds(TENANT);
        await svc.ensureSeeds(TENANT);
        const discs = await db.select().from(schema.smsDisclosureVersions).all();
        expect(discs.length).toBe(1);
    });
});
