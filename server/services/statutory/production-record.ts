/**
 * Record that a statutory form was produced, and against which revision.
 *
 * Kept out of `produce.service.ts` on purpose: that module is a pure function
 * that holds no database handle, and handing it one so it could write a row
 * would make every one of its tests need a database to say anything about
 * rendering. The caller writes the row instead, straight after the produce call
 * that returned the revision.
 */
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { statutoryFormProductions } from '../../lib/db/schema';

export interface ProductionInput {
    tenantId: string;
    inspectionId: string;
    /** The form, never one of its revisions -- e.g. `tx_trec_rei`. */
    formId: string;
    /** The authority's own revision label, verbatim. */
    version: string;
    /** sha256 of the exact bytes rendered onto. */
    sourceHash: string;
    /** users.id of whoever asked for the document. */
    producedBy: string;
}

/**
 * Write one production event.
 *
 * Deliberately not idempotent and deliberately not an upsert: two productions
 * of the same revision are two documents, and this table's whole job is
 * counting documents that left.
 */
export async function recordProduction<TSchema extends Record<string, unknown>>(
    db: DrizzleD1Database<TSchema>,
    input: ProductionInput,
    now: Date = new Date(),
): Promise<void> {
    await db.insert(statutoryFormProductions).values({
        id: crypto.randomUUID(),
        ...input,
        producedAt: now,
    });
}
