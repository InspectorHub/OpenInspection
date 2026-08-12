// I-2 — standalone-seed-automations.ts (the /setup raw-SQL automation seeder)
// had no coverage in any suite: the unit-test D1 stub (tests/unit/db.ts's
// toRawD1) implements only prepare/bind/run, not `.first()` or `.batch()`,
// both of which this file's write-time guard depends on. Under REAL workerd
// (vitest-pool-workers), env.DB is a genuine D1 binding that supports both, so
// this is the only suite that can exercise the file at all.
//
// Migrations are replayed for real (not hand-maintained DDL) so this also
// stands as the regression test for I-3 (automations.created_at must be
// milliseconds, not unixepoch seconds — drizzle would otherwise read it back
// as 1970) and I-4 (the write-time NOT EXISTS guard on all three statements,
// batched per row, must survive both a sequential re-run and two concurrent
// callers without double-seeding or orphaning a template).
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { and, eq } from 'drizzle-orm';
import * as schema from '../../server/lib/db/schema';
import { seedDefaultAutomations } from '../../server/lib/integration/standalone-seed-automations';
import { seedRoleProfiles } from '../../server/services/seed/seed-role-profiles';
import { applyMigrations as replayMigrations } from './migration-replay';

const b = env as unknown as { DB: D1Database };

const migrationSql = import.meta.glob('../../migrations/*.sql', {
    query: '?raw',
    import: 'default',
    eager: true,
}) as Record<string, string>;

const applyMigrations = () => replayMigrations(b.DB, migrationSql);

async function seedTenant(tenantId: string): Promise<void> {
    const db = drizzle(b.DB);
    await db.insert(schema.tenants).values({
        id: tenantId, slug: `acme-${tenantId.slice(-8)}`, status: 'active',
        deploymentMode: 'shared', tier: 'free', maxUsers: 5, createdAt: new Date(),
    });
    // PREREQUISITE (see the file's own header): role profiles resolve the
    // recipientRoleKey -> contact_role_profiles.id subquery the seeder uses.
    await seedRoleProfiles(db, tenantId, new Date());
}

describe('seedDefaultAutomations — real D1 (I-2/I-3/I-4)', () => {
    beforeAll(applyMigrations);

    it('seeds automations rows with resolved templates and millisecond timestamps', async () => {
        const tenantId = crypto.randomUUID();
        await seedTenant(tenantId);
        await seedDefaultAutomations(b.DB, tenantId);

        const db = drizzle(b.DB);
        const rules = await db.select().from(schema.automations).where(eq(schema.automations.tenantId, tenantId));
        expect(rules.length).toBeGreaterThan(0);

        const booking = rules.find(r => r.name === 'Booking Confirmation');
        expect(booking).toBeTruthy();
        expect(booking!.emailTemplateId).toBeTruthy();
        expect(booking!.smsTemplateId).toBeTruthy(); // Booking Confirmation carries an smsBody
        // I-3: createdAt must be a real, current millisecond epoch — the bug
        // this regresses stamped it in SECONDS, which drizzle (timestamp_ms)
        // reads back as 1970. A sane lower bound (the year 2020 in ms) is
        // enough to catch the seconds-as-ms failure mode without a flaky
        // exact-time assertion.
        expect(booking!.createdAt.getTime()).toBeGreaterThan(1_577_836_800_000);

        const tpl = await db.select().from(schema.messageTemplates)
            .where(eq(schema.messageTemplates.id, booking!.emailTemplateId!)).get();
        expect(tpl).toBeTruthy();
        expect(tpl!.subject).toContain('{{property_address}}');
        expect(tpl!.createdAt.getTime()).toBeGreaterThan(1_577_836_800_000);

        // A role-keyed row (client) resolved to this tenant's seeded role profile.
        expect(booking!.recipientKind).toBe('role');
        expect(booking!.recipientRoleProfileId).toBeTruthy();

        // A rule with no smsBody in the seed table gets no sms template.
        const invoiceRule = rules.find(r => r.name === 'Invoice / Payment Request');
        expect(invoiceRule!.smsTemplateId).toBeNull();
    });

    it('is idempotent — a second sequential run does not duplicate rows', async () => {
        const tenantId = crypto.randomUUID();
        await seedTenant(tenantId);
        await seedDefaultAutomations(b.DB, tenantId);
        const db = drizzle(b.DB);
        const firstCount = (await db.select().from(schema.automations).where(eq(schema.automations.tenantId, tenantId))).length;

        await seedDefaultAutomations(b.DB, tenantId);
        const secondCount = (await db.select().from(schema.automations).where(eq(schema.automations.tenantId, tenantId))).length;
        expect(secondCount).toBe(firstCount);

        // No orphaned templates either: every message_templates row for this
        // tenant is referenced by exactly the automations rows above.
        const tpls = await db.select().from(schema.messageTemplates).where(eq(schema.messageTemplates.tenantId, tenantId));
        const referencedIds = new Set(
            (await db.select().from(schema.automations).where(eq(schema.automations.tenantId, tenantId)))
                .flatMap(r => [r.emailTemplateId, r.smsTemplateId].filter((id): id is string => !!id)),
        );
        for (const t of tpls) expect(referencedIds.has(t.id)).toBe(true);
    });

    it('two concurrent callers do not double-seed (write-time guard, not a read-then-write race)', async () => {
        const tenantId = crypto.randomUUID();
        await seedTenant(tenantId);

        await Promise.all([
            seedDefaultAutomations(b.DB, tenantId),
            seedDefaultAutomations(b.DB, tenantId),
        ]);

        const db = drizzle(b.DB);
        const rules = await db.select().from(schema.automations)
            .where(and(eq(schema.automations.tenantId, tenantId), eq(schema.automations.name, 'Booking Confirmation')));
        expect(rules).toHaveLength(1);
    });
});
