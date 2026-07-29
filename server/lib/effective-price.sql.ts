import { sql, getTableName, type SQL, type Column, type Table } from 'drizzle-orm';
import { inspections, inspectionServices } from './db/schema';
import { invoices } from './db/schema/invoice';

/**
 * `"table"."column"` for use inside a raw `sql` template.
 *
 * Interpolating a drizzle column directly (`${invoices.tenantId}`) renders it
 * UNQUALIFIED — just `"tenant_id"`. That is harmless in a single-table query and
 * silently wrong in a correlated subquery, where the bare name binds to the
 * SUBQUERY's table instead of the outer one. The first draft of this file hit
 * exactly that: the correlation compiled to
 *
 *     where "tenant_id" = "tenant_id" and "inspection_id" = "id"
 *
 * i.e. a tautology AND-ed with `invoices.inspection_id = invoices.id`, which is
 * never true. Every subquery returned NULL, every inspection fell through to the
 * cache tier, and the expression quietly reproduced the very bug it was written
 * to fix. The pinning spec caught it; nothing about the SQL looked wrong.
 *
 * Reading the name off the column (rather than hardcoding the string) keeps this
 * tied to the schema, so a column rename still flows through.
 */
function qualified(table: Table, column: Column): SQL {
    return sql.raw(`"${getTableName(table)}"."${column.name}"`);
}

const INV_AMOUNT = qualified(invoices, invoices.amountCents);
const INV_TENANT = qualified(invoices, invoices.tenantId);
const INV_INSPECTION = qualified(invoices, invoices.inspectionId);
const INV_VOIDED = qualified(invoices, invoices.voidedAt);
const INV_CREATED = qualified(invoices, invoices.createdAt);

const SVC_TENANT = qualified(inspectionServices, inspectionServices.tenantId);
const SVC_INSPECTION = qualified(inspectionServices, inspectionServices.inspectionId);
const SVC_OVERRIDE = qualified(inspectionServices, inspectionServices.priceOverride);
const SVC_SNAPSHOT = qualified(inspectionServices, inspectionServices.priceSnapshot);

const INSP_ID = qualified(inspections, inspections.id);
const INSP_TENANT = qualified(inspections, inspections.tenantId);
const INSP_PRICE = qualified(inspections, inspections.price);

/**
 * The P-4 authority chain as a SQL expression — the aggregate twin of
 * `getEffectivePriceCents()` in ./effective-price.ts.
 *
 * Why this exists as a second implementation: the pure helper answers for ONE
 * inspection whose invoice and service rows are already loaded, and `app/`
 * imports it, so it must stay free of drizzle (this repo's Worker bundle is at
 * ~96% of its ceiling). Aggregates cannot use it at all — you cannot SUM a
 * TypeScript function across a GROUP BY without loading every row first.
 *
 * So the chain is expressed twice, and the two are pinned together by
 * tests/unit/invoices/effective-price-sql.spec.ts, which runs both over the same
 * fixtures and asserts they agree. Change one, change the other, or that test
 * fails — which is the point. Do not "simplify" a caller by inlining
 * `sum(inspections.price_cents)`: that is tier 3 alone, and it is what made
 * Metrics report $0 revenue for a tenant that had collected $570 (IA-132).
 *
 * Tier order, highest first:
 *   1. invoices.amount_cents  — the earliest non-voided invoice for the
 *                               inspection. Authoritative when present, INCLUDING
 *                               zero. Matches the helper's `!= null` test, and the
 *                               "first one wins" tie-break contact.service.ts
 *                               already used for multiple invoices.
 *   2. sum(inspection_services.price_override ?? price_snapshot)
 *                             — SQLite's sum() over zero rows is NULL, so an
 *                               inspection with NO service rows falls through to
 *                               tier 3 by itself. That is exactly the helper's
 *                               "empty array is 'not attached', not 'free'" rule;
 *                               a real all-zero bundle has rows and sums to 0.
 *   3. inspections.price_cents — denormalized cache. Never write back to it from
 *                               tiers 1 or 2.
 *   4. 0
 *
 * Requires `inspections` in the caller's FROM — every tier correlates to it.
 */
export const effectivePriceCentsSql: SQL<number> = sql<number>`coalesce(
    (select ${INV_AMOUNT}
       from ${invoices}
      where ${INV_TENANT} = ${INSP_TENANT}
        and ${INV_INSPECTION} = ${INSP_ID}
        and ${INV_VOIDED} is null
      order by ${INV_CREATED}
      limit 1),
    (select sum(coalesce(${SVC_OVERRIDE}, ${SVC_SNAPSHOT}))
       from ${inspectionServices}
      where ${SVC_TENANT} = ${INSP_TENANT}
        and ${SVC_INSPECTION} = ${INSP_ID}),
    ${INSP_PRICE},
    0
)`;

/**
 * `sum()` of the above across whatever rows the caller's GROUP BY produces.
 *
 * Only valid where each grouped row is one inspection — every current caller
 * groups or filters `inspections` directly. If you ever join a table that fans
 * out per inspection (e.g. inspection_people with several roles), this will count
 * that inspection's price once per joined row.
 */
export const sumEffectivePriceCentsSql: SQL<number> = sql<number>`sum(${effectivePriceCentsSql})`;
