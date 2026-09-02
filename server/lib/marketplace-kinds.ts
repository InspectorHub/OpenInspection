/**
 * Every kind the marketplace catalogue can hold, and the ONE place the list is
 * written.
 *
 * ── Why it is not in the schema module ──────────────────────────────────────
 * The `kind` column's enum is built FROM this, and so are the two query
 * schemas — but so is the browse page's tab strip, which renders in the
 * browser. Importing `db/schema/marketplace.ts` from a client component to
 * reach a three-string array would pull drizzle's table builders into the
 * browser bundle for nothing. This module imports nothing at all, so both
 * sides can read the same list without either paying for the other's
 * dependencies.
 *
 * ── What it prevents ────────────────────────────────────────────────────────
 * Consumers derive rather than retype. Two copies had already drifted, in the
 * same direction and independently:
 *
 *   - the API's query enum read ['comments', 'templates'] — offering a kind no
 *     row carries and refusing `statutory`, which several do;
 *   - the browse tab strip listed "Agreements", a kind that has never existed
 *     anywhere in this repository, and had no tab for `statutory` either.
 *
 * Neither failed anything. The service layer accepted all three throughout, so
 * the rows were returned and simply could not be filtered for. An absence
 * raises nothing, which is why the list lives in one place now.
 */
export const MARKETPLACE_KINDS = ['comments', 'templates', 'statutory'] as const;
