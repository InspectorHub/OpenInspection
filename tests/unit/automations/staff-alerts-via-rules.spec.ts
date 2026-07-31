/**
 * Track B3 — the internal staff alert becomes a rule like any other.
 *
 * Four call sites wrote a staff notification directly, outside the automation
 * engine: `trigger()`'s own `createForAllAdmins` (any event that produced
 * logs), the booking path, the completion path, and the agreement-signed
 * effect. Each hard-coded its own wording and none of them could be turned
 * off, renamed, translated, or seen in the Automations screen — which is what
 * Track B means by "automations as the single config surface".
 *
 * The migration has to preserve the AUDIENCE and the COVERAGE exactly, or it
 * is a silent product change: an office that gets an alert today must still
 * get one, from a rule they can now see and disable.
 *
 * `message.received` deliberately stays direct — it is a system event about a
 * conversation, not an inspection lifecycle event, and it has no inspection to
 * hang a rule on.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { and, eq } from 'drizzle-orm';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { AutomationService } from '../../../server/services/automation.service';
import { AUTOMATION_SEEDS } from '../../../server/data/automation-seeds';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';

const T = '00000000-0000-0000-0000-0000000000e1';
const INSP = '00000000-0000-0000-0000-0000000000e2';
let db: BetterSQLite3Database<typeof schema>;

beforeEach(async () => {
    const fx = createTestDb();
    db = fx.db;
    await setupSchema(fx.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);

    await db.insert(schema.tenants).values({
        id: T, name: 'Acme', slug: 'acme-b3', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    } as never);
    await seedRoleProfiles(db, T, new Date(1));
    await db.insert(schema.users).values([
        { id: 'u-owner', tenantId: T, email: 'owner@acme.com', name: 'Owner', passwordHash: 'x', role: 'owner', createdAt: new Date() },
        { id: 'u-manager', tenantId: T, email: 'mgr@acme.com', name: 'Mgr', passwordHash: 'x', role: 'manager', createdAt: new Date() },
    ] as never);
    await db.insert(schema.inspections).values({
        id: INSP, tenantId: T, propertyAddress: '9 Elm St', date: '2026-06-01',
        status: 'completed', reportStatus: 'published', paymentStatus: 'unpaid',
        createdAt: new Date(),
    } as never);
});

const staffNotices = async () =>
    db.select().from(schema.notifications).where(eq(schema.notifications.tenantId, T));

describe('staff alerts as rules (B3)', () => {
    it('seeds one staff rule for every event that used to raise a hard-coded alert', () => {
        // Coverage is the thing that must not shrink. `titleFor`'s switch named
        // six; the three call sites named three more.
        const staffTriggers = AUTOMATION_SEEDS
            .filter((s) => s.recipientKind === 'staff')
            .map((s) => s.trigger);
        for (const event of [
            'inspection.created', 'inspection.confirmed', 'inspection.cancelled',
            'report.published', 'invoice.created', 'payment.received',
            'agreement.signed', 'booking.received', 'inspection.completed',
        ]) {
            expect(staffTriggers, `no staff rule seeded for ${event}`).toContain(event);
        }
    });

    it('every staff rule is in-app only — an internal alert is not an email', () => {
        for (const seed of AUTOMATION_SEEDS.filter((s) => s.recipientKind === 'staff')) {
            expect((seed as { channels?: string[] }).channels).toEqual(['in_app']);
        }
    });

    it('a triggered event notifies the office through the rule, with no direct call left', async () => {
        const svc = new AutomationService({} as D1Database);
        await svc.trigger({
            tenantId: T, inspectionId: INSP, triggerEvent: 'report.published',
            companyName: 'Acme', reportBaseUrl: 'https://app.example.com',
        });

        const notices = await staffNotices();
        const staff = notices.filter((n) => n.userId !== null);
        // One per admin, exactly once: the old code raised a SECOND notification
        // from trigger()'s own createForAllAdmins on top of whatever the rules
        // produced, so "one each" is the assertion that the duplicate is gone.
        expect(staff.map((n) => n.userId).sort()).toEqual(['u-manager', 'u-owner']);
    });

    it('the staff notice reads from its template, not from a literal', async () => {
        const svc = new AutomationService({} as D1Database);
        await svc.trigger({
            tenantId: T, inspectionId: INSP, triggerEvent: 'report.published',
            companyName: 'Acme', reportBaseUrl: 'https://app.example.com',
        });

        const staff = (await staffNotices()).filter((n) => n.userId !== null);
        expect(staff[0]!.title).toContain('9 Elm St');
        // Seeded, so an operator can rewrite it — that is the whole point.
        const tpl = await db.select().from(schema.messageTemplates)
            .where(and(eq(schema.messageTemplates.tenantId, T), eq(schema.messageTemplates.channel, 'in_app')));
        expect(tpl.length).toBeGreaterThan(0);
    });

    it('an office that turns the rule off stops getting the alert', async () => {
        const svc = new AutomationService({} as D1Database);
        await svc.ensureSeeds(T);
        await db.update(schema.automations)
            .set({ active: false })
            .where(and(eq(schema.automations.tenantId, T), eq(schema.automations.recipientKind, 'staff')));

        await svc.trigger({
            tenantId: T, inspectionId: INSP, triggerEvent: 'report.published',
            companyName: 'Acme', reportBaseUrl: 'https://app.example.com',
        });

        const staff = (await staffNotices()).filter((n) => n.userId !== null);
        expect(staff).toHaveLength(0);
    });

    it('does not create an email template for an in-app-only rule', async () => {
        await new AutomationService({} as D1Database).ensureSeeds(T);
        const staffRules = await db.select().from(schema.automations)
            .where(and(eq(schema.automations.tenantId, T), eq(schema.automations.recipientKind, 'staff')));
        expect(staffRules.length).toBeGreaterThan(0);
        for (const r of staffRules) {
            expect(r.emailTemplateId, `${r.name} got a pointless email template`).toBeNull();
            expect(r.inAppTemplateId).not.toBeNull();
        }
    });
});
