/**
 * Track B2 — a rule can address the STAFF of the workspace.
 *
 * Every recipient kind that exists today resolves to a `contacts` row on the
 * inspection. But the five hard-coded call sites B3 has to migrate
 * (booking.received, report.published, agreement.signed, payment.received,
 * message.received) all notify the tenant's owners and managers — `users`
 * rows, addressed by `createForAllAdmins`. Without a staff kind those call
 * sites cannot become rules at all, which is why this lands before B3 rather
 * than inside it.
 *
 * The consequence that is easy to get wrong: a staff recipient is a USER, so
 * its notice header must land on `user_id`, not `contact_id`. C1 asserts the
 * XOR, so getting this wrong is not a subtle mislabel — it throws. The
 * inspector kind already had this property and encoded it as a hard-coded
 * `roleKey === 'inspector'` string comparison in the header writer; a second
 * kind with the same property is exactly when that becomes a shared rule
 * instead of a repeated literal.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { AutomationService } from '../../../server/services/automation.service';
import { isStaffRecipient, STAFF_ROLE_KEY } from '../../../server/services/automation/shared';
import { createHeadersForInsertedLogs } from '../../../server/services/automation/notice-headers';

const T = '00000000-0000-0000-0000-0000000000c1';
const OTHER_T = '00000000-0000-0000-0000-0000000000c2';
const INSP = '00000000-0000-0000-0000-0000000000c3';
let db: BetterSQLite3Database<typeof schema>;

const user = (id: string, role: string, tenantId: string | null, email: string) => ({
    id, tenantId, email, name: id, passwordHash: 'x', role, createdAt: new Date(),
});

beforeEach(async () => {
    const fx = createTestDb();
    db = fx.db;
    await setupSchema(fx.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);

    await db.insert(schema.tenants).values([
        { id: T, slug: 'acme-staff', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
        { id: OTHER_T, slug: 'other-staff', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
    ] as never);
    await db.insert(schema.users).values([
        user('u-owner', 'owner', T, 'owner@acme.com'),
        user('u-manager', 'manager', T, 'manager@acme.com'),
        user('u-inspector', 'inspector', T, 'inspector@acme.com'),
        user('u-other-owner', 'owner', OTHER_T, 'owner@other.com'),
        // A global agent: tenant_id IS NULL, and NOT staff of anyone.
        user('u-agent', 'agent', null, 'agent@x.com'),
    ] as never);
    await db.insert(schema.inspections).values({
        id: INSP, tenantId: T, propertyAddress: '1 Main St', date: '2026-06-01',
        status: 'completed', reportStatus: 'published', paymentStatus: 'unpaid',
        createdAt: new Date(),
    } as never);
});

const insp = async () =>
    (await db.select().from(schema.inspections).where(eq(schema.inspections.id, INSP))).at(0)!;

describe('staff recipients (B2)', () => {
    it('resolves to the workspace owners and managers', async () => {
        const svc = new AutomationService({} as D1Database);
        const out = await svc.resolveRecipients(
            { recipientKind: 'staff', recipientRoleProfileId: null },
            (await insp()) as never,
            'in_app',
        );
        expect(out.map((r) => r.contactId).sort()).toEqual(['u-manager', 'u-owner']);
    });

    it('never reaches another workspace, and never an inspector or an agent', async () => {
        const svc = new AutomationService({} as D1Database);
        const out = await svc.resolveRecipients(
            { recipientKind: 'staff', recipientRoleProfileId: null },
            (await insp()) as never,
            'in_app',
        );
        const ids = out.map((r) => r.contactId);
        // The owner of ANOTHER tenant is the leak that matters here: `role`
        // alone would match them.
        expect(ids).not.toContain('u-other-owner');
        // An inspector is staff of the company but not an ADMIN — the set this
        // kind names is the one createForAllAdmins names, so the five call
        // sites B3 migrates keep their audience exactly.
        expect(ids).not.toContain('u-inspector');
        // A global agent carries no tenant at all and is addressed as a
        // CONTACT in each workspace (IA-104), never as staff.
        expect(ids).not.toContain('u-agent');
    });

    it('excludes a closed account — a soft-deleted owner is not a recipient', async () => {
        await db.insert(schema.users).values(
            { ...user('u-gone', 'owner', T, 'gone@acme.com'), deletedAt: new Date() } as never,
        );
        const svc = new AutomationService({} as D1Database);
        const out = await svc.resolveRecipients(
            { recipientKind: 'staff', recipientRoleProfileId: null },
            (await insp()) as never,
            'in_app',
        );
        expect(out.map((r) => r.contactId)).not.toContain('u-gone');
    });

    it('resolveAddress has no honest single answer for staff, so it gives none', async () => {
        // The reminder path asks for ONE address. Picking an arbitrary admin
        // would be a silent wrong-recipient bug; returning null enqueues
        // nothing, which is visible and safe.
        const svc = new AutomationService({} as D1Database);
        const addr = await svc.resolveAddress('staff', null, 'email', (await insp()) as never, db as never);
        expect(addr).toBeNull();
    });

    it('marks its recipients as staff, so the notice header lands on user_id', async () => {
        const svc = new AutomationService({} as D1Database);
        const out = await svc.resolveRecipients(
            { recipientKind: 'staff', recipientRoleProfileId: null },
            (await insp()) as never,
            'in_app',
        );
        expect(out.every((r) => isStaffRecipient(r.roleKey))).toBe(true);
    });

    it('a staff log produces a header on the user side of the XOR', async () => {
        await db.insert(schema.automationLogs).values({
            id: 'log-staff-1', tenantId: T, automationId: null, inspectionId: INSP,
            recipient: 'owner@acme.com', recipientRoleKey: STAFF_ROLE_KEY,
            recipientContactId: 'u-owner', channel: 'in_app',
            sendAt: new Date(0), status: 'pending',
        } as never);

        await createHeadersForInsertedLogs(
            db,
            { tenantId: T, inspectionId: INSP, triggerEvent: 'report.published' },
            async () => ({ title: 'Report published', body: null }),
            // No class: this fixture exercises the XOR, not the preference gate.
            () => undefined,
            // No tenant config seeded here, so the resolver would answer 'en'
            // anyway; stubbing it keeps this fixture about the XOR.
            async () => 'en',
            [{ id: 'log-staff-1', automationId: null, sendAt: new Date(0), recipientContactId: 'u-owner', recipientRoleKey: STAFF_ROLE_KEY }],
        );

        const header = (await db.select().from(schema.notifications)).at(0)!;
        expect(header.userId).toBe('u-owner');
        expect(header.contactId).toBeNull();
    });

    it('an inspector is still a user too — one rule, not two literals', () => {
        expect(isStaffRecipient('inspector')).toBe(true);
        expect(isStaffRecipient(STAFF_ROLE_KEY)).toBe(true);
        expect(isStaffRecipient('client')).toBe(false);
        expect(isStaffRecipient('buyer_agent')).toBe(false);
        expect(isStaffRecipient(null)).toBe(false);
    });
});
