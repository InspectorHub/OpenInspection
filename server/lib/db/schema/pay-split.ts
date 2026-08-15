/**
 * Pay splits — what each inspector earns on one billing line of one inspection.
 *
 * The design decision this whole file exists to hold: a split is a RECORD, not
 * a calculation. Rules populate a row once, the row freezes, and after that
 * only a deliberate edit moves it. A derived split would change retroactively
 * whenever the rule changed, which means a tenant editing "60%" to "55%" would
 * silently rewrite what someone was already paid.
 *
 * Grain is the BILLING LINE (`inspection_services.id`) — the same key
 * `reports.inspection_service_id` uses — not the inspection. An inspector who
 * only ran the radon test earns from the radon line, not a share of the job.
 *
 * Splits sum to <= the line's effective price, never forced to equal it: the
 * remainder is company margin. An invoice overriding the ORDER total (tier 1 of
 * the money authority chain) does not redistribute pay — pay attaches to tier 2.
 *
 * App-layer integrity — no DB FKs (Schema Rules).
 */
import { sqliteTable, text, integer, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

/**
 * Tenant rule: what an inspector earns on a catalogue service. Read only when
 * a split row is created; never consulted again once one exists.
 */
export const servicePayRules = sqliteTable('service_pay_rules', {
    id:        text('id').primaryKey(),
    tenantId:  text('tenant_id').notNull(),
    serviceId: text('service_id').notNull(),
    // NULL = the default for this service, applied to any inspector without a
    // specific rule. That is what makes "60% to whoever runs it" expressible
    // without a row per employee.
    userId:    text('user_id'),
    // Three types: a straight percentage, a flat amount, and a percentage
    // applied AFTER a deduction off the top (materials, a franchise fee). The
    // third is not a variant of the first — the deduction comes out before the
    // percentage, so it cannot be restated as a smaller percentage of the gross.
    type:      text('type', { enum: ['percent', 'fixed', 'percent_after_deduction'] }).notNull(),
    // Basis points when `type` is a percentage, integer cents when it is
    // `fixed`. Deliberately NOT named `_cents`: the unit is decided by `type`
    // and a `_cents` suffix would be a lie half the time.
    value:     integer('value').notNull(),
    // Only meaningful for `percent_after_deduction`.
    deductionCents: integer('deduction_cents'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
    // Two partial indexes, not one three-column unique: SQLite treats NULLs as
    // distinct, so a single unique over (tenant, service, user) would happily
    // accept a second default rule for the same service and the populate step
    // would then pick one arbitrarily.
    uniqueIndex('uq_service_pay_rules_user').on(t.tenantId, t.serviceId, t.userId)
        .where(sql`user_id IS NOT NULL`),
    uniqueIndex('uq_service_pay_rules_default').on(t.tenantId, t.serviceId)
        .where(sql`user_id IS NULL`),
]);

/**
 * The agreed amount for one inspector on one service line of one inspection.
 * Frozen at creation. `source` records whether a human moved it, because that
 * is the first question asked when a payout is disputed.
 *
 * NOT `service_inspectors`. That table already exists, is `(service_id,
 * user_id)`, and means QUALIFICATION — which inspectors are able to perform a
 * CATALOGUE service, read by `booking.service.ts` to auto-assign. It has no
 * inspection dimension and no money. The names are close enough that "reuse the
 * existing table" is a plausible-sounding wrong turn; this is the note that
 * stops it.
 */
export const inspectionServicePaySplits = sqliteTable('inspection_service_pay_splits', {
    id:                  text('id').primaryKey(),
    tenantId:            text('tenant_id').notNull(),
    inspectionServiceId: text('inspection_service_id').notNull(),
    userId:              text('user_id').notNull(),
    amountCents:         integer('amount_cents').notNull(),
    // Whether a rule put this number here or a person did — and it is a ONE-WAY
    // door: any amount edit rewrites it to 'manual'. That is what the automatic
    // paths key on. Only a 'rule' row that is unlocked and not itself a
    // correction may be re-derived by refreshSplits or removed by the orphan
    // sweep; a 'manual' row is never recomputed or deleted behind anyone's back.
    source:              text('source', { enum: ['rule', 'manual'] }).notNull(),
    // Set when this split was included in a payroll export. From that moment
    // the row is read-only: editing it would desynchronise the books from what
    // was actually paid, with nothing surfacing the divergence. A correction
    // after this point is a NEW row (see `correctsSplitId`), matching how the
    // payment ledger treats money that has already moved.
    lockedAt:            integer('locked_at', { mode: 'timestamp_ms' }),
    // Set on a correction row; points at the locked split being adjusted. The
    // correction carries the DELTA (often negative), so the two rows sum to
    // what the inspector is actually owed and neither one has been rewritten.
    correctsSplitId:     text('corrects_split_id'),
    // Why a human moved this number — the audit answer for a disputed payout.
    reason:              text('reason'),
    createdAt:           integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt:           integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
    // Partial: one PRIMARY split per (line, user), but any number of correction
    // rows against it. An unconditional unique here would make the correction
    // path in the comment above impossible to write.
    uniqueIndex('uq_pay_split_line_user').on(t.tenantId, t.inspectionServiceId, t.userId)
        .where(sql`corrects_split_id IS NULL`),
    index('idx_pay_split_user').on(t.tenantId, t.userId),
    index('idx_pay_split_line').on(t.tenantId, t.inspectionServiceId),
]);

export type ServicePayRule = typeof servicePayRules.$inferSelect;
export type InspectionServicePaySplit = typeof inspectionServicePaySplits.$inferSelect;
