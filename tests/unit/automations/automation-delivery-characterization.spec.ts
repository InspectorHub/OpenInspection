// apps/openinspection/tests/unit/automation-delivery-characterization.spec.ts
//
// SP2 Task 8 — Delivery characterization test.
//
// Asserts that after the SP2 template-decoupling refactor the email subject +
// HTML produced by AutomationService.flush() for the seeded "Report Ready" rule
// are byte-identical to interpolating the original AUTOMATION_SEEDS body with
// the same variable map that delivery builds. This is a pure-regression guard:
// no source changes should be needed for it to pass.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { AutomationService } from '../../../server/services/automation.service';
import { AUTOMATION_SEEDS } from '../../../server/data/automation-seeds';
import { interpolate } from '../../../server/services/automation/shared';
import { reportUrl } from '../../../server/lib/public-urls';
import type { EmailService } from '../../../server/services/email.service';

const T = '00000000-0000-0000-0000-0000000000a8';
let db: BetterSQLite3Database<typeof schema>;

beforeEach(async () => {
    const fx = createTestDb();
    db = fx.db;
    await setupSchema(fx.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);

    // Seed tenant first (FK ordering: tenant must exist before inspection).
    await db.insert(schema.tenants).values({
        id: T, name: 'Acme Inspections', slug: 'acme', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    } as never);
});

describe('SP2 delivery characterization — Report Ready output unchanged after decoupling', () => {
    it('Report Ready email subject + HTML are byte-identical to seed-body interpolation', async () => {
        // Seed inspection row (child of tenant above).
        const inspId = '00000000-0000-0000-0000-0000000000b1';
        await db.insert(schema.inspections).values({
            id: inspId, tenantId: T, propertyAddress: '1 Main St',
            clientName: 'Jane', clientEmail: 'client@example.com',
            date: '2026-06-01', status: 'completed',
            reportStatus: 'published', paymentStatus: 'unpaid',
            price: 50000, agreementRequired: false, paymentRequired: false,
            createdAt: new Date(),
        } as never);

        // Construct service — the vi.mock above redirects drizzle(d1) to in-memory db.
        const svc = new AutomationService({} as D1Database);

        // ensureSeeds inserts AUTOMATION_SEEDS rules AND (as the Task 5 hook) calls
        // backfillAutomationTemplates so every rule gets an emailTemplateId pointing
        // to a message_templates row whose body == the embedded seed body.
        await svc.ensureSeeds(T);

        // Find the Report Ready rule by name.
        const rule = (await db.select().from(schema.automations)
            .where(eq(schema.automations.tenantId, T)))
            .find(a => a.name === 'Report Ready');
        expect(rule).toBeDefined();

        // Insert one pending email log for this inspection.
        await db.insert(schema.automationLogs).values({
            id: 'log-chartest-1', tenantId: T,
            automationId: rule!.id, inspectionId: inspId,
            recipient: 'client@example.com', channel: 'email',
            sendAt: new Date(0), status: 'pending',
        } as never);

        // Capture what EmailService.sendEmail receives.
        let captured: { subject: string; html: string } | null = null;
        const emailFor = async (_tid: string) => ({
            sendEmail: async (_to: string[], subject: string, html: string) => {
                captured = { subject, html };
                return { delivered: true };
            },
        } as unknown as EmailService);

        await svc.flush(emailFor, 'Acme Inspections', 'https://app.example.com');

        // Build the expected var map — must match buildBaseTemplateVars exactly.
        // delivery.ts derives appHost via new URL(appBaseUrl).host = 'app.example.com'.
        const appHost = 'app.example.com';
        const vars: Record<string, string> = {
            client_name:          'Jane',
            property_address:     '1 Main St',
            scheduled_date:       '2026-06-01',
            report_url:           reportUrl(appHost, 'acme', inspId),
            company_name:         'Acme Inspections',
            // Extra vars delivery adds for the email path — harmless for Report Ready
            // since the template doesn't reference them, but they must be present so
            // interpolate() produces the same result for any future template that does.
            inspector_name:       '',
            invoice_url:          'https://app.example.com/invoices',
            payment_url:          'https://app.example.com/invoices',
            event_type_name:      '',
            event_scheduled_at:   '',
            event_inspector_name: '',
        };

        const seed = AUTOMATION_SEEDS.find(s => s.name === 'Report Ready')!;
        expect(captured).not.toBeNull();
        // THE LOAD-BEARING ASSERTION: delivery output == seed-body interpolation.
        expect(captured!.subject).toBe(interpolate(seed.subjectTemplate, vars));
        expect(captured!.html).toBe(interpolate(seed.bodyTemplate, vars));
    });
});

