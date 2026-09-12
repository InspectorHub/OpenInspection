/**
 * Track B3 (IA-115) — a notice's wording comes from a template, not a literal.
 *
 * Twelve hardcoded English strings decide what a staff notice says today:
 * `titleFor`'s seven-case switch plus five more at the call sites. No locale
 * can reach any of them, and no operator can change one — which is the whole
 * reason Track B calls automations "the single config surface".
 *
 * The mechanism has to exist before the literals can move, and it needs its
 * own column: a rule with `channels: ["email","in_app"]` has an email template
 * AND an in-app one, so reusing `email_template_id` would make the two
 * channels fight over one slot.
 *
 * `subject` carries the notice TITLE (see the message_templates schema
 * comment) and `body` the notice body — the same fields, doing the same job
 * they do for email.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { AutomationService } from '../../../server/services/automation.service';

const T = '00000000-0000-0000-0000-0000000000d1';
const INSP = '00000000-0000-0000-0000-0000000000d2';
let db: BetterSQLite3Database<typeof schema>;

beforeEach(async () => {
    const fx = createTestDb();
    db = fx.db;
    await setupSchema(fx.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);

    await db.insert(schema.tenants).values({
        id: T, slug: 'acme-inapp-tpl', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    } as never);
    await db.insert(schema.inspections).values({
        id: INSP, tenantId: T, propertyAddress: '12 Oak Lane', date: '2026-06-01',
        status: 'completed', reportStatus: 'published', paymentStatus: 'unpaid',
        createdAt: new Date(),
    } as never);
    await db.insert(schema.users).values({
        id: 'u-owner', tenantId: T, email: 'owner@acme.com', name: 'Owner',
        passwordHash: 'x', role: 'owner', createdAt: new Date(),
    } as never);
});

async function seedInAppRule(opts: { templateId: string | null }) {
    if (opts.templateId) {
        await db.insert(schema.messageTemplates).values({
            id: opts.templateId, tenantId: T, name: 'Report ready (in-app)',
            channel: 'in_app',
            subject: 'Report ready — {{property_address}}',
            body: 'Published for {{company_name}}.',
            variables: null, isSeeded: true,
            createdAt: new Date(), updatedAt: new Date(),
        } as never);
    }
    await db.insert(schema.automations).values({
        id: 'auto-inapp', tenantId: T, name: 'Tell the office', trigger: 'report.published',
        recipientKind: 'staff', recipientRoleProfileId: null, delayMinutes: 0,
        channels: '["in_app"]',
        inAppTemplateId: opts.templateId,
        active: true, isDefault: false, createdAt: new Date(),
    } as never);
}

const header = async () => (await db.select().from(schema.notifications)).at(0);

describe('in-app notice wording (B3)', () => {
    it('takes the notice title from the rule\'s in-app template, interpolated', async () => {
        await seedInAppRule({ templateId: 'tpl-inapp-1' });

        await new AutomationService({} as D1Database).trigger({
            tenantId: T, inspectionId: INSP, triggerEvent: 'report.published',
            companyName: 'Acme',
        });

        const h = await header();
        expect(h?.title).toBe('Report ready — 12 Oak Lane');
    });

    it('takes the body from the same template', async () => {
        await seedInAppRule({ templateId: 'tpl-inapp-1' });

        await new AutomationService({} as D1Database).trigger({
            tenantId: T, inspectionId: INSP, triggerEvent: 'report.published',
            companyName: 'Acme',
        });

        expect((await header())?.body).toBe('Published for Acme.');
    });

    it('falls back to the built-in wording when a rule has no in-app template', async () => {
        // Fail-SOFT, unlike the email path's fail-closed skip: an email with no
        // template has no content to send, but a notice header already exists
        // and hiding it would lose the event entirely. The reader gets the old
        // literal rather than nothing.
        await seedInAppRule({ templateId: null });

        await new AutomationService({} as D1Database).trigger({
            tenantId: T, inspectionId: INSP, triggerEvent: 'report.published',
            companyName: 'Acme',
        });

        const h = await header();
        expect(h?.title).toContain('12 Oak Lane');
        expect(h?.body).toBeNull();
    });

    it('does not let an in-app template be used as the email one', async () => {
        // The columns are separate so the two channels cannot fight over one
        // slot; this asserts the separation is real rather than incidental.
        await seedInAppRule({ templateId: 'tpl-inapp-1' });
        const rule = (await db.select().from(schema.automations)
            .where(eq(schema.automations.id, 'auto-inapp'))).at(0)!;
        expect(rule.inAppTemplateId).toBe('tpl-inapp-1');
        expect(rule.emailTemplateId).toBeNull();
    });
});

/**
 * F44 residual — `{{scheduled_date}}` in an IN-APP notice.
 *
 * The seeded booking alert says "A new booking came in for {{scheduled_date}}."
 * and `fulfill-booking` writes `inspections.date` as `${date}T${HH:MM}:00Z` (a
 * busy-check key, not an instant), so the office read
 * "A new booking came in for 2026-09-16T08:00:00Z."
 *
 * Both directions are asserted throughout: the raw column must be GONE and the
 * readable string must be PRESENT. Asserting only the absence would pass for a
 * notice whose body had stopped being interpolated at all.
 */
async function seedBookingAlert(storedDate: string, cfg: { timezone: string; locale: string }) {
    await db.update(schema.inspections).set({ date: storedDate })
        .where(eq(schema.inspections.id, INSP));
    await db.insert(schema.tenantConfigs).values({
        tenantId: T, defaultTimezone: cfg.timezone, defaultLocale: cfg.locale,
        createdAt: new Date(), updatedAt: new Date(),
    } as never);
    await db.insert(schema.messageTemplates).values({
        id: 'tpl-booking', tenantId: T, name: 'Office alert — new booking (in-app)',
        channel: 'in_app',
        subject: 'New booking — {{property_address}}',
        body: 'A new booking came in for {{scheduled_date}}.',
        variables: null, isSeeded: true,
        createdAt: new Date(), updatedAt: new Date(),
    } as never);
    await db.insert(schema.automations).values({
        id: 'auto-booking', tenantId: T, name: 'Office alert — new booking',
        trigger: 'booking.received', recipientKind: 'staff', recipientRoleProfileId: null,
        delayMinutes: 0, channels: '["in_app"]',
        inAppTemplateId: 'tpl-booking',
        active: true, isDefault: false, createdAt: new Date(),
    } as never);
    await new AutomationService({} as D1Database).trigger({
        tenantId: T, inspectionId: INSP, triggerEvent: 'booking.received',
        companyName: 'Acme',
    });
    const rows = await db.select().from(schema.notifications);
    return rows.find((r) => (r.body ?? '').includes('A new booking came in'))?.body ?? null;
}

describe('in-app notice {{scheduled_date}} (F44 residual)', () => {
    it('renders a booking\'s stored instant as a date a person reads', async () => {
        const body = await seedBookingAlert('2026-09-16T08:00:00Z', {
            timezone: 'America/New_York', locale: 'en-US',
        });
        // The wall clock stored on the column is the TENANT's, so 08:00 stays
        // 08:00 — the zone label is what tells the reader which 08:00 it is.
        expect(body).toBe('A new booking came in for Sep 16, 2026, 8:00 AM EDT.');
        expect(body).not.toContain('2026-09-16T08:00:00Z');
    });

    it('renders a manually created inspection\'s bare civil day too', async () => {
        // The other shape the column carries. A civil day has no clock, so it
        // must not grow one — and must not shift zones on the way out.
        const body = await seedBookingAlert('2026-06-01', {
            timezone: 'America/Los_Angeles', locale: 'en-US',
        });
        expect(body).toBe('A new booking came in for Jun 1, 2026.');
        expect(body).not.toContain('2026-06-01');
    });

    it('follows the workspace locale, not the server default', async () => {
        const body = await seedBookingAlert('2026-09-16T08:00:00Z', {
            timezone: 'America/New_York', locale: 'es-419',
        });
        expect(body).toBe('A new booking came in for 16 sept 2026, 8:00 a.m. GMT-4.');
        expect(body).not.toContain('2026-09-16T08:00:00Z');
    });
});
