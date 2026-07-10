/**
 * Commercial PCA Phase U — tagged ↔ per_unit switch orchestrator.
 *
 * Wraps the pure finding-key rewrites (server/lib/unit-switch.ts) with the
 * DB side effects: it reads the inspection's location_options / unit rows /
 * inspection_results.data, applies the rewrite, persists the rewritten results
 * map, and flips inspections.unit_inspection_mode. Both directions are
 * single-shot (no migration framework) and lean on the pure functions'
 * idempotence so a retried switch is safe.
 *
 * Tenant isolation: every read/write filters by the caller's tenantId; unit
 * mutations go through UnitService, which enforces the same scoping.
 *
 * Schema dependency: `unit_inspection_mode` (notNull, default 'tagged') and
 * `location_options` live on `inspections` (see schema/inspection/core.ts). The
 * db:check drift gate keeps schema and migrations in sync, so the columns are
 * always present at runtime — no defensive column-presence guard is needed.
 */
import { drizzle } from 'drizzle-orm/d1';
import { and, eq } from 'drizzle-orm';
import { inspections, inspectionResults } from '../lib/db/schema';
import { Errors } from '../lib/errors';
import { planPromotion, rewriteKeysForPromotion, flattenUnitsToTagged } from '../lib/unit-switch';
import { UnitService } from './unit.service';

export class UnitSwitchService {
    private units: UnitService;

    constructor(private db: D1Database) {
        this.units = new UnitService(db);
    }

    private getDrizzle() {
        return drizzle(this.db);
    }

    private parseData(raw: unknown): Record<string, unknown> {
        if (!raw) return {};
        return (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, unknown>;
    }

    /**
     * tagged → per_unit. Promotes each location_options label that is not yet a
     * unit into a first-class inspection_units row, re-keys the _default findings
     * that unambiguously belong to one unit onto that unit's finding-key prefix,
     * persists the rewritten results map, and sets unit_inspection_mode.
     */
    async toPerUnit(tenantId: string, inspectionId: string): Promise<{ mode: 'per_unit'; created: string[] }> {
        const db = this.getDrizzle();
        const inspection = await db.select().from(inspections)
            .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)))
            .get();
        if (!inspection) throw Errors.NotFound('Inspection not found');

        const locationOptions = ((inspection as { locationOptions?: string[] | null }).locationOptions) ?? [];
        const existing = await this.units.list(tenantId, inspectionId);
        const existingUnitLabels = existing.filter((u) => u.kind === 'unit').map((u) => u.name);
        const toCreate = planPromotion(locationOptions, existingUnitLabels);
        if (toCreate.length) {
            await this.units.createMany(
                tenantId,
                inspectionId,
                toCreate.map((label) => ({ label, floor: null })),
                { kind: 'unit', type: 'unit' },
            );
        }

        // Build labelToUnitId from the refreshed list so newly-promoted units are
        // included in the finding-key rewrite.
        const refreshed = await this.units.list(tenantId, inspectionId);
        const labelToUnitId: Record<string, string> = {};
        for (const u of refreshed) if (u.kind === 'unit') labelToUnitId[u.name] = u.id;

        const resultsRow = await db.select().from(inspectionResults)
            .where(and(eq(inspectionResults.inspectionId, inspectionId), eq(inspectionResults.tenantId, tenantId)))
            .get();
        if (resultsRow) {
            const data = this.parseData(resultsRow.data);
            const rewritten = rewriteKeysForPromotion(data, labelToUnitId);
            await db.update(inspectionResults)
                .set({ data: rewritten, lastSyncedAt: new Date() })
                .where(and(eq(inspectionResults.inspectionId, inspectionId), eq(inspectionResults.tenantId, tenantId)));
        }

        await db.update(inspections)
            .set({ unitInspectionMode: 'per_unit' })
            .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)));

        return { mode: 'per_unit', created: toCreate };
    }

    /**
     * per_unit → tagged (lossy). Demotes every unit-scoped finding back to
     * _default, stamping the unit's label as the defect location, unions the
     * discovered labels into location_options, persists the flattened results
     * map, deletes the promoted unit rows, and sets unit_inspection_mode.
     */
    async toTagged(tenantId: string, inspectionId: string): Promise<{ mode: 'tagged'; locationOptions: string[] }> {
        const db = this.getDrizzle();
        const inspection = await db.select().from(inspections)
            .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)))
            .get();
        if (!inspection) throw Errors.NotFound('Inspection not found');

        const unitRows = (await this.units.list(tenantId, inspectionId)).filter((u) => u.kind === 'unit');
        const units = unitRows.map((u) => ({ id: u.id, label: u.name }));

        // Every demoted unit's label MUST survive into location_options — even a
        // unit the inspector created but left with zero findings (it contributes
        // no finding key, so `flattenUnitsToTagged` would never surface it). Seed
        // from the unit rows directly, not from what the rewrite happened to emit;
        // this also makes a retry after a partial failure label-complete (the
        // second run re-reads already-flattened data that carries no unit keys).
        const mergedOptions = (((inspection as { locationOptions?: string[] | null }).locationOptions) ?? []).slice();
        const optionSet = new Set(mergedOptions);
        for (const u of units) {
            if (!optionSet.has(u.label)) {
                optionSet.add(u.label);
                mergedOptions.push(u.label);
            }
        }

        const resultsRow = await db.select().from(inspectionResults)
            .where(and(eq(inspectionResults.inspectionId, inspectionId), eq(inspectionResults.tenantId, tenantId)))
            .get();
        if (resultsRow) {
            const data = this.parseData(resultsRow.data);
            const { data: flattened } = flattenUnitsToTagged(data, units);
            await db.update(inspectionResults)
                .set({ data: flattened, lastSyncedAt: new Date() })
                .where(and(eq(inspectionResults.inspectionId, inspectionId), eq(inspectionResults.tenantId, tenantId)));
        }

        // Delete the promoted unit rows (leaf 'unit' nodes; buildings/floors, if
        // any, stay as structural grouping). UnitService.delete cascades + scopes.
        for (const u of unitRows) {
            await this.units.delete(tenantId, u.id);
        }

        await db.update(inspections)
            .set({ unitInspectionMode: 'tagged', locationOptions: mergedOptions })
            .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)));

        return { mode: 'tagged', locationOptions: mergedOptions };
    }
}
