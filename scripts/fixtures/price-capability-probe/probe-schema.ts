/**
 * FIXTURE (1 of 2) — the COLUMNS half of the proof that
 * `scripts/check-price-capability.mjs` bites. See `probe-inspection-shape.ts`
 * for the other three surfaces and for how to run it.
 *
 * Not compiled, not linted, not shipped: `scripts/**` is outside both tsconfig
 * programs and eslint's scope, and this directory is in knip's ignore list. The
 * gate reads source as TEXT, so nothing here has to resolve an import.
 *
 * Expected: `probe_findings.repair_estimate_cents` is reported. Nothing else in
 * this file is — the NEGATIVE CONTROLS below are the reason a red run means
 * something, rather than meaning the gate fails on everything it reads.
 */
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const probeFindings = sqliteTable('probe_findings', {
    id: text('id').primaryKey(),

    // POSITIVE: a money column arriving on a finding-shaped table.
    repairEstimateCents: integer('repair_estimate_cents'),

    // ── NEGATIVE CONTROLS — none of these may be reported ────────────────────
    severity: text('severity'),
    description: text('description'),
    // Integer, but a boolean: not a quantity of money.
    isDepositOverridden: integer('is_deposit_overridden', { mode: 'boolean' }),
    // Integer, but a timestamp: not a quantity of money.
    pricedAt: integer('priced_at', { mode: 'timestamp_ms' }),
    // A count is not an amount.
    photoCount: integer('photo_count'),
});
