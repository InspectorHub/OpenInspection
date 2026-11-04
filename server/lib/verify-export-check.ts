/**
 * The knowledge check that releases the signed audit export of one envelope.
 *
 * The online verification result is public. The export carries the signed events whole (their payloads record signer ids and the
 * emails given at signing), so it is released only to someone who can name something a participant knows: an email recorded on the
 * envelope, or the postal code of the inspected property. This module holds the pure parts: normalisation, the comparison and the lookup
 * of what could be supplied. The attempt allowance lives in verify-export-attempts.ts.
 *
 * Any signer row of the envelope counts, whatever its status (including one that declined or was removed): the signed events record
 * that signer's email, so the person who gave it knows what the export lists. A test pins this.
 */
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from './db/schema';
import { constantTimeEquals } from './email/webhook-crypto';
import { ERASED_SENTINEL } from './compliance/anonymize-pii';
import { postalOrNull } from './validations/postal-code';

/** Trimmed and lower-cased, so the comparison does not depend on how the address was typed. */
export function normalizeEmail(value: string): string {
    return value.trim().toLowerCase();
}

/**
 * Spaces and hyphens removed, upper-cased. A nine-digit US code (ZIP+4) is reduced to its first five digits, so ZIP+4 on either side
 * matches the five-digit form; Canadian and UK codes are compared after the same normalisation.
 */
export function normalizePostalCode(value: string): string {
    const compact = value.replace(/[\s-]/g, '').toUpperCase();
    return /^\d{9}$/.test(compact) ? compact.slice(0, 5) : compact;
}

/** True when `supplied` equals any candidate. Every candidate is compared; there is no early exit. */
export function matchesAny(supplied: string, candidates: readonly string[]): boolean {
    let matched = false;
    for (const candidate of candidates) {
        if (constantTimeEquals(supplied, candidate)) matched = true;
    }
    return matched;
}

export interface EnvelopeCandidates { emails: string[]; postalCodes: string[] }

/** Stands in for an id that does not exist, so the dependent lookups run (and cost the same) when the envelope is unknown. */
const NO_SUCH_ROW = 'no-such-row';

/**
 * What a participant could supply for this envelope: the emails of its signers and of the request, and the postal code of the inspection
 * it belongs to (the inspection's own code, and the one on the inspection request it came from). Empty lists for an unknown envelope, so
 * the caller does the same work either way: four lookups for a known and for an unknown envelope, the dependent ones with a sentinel id
 * when the request row is missing, so the query count does not tell the two apart (timing is comparable by construction, not measured).
 * A postal code is never extracted from a free-text address.
 */
export async function candidatesFor(db: D1Database, envelopeId: string): Promise<EnvelopeCandidates> {
    const orm = drizzle(db, { schema });
    const request = await orm.select({ clientEmail: schema.agreementRequests.clientEmail, inspectionId: schema.agreementRequests.inspectionId, tenantId: schema.agreementRequests.tenantId })
        .from(schema.agreementRequests).where(eq(schema.agreementRequests.id, envelopeId)).get();
    const signers = await orm.select({ email: schema.agreementSigners.email })
        .from(schema.agreementSigners).where(eq(schema.agreementSigners.requestId, envelopeId)).all();
    const tenantId = request?.tenantId ?? NO_SUCH_ROW;
    const inspection = await orm.select({ zip: schema.inspections.addressZip, requestId: schema.inspections.requestId }).from(schema.inspections)
        .where(and(eq(schema.inspections.id, request?.inspectionId ?? NO_SUCH_ROW), eq(schema.inspections.tenantId, tenantId))).get();
    const requestZip = await orm.select({ zip: schema.inspectionRequests.propertyZip }).from(schema.inspectionRequests)
        .where(and(eq(schema.inspectionRequests.id, inspection?.requestId ?? NO_SUCH_ROW), eq(schema.inspectionRequests.tenantId, tenantId))).get();
    return {
        // An address erased by a subject request or the retention sweep holds the sentinel, which is not an email anyone can know.
        emails: [request?.clientEmail, ...signers.map((s) => s.email)]
            .filter((v): v is string => !!v && v !== ERASED_SENTINEL).map(normalizeEmail).filter((v) => v !== ''),
        // A placeholder (fewer than two letters or digits: '-', ' ', '.', '0') is no code anyone can know, whether it was stored before
        // postalOrNull existed or not; and what is left is compared after normalisation.
        postalCodes: [inspection?.zip, requestZip?.zip].map((v) => postalOrNull(v)).filter((v): v is string => !!v)
            .map(normalizePostalCode).filter((v) => v !== ''),
    };
}

/** One cheap read: whether an envelope with this id exists. Existence is already public (the online result answers 404 for an unknown id). */
export async function envelopeExists(db: D1Database, envelopeId: string): Promise<boolean> {
    const orm = drizzle(db, { schema });
    const row = await orm.select({ id: schema.agreementRequests.id }).from(schema.agreementRequests)
        .where(eq(schema.agreementRequests.id, envelopeId)).get();
    return !!row;
}
