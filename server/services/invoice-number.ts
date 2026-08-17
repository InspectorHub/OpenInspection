/**
 * The number a human uses for an invoice.
 *
 * There was no such thing. `invoice-sync.ts` read `invoice.invoiceNumber`,
 * which no write path ever set, and fell back to `invoice.id` sliced to 21
 * characters — so a customer's QuickBooks showed `9ce7a7ba-c5e0-4678-86` as the
 * document number. A UUID satisfies uniqueness, so nothing failed and nothing
 * complained; it was silently unprofessional. Observed in a live sandbox on
 * 2026-08-16.
 *
 * Sequential per tenant, starting at 1001 — Jobber's `#1001` is the named
 * example and the category convention. (Spectora is the outlier that generates
 * none at all and displays QuickBooks' own DocNumber instead, which is not open
 * to us: we are the system that CREATES the invoice.)
 */
import { eq, sql } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { tenantConfigs } from '../lib/db/schema';

/**
 * Hand out the next invoice number for a tenant.
 *
 * ONE statement. D1 offers no interactive transaction, so
 * `SELECT invoice_seq` followed by `UPDATE invoice_seq = n + 1` lets two
 * concurrent creates read the same value and claim the same number — and
 * `uq_invoices_tenant_number` then refuses the second invoice in front of
 * whoever was raising it. `UPDATE … RETURNING` is executed atomically by
 * SQLite, so the increment and the read cannot be separated.
 *
 * Returns null when the tenant has no `tenant_configs` row. The caller writes
 * the invoice anyway with a null number rather than refusing to bill: a missing
 * document number is a cosmetic problem, and blocking an invoice over one would
 * turn it into a commercial one.
 */
export async function allocateInvoiceNumber(
    db: DrizzleD1Database,
    tenantId: string,
): Promise<number | null> {
    const rows = await db
        .update(tenantConfigs)
        .set({ invoiceSeq: sql`${tenantConfigs.invoiceSeq} + 1` })
        .where(eq(tenantConfigs.tenantId, tenantId))
        .returning({ invoiceSeq: tenantConfigs.invoiceSeq });

    return rows[0]?.invoiceSeq ?? null;
}

/**
 * How an invoice number is shown to a person.
 *
 * The `#` lives here and not in the column: storing the presentation would make
 * a future per-tenant prefix rewrite history, and would turn "which invoice came
 * first" into a string comparison.
 *
 * A null number is a row that predates the column. It renders as the short id
 * it has always effectively been, rather than as an empty cell that reads like
 * a bug.
 */
export function formatInvoiceNumber(n: number | null | undefined, fallbackId: string): string {
    return n == null ? fallbackId.slice(0, 8) : `#${n}`;
}
