/**
 * Track I-a GDPR (spec §7) — the retention sweep (daily Cron step).
 *
 * Past-retention-window data-minimization of signed agreements. The orchestrator
 * (`erasure-orchestrator.ts`) anonymizes the SATELLITE PII on a DSAR while
 * KEEPING signature_base64 + the audit chain as the retained evidence; this
 * sweep is the back-end clock that, once the tenant's retention window has
 * elapsed past `signedAt`, ANONYMIZES that same satellite PII AND destroys the
 * signature in one pass. Retention-expiry is therefore a SELF-CONTAINED
 * data-minimization clock — independent of whether any DSAR was ever filed
 * (GDPR Art. 5(1)(e) storage limitation; we must not keep PII forever just
 * because no one asked to erase it).
 *
 * For each tenant, a signed `agreement_requests` row is "past window" when
 *   signedAt + tenant_configs.agreement_retention_years < now.
 * The per-tenant year is applied via a single cross-tenant join to
 * `tenant_configs` (NO N+1: one grouped SELECT, then one UPDATE per due envelope's
 * scope). Already-purged rows (`purged_at IS NOT NULL`) are skipped → idempotent.
 *
 * Action per due envelope:
 *  - ANONYMIZE the satellite PII on the envelope + its `agreement_signers` rows
 *    using the SHARED `ANONYMIZE_REQUEST_PII` / `ANONYMIZE_SIGNER_PII` SETs (the
 *    SAME column→value mapping the erase orchestrator uses, so a row erased first
 *    then swept stays byte-identical — '[erased]' sentinel for NOT NULL columns,
 *    NULL for nullable). Idempotent on already-anonymized rows (re-setting the
 *    same values is a no-op in effect).
 *  - NULL `signature_base64` on the envelope AND on its `agreement_signers` rows
 *    (the orchestrator KEEPS the signature on a DSAR; the sweep destroys it).
 *  - Set `agreement_requests.purged_at = now` (the destruction marker / idempotency
 *    guard). `status` STAYS 'signed' — the agreement WAS signed; the truthful state
 *    plus the surviving esign_audit_logs chain remain the tamper-evident attestation.
 *
 * Hard rules: NEVER delete or touch `esign_audit_logs` (chain integrity — it is the
 * minimal PII-light attestation that survives final destruction). The summary line
 * carries counts ONLY — no PII, no token material.
 */
import { and, eq, isNull, isNotNull, inArray } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import {
    agreementRequests,
    agreementSigners,
    tenantConfigs,
} from '../db/schema';
import {
    ANONYMIZE_SIGNER_PII,
    ANONYMIZE_REQUEST_PII,
} from './anonymize-pii';

// Accept either the D1 drizzle type (prod) or the better-sqlite3 test db.
type AnyDb = DrizzleD1Database<Record<string, unknown>> | { [k: string]: unknown };

const DEFAULT_RETENTION_YEARS = 6;

export interface RetentionSweepSummary {
    /** Number of envelopes whose signatures were destroyed this run. */
    purgedEnvelopes: number;
    /** Number of signer rows whose signatures were destroyed this run. */
    purgedSigners: number;
}

/** Driver-tolerant row-count extraction (D1: meta.changes; better-sqlite3: changes). */
function changeCount(res: unknown): number {
    const r = res as { meta?: { changes?: number }; changes?: number } | undefined;
    return r?.meta?.changes ?? r?.changes ?? 0;
}

/** Subtract whole years from a Unix-MS timestamp, returning a Unix-MS integer. */
function subtractYearsMs(ms: number, years: number): number {
    const d = new Date(ms);
    d.setUTCFullYear(d.getUTCFullYear() - years);
    return d.getTime();
}

/** Coerce a timestamp column value (Date | number | null) to Unix-MS or null. */
function toMs(v: unknown): number | null {
    if (v == null) return null;
    if (v instanceof Date) return v.getTime();
    if (typeof v === 'number') return v;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

/**
 * Run the retention sweep against `db` at logical time `now` (Unix-MS).
 * Returns per-run counts. Idempotent: a second run finds the same rows already
 * `purged_at`-marked and matches nothing.
 *
 * Exported as a named function so it is unit-testable independent of the cron
 * wiring; `scheduled.ts` calls it once per tick.
 */
export async function runRetentionSweep(
    rawDb: AnyDb,
    now: number,
): Promise<RetentionSweepSummary> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = rawDb as any;

    // One grouped SELECT: signed, not-yet-purged envelopes joined to their
    // tenant's retention-years config. The per-tenant window is applied in JS
    // from the joined `years` value (avoids a correlated per-tenant query — the
    // join is the N+1 avoidance). Default 6y when a tenant has no config row.
    const due = await db.select({
        id: agreementRequests.id,
        tenantId: agreementRequests.tenantId,
        signedAt: agreementRequests.signedAt,
        years: tenantConfigs.agreementRetentionYears,
    })
        .from(agreementRequests)
        .leftJoin(tenantConfigs, eq(tenantConfigs.tenantId, agreementRequests.tenantId))
        .where(and(
            eq(agreementRequests.status, 'signed'),
            isNotNull(agreementRequests.signedAt),
            isNull(agreementRequests.purgedAt),
        ))
        .all();

    // A row is past-window when signedAt < now - years (i.e. signedAt + years < now).
    const dueIds: string[] = [];
    for (const r of due as Array<{ id: string; signedAt: unknown; years: number | null }>) {
        const signedAtMs = toMs(r.signedAt);
        if (signedAtMs == null) continue;
        const years = r.years ?? DEFAULT_RETENTION_YEARS;
        const cutoff = subtractYearsMs(now, years);
        if (signedAtMs < cutoff) dueIds.push(r.id);
    }

    if (dueIds.length === 0) return { purgedEnvelopes: 0, purgedSigners: 0 };

    // Anonymize satellite PII + destroy signer signatures for the due envelopes
    // (keep the audit chain). The PII SET is the SHARED `ANONYMIZE_SIGNER_PII`
    // (same mapping the erase orchestrator uses → no drift); signature_base64 is
    // layered on here because the sweep destroys the seal the orchestrator keeps.
    const signerRes = await db.update(agreementSigners)
        .set({ ...ANONYMIZE_SIGNER_PII, signatureBase64: null })
        .where(inArray(agreementSigners.requestId, dueIds))
        .run();
    const purgedSigners = changeCount(signerRes);

    // Anonymize denormalized client identity + destroy envelope signature + mark
    // purged. The `purged_at IS NULL` guard in the WHERE keeps the count truthful
    // and the operation idempotent under a race. PII SET = shared
    // `ANONYMIZE_REQUEST_PII`; signature_base64 + purged_at layered on here.
    const envRes = await db.update(agreementRequests)
        .set({ ...ANONYMIZE_REQUEST_PII, signatureBase64: null, purgedAt: new Date(now) })
        .where(and(inArray(agreementRequests.id, dueIds), isNull(agreementRequests.purgedAt)))
        .run();
    const purgedEnvelopes = changeCount(envRes);

    return { purgedEnvelopes, purgedSigners };
}
