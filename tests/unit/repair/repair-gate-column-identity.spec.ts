/**
 * WHICH tenant_configs column gates the repair-builder — pinned behaviourally.
 *
 * `tenant_configs` carries two similarly-named booleans:
 *
 *   is_repair_list_enabled            (`tenantConfigs.enableRepairList`)
 *   is_customer_repair_export_enabled (`tenantConfigs.enableCustomerRepairExport`)
 *
 * Only the SECOND one gates anything. `runBuilderGate` refuses on it, and
 * `PortalService.hubOverview` reports it as `repairRequestEnabled` so the Hub
 * cannot advertise a tab the API would refuse. The first one reached no
 * renderer at all: the "View Repair List" button that was supposed to read it
 * pointed at a page route that never existed (see the IA-68 note in
 * `app/components/portal/sections/report/ReportHeader.tsx`) and was removed, so
 * the column is drained and awaiting a DROP COLUMN migration.
 *
 * A walkthrough entry has already recorded the wrong one of the two — it named
 * `is_repair_list_enabled` as the Hub's gate, inferred from the name rather than
 * from the enforcement point. Nothing in the suite could contradict it, because
 * nothing asserted which column the gate reads. This spec is that assertion, and
 * it is written behaviourally rather than by matching a column name string: each
 * case writes the two columns to OPPOSITE values through real SQL, so a gate
 * reading the other one gives the other answer.
 *
 * ⚠️ Every case sets both columns. Setting only the one under test passes just as
 * greenly against code that reads either.
 *
 * When the DROP COLUMN migration lands, `enableRepairList` disappears from the
 * Drizzle schema and the two `enableRepairList:` lines below stop compiling.
 * Delete them; the remaining assertions still pin the gate to its own column.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { createTestDb, setupSchema } from '../db';
import { toD1Binding } from '../helpers/d1-binding';
import { runBuilderGate } from '../../../server/lib/repair-gates';
import { PortalService } from '../../../server/services/portal.service';
import { WRITABLE_TENANT_CONFIG_COLUMNS } from '../../../server/lib/tenant-config-write-policy';
import { inspections, tenantConfigs, tenants } from '../../../server/lib/db/schema';
import type { HonoConfig } from '../../../server/types/hono';

const TENANT = 'tenant-repair-gate';
const INSPECTION = 'insp-repair-gate';

type ObserveProgressStub = ConstructorParameters<typeof PortalService>[1];

/** The progress lookup is a display value behind its own try/catch in
 *  hubOverview, and nothing here asserts on it. Throwing keeps it out of the
 *  way without pretending this fixture models section progress. */
const NO_PROGRESS: ObserveProgressStub = {
    getSectionProgress: () => Promise.reject(new Error('not exercised by this spec')),
};

let binding: D1Database;
let db: ReturnType<typeof createTestDb>['db'];

/** Writes BOTH report-feature columns, so each case states the full truth. */
async function setFlags(flags: { enableRepairList: boolean; enableCustomerRepairExport: boolean }) {
    await db
        .update(tenantConfigs)
        .set(flags)
        .where(eq(tenantConfigs.tenantId, TENANT));
}

/**
 * Drives `runBuilderGate` through a real Hono context over the real D1-shaped
 * binding, and reports what a caller would see: `null` (the gate let the request
 * through) or the refusal's error code.
 */
async function gateAnswer(): Promise<'PASSED' | string> {
    const app = new Hono<HonoConfig>();
    app.get('/gate', async (c) => {
        // F77 — the gate also asks whether the report is held for a signed
        // agreement or an outstanding payment. Null = nothing held back, which
        // keeps these cases about WHICH COLUMN gates the builder; the hold has
        // its own spec (public-report-release-gate).
        c.set('services', {
            inspection: { resolveReleaseGate: async () => null },
        } as unknown as HonoConfig['Variables']['services']);
        const refusal = await runBuilderGate(c, INSPECTION, TENANT);
        if (!refusal) return c.json({ gate: 'PASSED' });
        return refusal;
    });
    const res = await app.request('/gate', {}, { DB: binding });
    const body = await res.json() as { gate?: string; error?: { code?: string } };
    return body.gate === 'PASSED' ? 'PASSED' : (body.error?.code ?? `HTTP_${res.status}`);
}

beforeEach(async () => {
    const fix = createTestDb();
    db = fix.db;
    await setupSchema(fix.sqlite);
    binding = toD1Binding(fix.sqlite);

    await db.insert(tenants).values({
        id: TENANT,
        slug: 'repair-gate-co',
        createdAt: new Date(),
    });
    await db.insert(inspections).values({
        id: INSPECTION,
        tenantId: TENANT,
        propertyAddress: '1 Gate Street',
        date: '2026-09-11',
        status: 'completed',
        reportStatus: 'published',
        createdAt: new Date(),
    });
    await db.insert(tenantConfigs).values({
        tenantId: TENANT,
        enableRepairList: false,
        enableCustomerRepairExport: false,
        updatedAt: new Date(),
    });
});

describe('the repair-builder gate reads is_customer_repair_export_enabled', () => {
    it('refuses when only is_repair_list_enabled is on', async () => {
        await setFlags({ enableRepairList: true, enableCustomerRepairExport: false });
        expect(await gateAnswer()).toBe('FORBIDDEN');
    });

    // POSITIVE CONTROL. Without it, a gate that refused unconditionally — or one
    // broken by the fixture rather than by the flag — would satisfy the case above.
    it('allows when only is_customer_repair_export_enabled is on', async () => {
        await setFlags({ enableRepairList: false, enableCustomerRepairExport: true });
        expect(await gateAnswer()).toBe('PASSED');
    });
});

describe('the Hub tab reads the same column the gate enforces', () => {
    it('reports repairRequestEnabled false when only is_repair_list_enabled is on', async () => {
        await setFlags({ enableRepairList: true, enableCustomerRepairExport: false });
        const overview = await new PortalService(binding, NO_PROGRESS).hubOverview(TENANT, INSPECTION);
        expect(overview).not.toBeNull();
        expect(overview?.repairRequestEnabled).toBe(false);
    });

    it('reports repairRequestEnabled true when only is_customer_repair_export_enabled is on', async () => {
        await setFlags({ enableRepairList: false, enableCustomerRepairExport: true });
        const overview = await new PortalService(binding, NO_PROGRESS).hubOverview(TENANT, INSPECTION);
        expect(overview?.repairRequestEnabled).toBe(true);
    });
});

describe('is_repair_list_enabled is drained — no request may set it again', () => {
    /**
     * The writable set is DERIVED from the request schemas (see
     * `server/lib/tenant-config-write-policy.ts`), so a column leaves it by
     * leaving `UpdateBrandingSchema` — which is the drain. Asserting the set
     * rather than the schema is deliberate: the set is what `writeConfig`
     * actually consults.
     */
    it('does not accept enableRepairList', () => {
        expect(WRITABLE_TENANT_CONFIG_COLUMNS.has('enableRepairList')).toBe(false);
    });

    // POSITIVE CONTROL: the surviving flag is still writable, so this is not
    // passing because the allowlist is empty or misspelled.
    it('still accepts enableCustomerRepairExport', () => {
        expect(WRITABLE_TENANT_CONFIG_COLUMNS.has('enableCustomerRepairExport')).toBe(true);
    });
});
