/**
 * Commercial PCA Phase C — manual cost line items (see roadmap Phase C).
 *
 * One row per Opinion-of-Cost / reserve line. Tenant + inspection scoped.
 * Scope soft-references (all NULLABLE, no FK, resolved at the service layer):
 *  - building_id / instance_index -> the Phase F building/instance hierarchy;
 *  - unit_id -> a Phase U per_unit unit (null = common / tagged scope);
 *  - finding_key -> the originating finding (unitId:sectionId:itemId), the same
 *    finding_key shape repair_request_items uses.
 * Derived line totals are NEVER stored: pca-costs.ts computes them
 * (qty x unit_cost_cents, or lump_sum_cents). Money is integer cents (`_cents`).
 * `bucket = long_term` rows feed the reserve schedule.
 */
import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

export const costItems = sqliteTable('cost_items', {
    id:            text('id').primaryKey(),
    tenantId:      text('tenant_id').notNull(),
    inspectionId:  text('inspection_id').notNull(),
    // Phase F soft references — nullable, no FK (D1 rebuild liability).
    buildingId:    text('building_id'),
    instanceIndex: integer('instance_index'),
    // Phase U per-unit scope — nullable (null = common / tagged scope).
    unitId:        text('unit_id'),
    // Link to the originating finding — same shape as repair_request_items.finding_key.
    findingKey:    text('finding_key'),
    // ASTM grouping (site/roof/mep/...) — TABLE 2 row grouping + SECTION back-ref.
    system:        text('system').notNull(),
    // Free text, and half the like-group key (`system` + `component`) that
    // applyThreshold groups on: 4+ sub-threshold lines sharing one pair are
    // rescued together rather than each dropped (ASTM §10.3.1). Also the row
    // label both cost tables print.
    component:     text('component').notNull(),
    // Tagged-mode scope (mirrors DefectState.location); '' when unscoped.
    location:      text('location').notNull().default(''),
    // 'further_study' is the one value with behaviour: at a zero total it is
    // ALWAYS kept by applyThreshold, so a deficiency that needs a specialist
    // survives the materiality cut instead of vanishing for costing nothing.
    action:        text('action', { enum: ['repair', 'replace', 'further_study'] }).notNull(),
    // Selects which money columns are real, and lineTotal is the only place
    // that branches on it: 'unit' => quantity x unit_cost_cents, 'lump_sum' =>
    // lump_sum_cents. The unused pair is left NULL, never zeroed, so a row's
    // method cannot be inferred from which numbers happen to be present.
    costMethod:    text('cost_method', { enum: ['unit', 'lump_sum'] }).notNull(),
    // unit method
    quantity:      integer('quantity'),
    // Display label for `quantity` ('sf', 'ea', ...) — never arithmetic;
    // lineTotal ignores it entirely. NULL on lump_sum rows and on unit rows
    // the assessor left blank.
    uom:           text('uom'),
    unitCostCents: integer('unit_cost_cents'),
    // lump_sum method
    lumpSumCents:  integer('lump_sum_cents'),
    // reserve placement (Expected / Effective Age / Remaining Useful Life, years)
    eul:           integer('eul'),
    effAge:        integer('eff_age'),
    rul:           integer('rul'),
    // ASTM §11.2.1 — per material physical deficiency.
    suggestedRemedy: text('suggested_remedy').notNull().default(''),
    // Which schedule the line lands in, and they are different documents:
    // immediate + short_term are TABLE 1's two blocks, long_term is TABLE 2's
    // reserve schedule (placed at currentYear + RUL, and only when the tenant
    // enabled the schedule at all). bucketRollup sums all three regardless.
    bucket:        text('bucket', { enum: ['immediate', 'short_term', 'long_term'] }).notNull(),
    // Report section anchor. Accepted by the cost-items API but the editor
    // panel never sends it, and its only reader is the CSV export column.
    sectionRef:    text('section_ref'),
    // The photo's R2 storage `key`. resolvePhotoRef maps it through the
    // appendix index to the reserve table's PHOTO NO.; a key absent from the
    // appendix resolves to null so no broken pointer prints. Like section_ref,
    // API-only — the editor panel does not set it.
    photoRef:      text('photo_ref'),
    sortOrder:     integer('sort_order').notNull().default(0),
    createdAt:     integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
}, (t) => [
    index('idx_cost_items_tenant_inspection').on(t.tenantId, t.inspectionId),
    index('idx_cost_items_finding_key').on(t.findingKey),
]);
