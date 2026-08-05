#!/usr/bin/env node
/**
 * Backfill the payment ledger from the invoice records that predate it.
 *
 * One `balance` row per PAID invoice, dated `paid_at`, method from
 * `payment_method`, `provider` NULL, note 'backfilled from invoice record' —
 * the same row `seedLedgerFromInvoiceRecord()` writes at runtime, so the script
 * and the service cannot disagree about what a legacy invoice means.
 *
 * PARTIALLY-paid invoices get NO row. A legacy partial carries a timestamp and
 * (before the amount column shipped) no figure; inventing one would fabricate a
 * payment. They stay unrepresented and keep saying what they say today.
 *
 * Idempotent: an invoice that already has any ledger row is skipped, so a
 * re-run appends nothing. Dry run by default — nothing is written without
 * `--apply`.
 *
 *   node scripts/backfill-payment-ledger.mjs             # dry run, local D1
 *   node scripts/backfill-payment-ledger.mjs --apply     # write, local D1
 *   node scripts/backfill-payment-ledger.mjs --apply --remote
 *
 * Production held a single paid invoice when this was written; it exists for
 * self-hosted deploys, which have their own history.
 */
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const target = args.includes('--remote') ? '--remote' : '--local';

/** Paid, not voided, has a positive total, and the ledger says nothing yet. */
const CANDIDATES = `
  FROM invoices i
 WHERE i.paid_at IS NOT NULL
   AND i.voided_at IS NULL
   AND i.amount_cents > 0
   AND NOT EXISTS (
       SELECT 1 FROM order_payments p
        WHERE p.tenant_id = i.tenant_id AND p.invoice_id = i.id
   )`;

const DRY_RUN_SQL = `SELECT count(*) AS invoices_to_backfill,
       coalesce(sum(i.amount_cents), 0) AS cents_to_record${CANDIDATES};`;

// randomblob(16) rather than a per-row round trip: the whole backfill is one
// statement, so it cannot half-apply.
const APPLY_SQL = `INSERT INTO order_payments (
    id, tenant_id, inspection_id, invoice_id, kind, amount_cents, method,
    provider, provider_ref, recorded_by, refunds_id, note, occurred_at, created_at
)
SELECT lower(hex(randomblob(16))), i.tenant_id, i.inspection_id, i.id, 'balance',
       i.amount_cents, coalesce(i.payment_method, 'offline'),
       NULL, NULL, NULL, NULL, 'backfilled from invoice record',
       i.paid_at, ${Date.now()}${CANDIDATES};`;

const sql = apply ? APPLY_SQL : DRY_RUN_SQL;
const file = join(tmpdir(), `backfill-payment-ledger-${process.pid}.sql`);
writeFileSync(file, sql, 'utf8');

console.info(`[backfill-payment-ledger] ${apply ? 'APPLY' : 'DRY RUN'} against ${target} D1`);
console.info(sql);

try {
    const r = spawnSync('node', [join(import.meta.dirname, 'wrangler.mjs'), 'd1', 'execute', 'DB', target, '--file', file], {
        stdio: 'inherit',
        shell: true,
    });
    process.exitCode = r.status ?? 0;
} finally {
    unlinkSync(file);
}

if (!apply) console.info('[backfill-payment-ledger] nothing written — re-run with --apply');
