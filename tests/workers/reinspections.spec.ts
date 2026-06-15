// #119 Task 7 — end-to-end re-inspection scenario under REAL workerd
// (vitest-pool-workers). Proves the carry-forward chain across re-inspection
// rounds: a published baseline → round 1 (carry 5 defects, resolve 3) →
// round 2 (pre-checks the 2 still-open items) → the public report renders only
// the carried items, each tracing its `original` to the ROOT original defect.
//
// Harness note: copied verbatim from tests/workers/report-amendments.spec.ts
// (#120). The schema is seeded by replaying the real migration .sql files
// against the isolated per-test D1 (so the #119 columns added by migration
// 0028 — source_inspection_id / root_inspection_id / reinspection_round and
// tenant_configs.reinspection_statuses — are present without hand-maintained
// DDL). Services reach the product code DIRECTLY against the `env.DB` D1
// binding; the PUBLIC report route is exercised through its real Hono handler
// (publicReportRoutes mounted at /api/public) with the real InspectionService +
// PortalAccessService injected as c.var.services. A persistent portal token is
// minted via PortalAccessService.issueToken so the public route resolves the
// tenant from the token exactly as production does (never the URL :tenant).
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { drizzle } from 'drizzle-orm/d1';
import { and, eq } from 'drizzle-orm';
import * as schema from '../../server/lib/db/schema';
import { ReportVersionService } from '../../server/services/report-version.service';
import { InspectionService } from '../../server/services/inspection.service';
import { PortalAccessService } from '../../server/services/portal-access.service';
import publicReportRoutes from '../../server/api/public-report';
import type { HonoConfig } from '../../server/types/hono';

const b = env as unknown as { DB: D1Database };
const KEY_SECRET = 'test-key-encryption-secret-0123456789';

// Replay every migration .sql exactly as production applies them. Vite (the
// pool's bundler) inlines the file bodies via import.meta.glob ?raw.
const migrationSql = import.meta.glob('../../migrations/*.sql', {
    query: '?raw',
    import: 'default',
    eager: true,
}) as Record<string, string>;

async function applyMigrations(): Promise<void> {
    const files = Object.keys(migrationSql).sort();
    for (const file of files) {
        const sql = migrationSql[file]!;
        for (const stmt of sql.split('--> statement-breakpoint')) {
            const cleaned = stmt
                .split('\n')
                .filter((line) => !line.trim().startsWith('--'))
                .join(' ')
                .replace(/\s+/g, ' ')
                .trim();
            if (cleaned) await b.DB.exec(cleaned);
        }
    }
}

function reportVersionService(): ReportVersionService {
    return new ReportVersionService(b.DB, KEY_SECRET);
}
function inspectionService(): InspectionService {
    return new InspectionService(b.DB);
}
function portalAccessService(): PortalAccessService {
    return new PortalAccessService(b.DB, { jwtSecret: KEY_SECRET });
}

/** Public report app: the real route handler + real services over real D1. */
function reportApp() {
    const app = new OpenAPIHono<HonoConfig>();
    app.use('*', async (c, next) => {
        c.set('services', {
            inspection: inspectionService(),
            portalAccess: portalAccessService(),
        } as unknown as HonoConfig['Variables']['services']);
        await next();
    });
    app.route('/api/public', publicReportRoutes);
    return app;
}

async function fetchPublicReport(tenantSlug: string, inspectionId: string, token: string) {
    const res = await reportApp().request(
        `/api/public/report/${tenantSlug}/${inspectionId}?token=${encodeURIComponent(token)}`,
        {},
        b as unknown as Record<string, unknown>,
    );
    return res;
}

// A 3-level rating system on the template snapshot so getReinspectCandidates'
// defect/monitor bucket logic + getReportData's chips resolve. The shape is the
// raw rating_systems.levels[] payload (bucket / abbr / order) that
// mapRatingSystemLevels consumes — NOT the already-mapped RatingLevel shape.
const RATING_LEVELS = [
    { id: 'satisfactory', label: 'Satisfactory', abbr: 'SAT', color: '#22c55e', bucket: 'satisfactory', order: 0 },
    { id: 'monitor', label: 'Monitor', abbr: 'MON', color: '#f59e0b', bucket: 'monitor', order: 1 },
    { id: 'defect', label: 'Defect', abbr: 'DEF', color: '#f43f5e', bucket: 'defect', order: 2 },
];

/** Build a template snapshot whose items use plain ids (same keys the results
 *  data + the snapshot .data are keyed by — getReportData looks up
 *  resultData[item.id]). */
function templateSnapshot(itemIds: string[]) {
    return JSON.stringify({
        schemaVersion: 2,
        ratingSystem: { levels: RATING_LEVELS },
        sections: [{
            id: 'general',
            title: 'General',
            items: itemIds.map((id) => ({ id, label: `Item ${id}`, type: 'rich' })),
        }],
    });
}

async function seedTenant(tenantId: string, slug: string): Promise<void> {
    const db = drizzle(b.DB);
    await db.insert(schema.tenants).values({
        id: tenantId, name: 'Acme', slug, status: 'active',
        deploymentMode: 'shared', tier: 'free', maxUsers: 5, createdAt: new Date(),
    });
}

/** Seed an inspector user (inspections.inspector_id is an FK to users.id). */
async function seedInspector(tenantId: string, userId: string): Promise<void> {
    const db = drizzle(b.DB);
    await db.insert(schema.users).values({
        id: userId, tenantId, email: `${userId}@example.com`, passwordHash: 'x',
        name: 'Inspector', role: 'inspector', createdAt: new Date(),
    });
}

/**
 * Seed a baseline inspection + its inspection_results.data + a templateSnapshot,
 * then publish it (snapshotOnPublish → report_versions v1 with .data = items).
 * `items` maps itemId → the result entry stored in inspection_results.data
 * (e.g. { rating, notes }).
 */
async function seedPublishedBaseline(
    tenantId: string,
    inspectionId: string,
    items: Record<string, { rating?: string; notes?: string }>,
): Promise<void> {
    const db = drizzle(b.DB);
    const itemIds = Object.keys(items);
    await db.insert(schema.inspections).values({
        id: inspectionId, tenantId, propertyAddress: '123 Birch Lane', date: '2026-06-01',
        status: 'completed', reportStatus: 'published', paymentStatus: 'unpaid', price: 0,
        paymentRequired: false, agreementRequired: false, createdAt: new Date(),
        templateSnapshot: templateSnapshot(itemIds) as never,
        templateSnapshotVersion: 1,
    });
    await db.insert(schema.inspectionResults).values({
        id: crypto.randomUUID(), tenantId, inspectionId,
        data: items as unknown as object,
        lastSyncedAt: new Date(),
    });
    await reportVersionService().snapshotOnPublish(tenantId, inspectionId, 'user-publisher');
}

/** Read the parsed inspection_results.data for an inspection. */
async function readResultsData(tenantId: string, inspectionId: string): Promise<Record<string, { original?: { rating?: string | null; notes?: string | null }; followupStatus?: string | null }>> {
    const db = drizzle(b.DB);
    const row = await db.select().from(schema.inspectionResults)
        .where(and(eq(schema.inspectionResults.tenantId, tenantId), eq(schema.inspectionResults.inspectionId, inspectionId)))
        .get();
    const raw = row?.data;
    return (typeof raw === 'string' ? JSON.parse(raw) : raw) ?? {};
}

/** Overwrite the followupStatus on a re-inspection's results (simulates the
 *  inspector dispositioning each carried item), preserving `original`. */
async function setFollowupStatuses(tenantId: string, inspectionId: string, statuses: Record<string, string>): Promise<void> {
    const db = drizzle(b.DB);
    const data = await readResultsData(tenantId, inspectionId);
    for (const [itemId, status] of Object.entries(statuses)) {
        data[itemId] = { ...(data[itemId] ?? {}), followupStatus: status };
    }
    await db.update(schema.inspectionResults)
        .set({ data: data as unknown as object, lastSyncedAt: new Date() })
        .where(and(eq(schema.inspectionResults.tenantId, tenantId), eq(schema.inspectionResults.inspectionId, inspectionId)))
        .run();
}

async function clearAll(): Promise<void> {
    for (const t of ['inspection_access_tokens', 'report_versions', 'signing_keys', 'inspection_results', 'inspection_units', 'tenant_configs', 'inspections', 'users', 'tenants']) {
        await b.DB.exec(`DELETE FROM ${t};`);
    }
}

describe('#119 re-inspections — end-to-end (real workerd)', () => {
    beforeAll(applyMigrations);
    beforeEach(clearAll);

    it('original(5 defects) → reinspect 5, resolve 3 → reinspect #2 pre-checks 2; report shows only the 2 carried items tracing to the root defect', async () => {
        const TENANT = '00000000-0000-0000-0000-0000000000a1';
        const SLUG = 'acme-a1';
        const ORIGINAL = '11111111-1111-1111-1111-1111111111a1';
        const INSPECTOR = 'user-a1';
        await seedTenant(TENANT, SLUG);
        await seedInspector(TENANT, INSPECTOR);

        // 1) Original: 5 defect items, each with a distinct seeded note.
        const itemIds = ['d1', 'd2', 'd3', 'd4', 'd5'];
        const originalNotes: Record<string, string> = {
            d1: 'Cracked foundation wall',
            d2: 'Roof shingles missing',
            d3: 'GFCI not present at kitchen',
            d4: 'Furnace past service life',
            d5: 'Water heater TPR valve leaking',
        };
        const originalItems = Object.fromEntries(
            itemIds.map((id) => [id, { rating: 'defect', notes: originalNotes[id] }]),
        );
        await seedPublishedBaseline(TENANT, ORIGINAL, originalItems);

        const svc = inspectionService();

        // 2) createReinspection over all 5 → round 1.
        const r1 = await svc.createReinspection(TENANT, ORIGINAL, { selectedItemIds: itemIds, inspectorId: INSPECTOR });
        expect(r1.reinspectionRound).toBe(1);
        expect(r1.rootInspectionId).toBe(ORIGINAL);
        expect(r1.sourceInspectionId).toBe(ORIGINAL);

        const r1Data = await readResultsData(TENANT, r1.id);
        expect(Object.keys(r1Data).sort()).toEqual([...itemIds].sort());
        for (const id of itemIds) {
            expect(r1Data[id]!.followupStatus).toBeNull();
            // `original` carried forward from the baseline snapshot's finding.
            expect(r1Data[id]!.original).toBeTruthy();
            expect(r1Data[id]!.original!.notes).toBe(originalNotes[id]);
            expect(r1Data[id]!.original!.rating).toBe('defect');
        }

        // 3) Disposition: 3 resolved, 2 not_resolved. Then publish r1.
        await setFollowupStatuses(TENANT, r1.id, {
            d1: 'resolved', d2: 'resolved', d3: 'resolved',
            d4: 'not_resolved', d5: 'not_resolved',
        });
        // r1 needs a templateSnapshot for getReportData/candidates label resolution;
        // it was carried from the baseline by createReinspection. Publish it.
        await reportVersionService().snapshotOnPublish(TENANT, r1.id, 'user-publisher');

        // 4) getReinspectCandidates(r1) → exactly the 2 not_resolved are open.
        const candidates = await svc.getReinspectCandidates(TENANT, r1.id);
        const openIds = candidates.filter((c) => c.open).map((c) => c.itemId).sort();
        const closedIds = candidates.filter((c) => !c.open).map((c) => c.itemId).sort();
        expect(openIds).toEqual(['d4', 'd5']);
        expect(closedIds).toEqual(['d1', 'd2', 'd3']);

        // 5) createReinspection over the 2 open → round 2, same root.
        const r2 = await svc.createReinspection(TENANT, r1.id, { selectedItemIds: ['d4', 'd5'], inspectorId: INSPECTOR });
        expect(r2.reinspectionRound).toBe(2);
        expect(r2.rootInspectionId).toBe(ORIGINAL);
        expect(r2.sourceInspectionId).toBe(r1.id);

        // r2's results carry only the 2 items, each original tracing to the ROOT
        // original defect (not r1's intermediate follow-up state).
        const r2Data = await readResultsData(TENANT, r2.id);
        expect(Object.keys(r2Data).sort()).toEqual(['d4', 'd5']);
        expect(r2Data.d4!.original!.notes).toBe(originalNotes.d4);
        expect(r2Data.d5!.original!.notes).toBe(originalNotes.d5);

        // 6) Drive the PUBLIC report for r2. Mint a persistent portal token so the
        //    route resolves the tenant from the token (production-shape).
        const token = await portalAccessService().issueToken({
            tenantId: TENANT, inspectionId: r2.id, recipientEmail: 'client@example.com', role: 'client',
        });
        const res = await fetchPublicReport(SLUG, r2.id, token);
        expect(res.status).toBe(200);
        const body = await res.json() as {
            success: boolean;
            data: {
                reinspection: { round: number; rootInspectionId: string } | null;
                sections: Array<{ items: Array<{ id: string; original: { notes: string | null } | null; followupStatus: string | null }> }>;
            };
        };
        expect(body.success).toBe(true);
        // reinspection block present, round 2, root = the original.
        expect(body.data.reinspection).toBeTruthy();
        expect(body.data.reinspection!.round).toBe(2);
        expect(body.data.reinspection!.rootInspectionId).toBe(ORIGINAL);

        // Track B — only the 2 carried items appear in the report payload (those
        // are the only items in r2's carried templateSnapshot section... actually
        // the snapshot carries the full template, so assert the items WITH a
        // carried `original` are exactly the 2 selected).
        const allItems = body.data.sections.flatMap((s) => s.items);
        const carried = allItems.filter((it) => it.original != null);
        expect(carried.map((it) => it.id).sort()).toEqual(['d4', 'd5']);
        // R6 — each carried item's original traces to the ROOT original deficiency.
        const byId = new Map(carried.map((it) => [it.id, it]));
        expect(byId.get('d4')!.original!.notes).toBe(originalNotes.d4);
        expect(byId.get('d5')!.original!.notes).toBe(originalNotes.d5);
    });

    it('cannot reinspect an unpublished baseline (service throws /published/i)', async () => {
        const TENANT = '00000000-0000-0000-0000-0000000000b2';
        const DRAFT = '22222222-2222-2222-2222-2222222222b2';
        await seedTenant(TENANT, 'acme-b2');
        const db = drizzle(b.DB);
        // A DRAFT inspection with NO report_versions row.
        await db.insert(schema.inspections).values({
            id: DRAFT, tenantId: TENANT, propertyAddress: '9 Draft Way', date: '2026-06-01',
            status: 'requested', paymentStatus: 'unpaid', price: 0,
            paymentRequired: false, agreementRequired: false, createdAt: new Date(),
            templateSnapshot: templateSnapshot(['x1']) as never, templateSnapshotVersion: 1,
        });
        await db.insert(schema.inspectionResults).values({
            id: crypto.randomUUID(), tenantId: TENANT, inspectionId: DRAFT,
            data: { x1: { rating: 'defect', notes: 'n' } } as unknown as object, lastSyncedAt: new Date(),
        });

        // Service-level rejects assertion (the workers harness reaches services
        // directly; driving the authed POST route would require the full JWT +
        // tenant-resolution + DI middleware stack the neighbor harness avoids).
        await expect(
            inspectionService().createReinspection(TENANT, DRAFT, { selectedItemIds: ['x1'] }),
        ).rejects.toThrow(/published/i);
    });

    it('original baseline default-selects defect + monitor items (satisfactory stays closed)', async () => {
        const TENANT = '00000000-0000-0000-0000-0000000000c3';
        const ORIGINAL = '33333333-3333-3333-3333-3333333333c3';
        await seedTenant(TENANT, 'acme-c3');

        // Mix: 2 defect, 1 monitor, 1 satisfactory.
        await seedPublishedBaseline(TENANT, ORIGINAL, {
            def1: { rating: 'defect', notes: 'Defect one' },
            def2: { rating: 'defect', notes: 'Defect two' },
            mon1: { rating: 'monitor', notes: 'Monitor one' },
            sat1: { rating: 'satisfactory', notes: 'All good' },
        });

        const candidates = await inspectionService().getReinspectCandidates(TENANT, ORIGINAL);
        const open = new Map(candidates.map((c) => [c.itemId, c.open]));
        expect(open.get('def1')).toBe(true);
        expect(open.get('def2')).toBe(true);
        expect(open.get('mon1')).toBe(true);
        expect(open.get('sat1')).toBe(false);
    });
});
