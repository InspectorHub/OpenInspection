/**
 * Spec 2 Task 3 — recipient-keyed automation-log idempotency for
 * `report.published`. `trigger()` stamps a deterministic dedup eventId
 * (`auto:report.published:<inspId>`) ONLY for `report.published` rules, and
 * the insert uses `.onConflictDoNothing()` against the partial unique index
 * `uq_automation_logs_event` (now `(automation_id, inspection_id, event_id,
 * channel, recipient)`). A retry/double-publish must therefore write exactly
 * one log per (rule, recipient, channel) — not duplicates — while a
 * multi-recipient rule still gets its distinct rows, and non-report triggers
 * (which keep eventId NULL) are unaffected (the partial index doesn't cover
 * them, so re-firing still produces duplicate logs, unchanged from today).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { AutomationService } from '../../../server/services/automation.service';
import { PeopleService } from '../../../server/services/people.service';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';

const TENANT = '00000000-0000-0000-0000-00000000ide0';
const roleProfileId = (key: string) => `crp_${TENANT}_${key}`;

let db: BetterSQLite3Database<typeof schema>;
let svc: AutomationService;

beforeEach(async () => {
    const fx = createTestDb();
    db = fx.db;
    await setupSchema(fx.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    await db.insert(schema.tenants).values({
        id: TENANT, name: 'Acme', slug: 'acme-ide0', status: 'active', phone: '+15550001111',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    } as never);
    await seedRoleProfiles(db, TENANT, new Date(1));
    svc = new AutomationService({} as D1Database);
    vi.spyOn(svc, 'ensureSeeds').mockResolvedValue();
});

async function seedInspection(id: string, over: Partial<typeof schema.inspections.$inferInsert> = {}) {
    await db.insert(schema.inspections).values({
        id, tenantId: TENANT, propertyAddress: '1 Main',
        date: '2026-07-01', status: 'completed', reportStatus: 'published',
        paymentStatus: 'unpaid', price: 0, agreementRequired: false, paymentRequired: false,
        createdAt: new Date(), ...over,
    } as never);
}

async function addContact(id: string, fields: { name: string; email?: string | null; phone?: string | null; type?: 'client' | 'agent' }) {
    await db.insert(schema.contacts).values({
        id, tenantId: TENANT, type: fields.type ?? 'client', name: fields.name,
        email: fields.email ?? null, phone: fields.phone ?? null, createdAt: new Date(),
    } as never);
}

const people = () => new PeopleService({ DB: {} as D1Database });

async function logsFor(automationId: string, inspectionId: string) {
    return (await db.select().from(schema.automationLogs)
        .where(eq(schema.automationLogs.inspectionId, inspectionId)).all())
        .filter((l) => l.automationId === automationId);
}

describe('AutomationService.trigger — report.published idempotency (Spec 2 Task 3)', () => {
    it('report.published × all, 2 email recipients, fired TWICE: exactly 2 rows (not 4), each with the deterministic dedup eventId', async () => {
        const insp = 'insp-idem-twice';
        await seedInspection(insp);
        await addContact('c-client-idem', { name: 'Jane Client', email: 'jane-idem@example.com' });
        await addContact('c-listing-idem', { name: 'Listing Agent', email: 'listing-idem@example.com', type: 'agent' });
        await people().addPerson(TENANT, insp, 'c-client-idem', roleProfileId('client'));
        await people().addPerson(TENANT, insp, 'c-listing-idem', roleProfileId('listing_agent'));
        const created = await svc.create(TENANT, {
            name: 'R-all-idem', trigger: 'report.published', recipientKind: 'all',
            recipientRoleProfileId: null, delayMinutes: 0,
            channels: ['email'],
        });
        const ctx = { tenantId: TENANT, inspectionId: insp, triggerEvent: 'report.published',
            companyName: 'Acme', reportBaseUrl: 'https://acme.example.com' };

        await svc.trigger(ctx);
        await svc.trigger(ctx); // simulate retry / double-publish

        const logs = await logsFor(created.id, insp);
        expect(logs).toHaveLength(2);
        for (const log of logs) {
            expect(log.eventId).toBe(`auto:report.published:${insp}`);
        }
        const byRole = Object.fromEntries(logs.map((l) => [l.recipientRoleKey, l.recipient]));
        expect(byRole.client).toBe('jane-idem@example.com');
        expect(byRole.listing_agent).toBe('listing-idem@example.com');
    });

    it('report.published × all, 2 email recipients, fired ONCE: 2 distinct rows (dedup does not collapse distinct recipients)', async () => {
        const insp = 'insp-idem-once';
        await seedInspection(insp);
        await addContact('c-client-once', { name: 'Jane Client', email: 'jane-once@example.com' });
        await addContact('c-listing-once', { name: 'Listing Agent', email: 'listing-once@example.com', type: 'agent' });
        await people().addPerson(TENANT, insp, 'c-client-once', roleProfileId('client'));
        await people().addPerson(TENANT, insp, 'c-listing-once', roleProfileId('listing_agent'));
        const created = await svc.create(TENANT, {
            name: 'R-all-once', trigger: 'report.published', recipientKind: 'all',
            recipientRoleProfileId: null, delayMinutes: 0,
            channels: ['email'],
        });
        await svc.trigger({ tenantId: TENANT, inspectionId: insp, triggerEvent: 'report.published',
            companyName: 'Acme', reportBaseUrl: 'https://acme.example.com' });

        const logs = await logsFor(created.id, insp);
        expect(logs).toHaveLength(2);
    });

    it('a NON-report trigger (inspection.created) fired twice keeps eventId NULL and is NOT deduped (unchanged non-report semantics)', async () => {
        const insp = 'insp-idem-nonreport';
        await seedInspection(insp, { status: 'scheduled', reportStatus: 'not_started' } as never);
        await addContact('c-client-nr', { name: 'Jane Client', email: 'jane-nr@example.com' });
        await people().addPerson(TENANT, insp, 'c-client-nr', roleProfileId('client'));
        const created = await svc.create(TENANT, {
            name: 'R-created', trigger: 'inspection.created', recipientKind: 'role',
            recipientRoleProfileId: roleProfileId('client'), delayMinutes: 0,
            channels: ['email'],
        });
        const ctx = { tenantId: TENANT, inspectionId: insp, triggerEvent: 'inspection.created',
            companyName: 'Acme', reportBaseUrl: 'https://acme.example.com' };

        await svc.trigger(ctx);
        await svc.trigger(ctx); // fired twice — no dedup key for this event

        const logs = await logsFor(created.id, insp);
        // Non-report triggers keep eventId NULL, which the partial unique index
        // does not constrain — re-firing still produces a duplicate row per
        // recipient (today's non-idempotent behavior, intentionally unchanged).
        expect(logs).toHaveLength(2);
        for (const log of logs) {
            expect(log.eventId).toBeNull();
        }
    });
});
