/**
 * Track I-a GDPR (spec §7) — the retention sweep (daily Cron step).
 *
 * Past-retention-window data-minimization of signed agreements. The orchestrator
 * (`erasure-orchestrator.ts`) erases the SATELLITE PII in place on a DSAR while
 * KEEPING signature_base64 + the audit chain as the retained evidence; this
 * sweep is the back-end clock that, once the tenant's retention window has
 * elapsed past `signedAt`, CLEARS that same satellite PII AND destroys the
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
 *  - ERASE IN PLACE the satellite PII on the envelope + its `agreement_signers`
 *    rows using the SHARED `ANONYMIZE_REQUEST_PII` / `ANONYMIZE_SIGNER_PII` SETs (the
 *    SAME column→value mapping the erase orchestrator uses, so a row erased first
 *    then swept stays byte-identical — '[erased]' sentinel for NOT NULL columns,
 *    NULL for nullable). Idempotent on already-cleared rows (re-setting the
 *    same values is a no-op in effect).
 *  - NULL `signature_base64` on the envelope's `agreement_signers` rows — the
 *    only place a signature lives (the orchestrator KEEPS it on a DSAR; the
 *    sweep destroys it).
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
import { r2Keys } from '../r2-keys';
import { changeCount, toMs, subtractYearsMs } from './db-row-utils';

// Accept either the D1 drizzle type (prod) or the better-sqlite3 test db.
type AnyDb = DrizzleD1Database<Record<string, unknown>> | { [k: string]: unknown };

const DEFAULT_RETENTION_YEARS = 6;

/**
 * The three documents that embed a picture of the signature the column holds.
 *
 * Named here rather than derived, because they are what the sign-completion
 * workflow actually writes (`workflows/sign-completion-workflow.ts`) and a
 * fourth artefact would have to be added deliberately in both places. A glob of
 * the envelope prefix would have coupled destruction to whatever happened to be
 * under it.
 */
const SIGNATURE_ARTEFACTS = ['signed.pdf', 'certificate.pdf', 'evidence.zip'] as const;

export interface RetentionSweepSummary {
    /** Number of envelopes whose signatures were destroyed this run. */
    purgedEnvelopes: number;
    /** Number of signer rows whose signatures were destroyed this run. */
    purgedSigners: number;
    /**
     * R2 objects destroyed this run: the signed PDF, the certificate and the
     * evidence pack, three per due envelope.
     *
     * Counted from the keys ATTEMPTED rather than from a bucket response,
     * because R2 delete is idempotent and reports no per-key outcome. The number
     * therefore means "this many artefacts are now absent", which is what a
     * destruction record needs, not "this many existed".
     */
    purgedArtefacts: number;
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
    stores: { photos?: R2Bucket | undefined } = {},
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
        // Selected for the R2 keys. `agreementFile` needs
        // (tenantId, inspectionId, envelopeId, name), and the envelope id IS
        // `agreementRequests.id` — so the only missing coordinate was on the
        // row all along.
        inspectionId: agreementRequests.inspectionId,
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
    const dueArtefactKeys: string[] = [];
    for (const r of due as Array<{
        id: string; tenantId: string; inspectionId: string | null; signedAt: unknown; years: number | null;
    }>) {
        const signedAtMs = toMs(r.signedAt);
        if (signedAtMs == null) continue;
        const years = r.years ?? DEFAULT_RETENTION_YEARS;
        const cutoff = subtractYearsMs(now, years);
        if (signedAtMs >= cutoff) continue;
        dueIds.push(r.id);
        // The three artefacts that hold a picture of the same signature the
        // column below is about to lose. Keyed per envelope, so a prefix built
        // from the wrong row would destroy a live agreement's evidence.
        if (r.inspectionId) {
            for (const name of SIGNATURE_ARTEFACTS) {
                dueArtefactKeys.push(r2Keys.agreementFile(r.tenantId, r.inspectionId, r.id, name));
            }
        }
    }

    if (dueIds.length === 0) return { purgedEnvelopes: 0, purgedSigners: 0, purgedArtefacts: 0 };

    // Counsel round 26: nulling the column while `signed.pdf` still embeds the
    // same image is DATABASE retention wearing the name of retention. The column
    // and the artefacts are one evidence object, so a sweep that cannot reach
    // the artefacts must not destroy half of it and report success.
    //
    // Demanded HERE, after the due set is known, so a run with nothing due never
    // needs a binding it would not use.
    const bucket = stores.photos;
    if (!bucket) {
        throw new Error(
            'agreement retention needs the photos bucket — refusing to null a signature column '
            + 'while signed.pdf still embeds the same image. Pass { photos } to runRetentionSweep.',
        );
    }
    // Objects first, for the same reason as the report-PDF sweep: a failure
    // after this point leaves rows whose objects are gone, which the next pass
    // retries harmlessly. The reverse leaves objects nothing points at.
    if (dueArtefactKeys.length > 0) await bucket.delete(dueArtefactKeys);
    const purgedArtefacts = dueArtefactKeys.length;

    // Anonymize satellite PII + destroy signer signatures for the due envelopes
    // (keep the audit chain). The PII SET is the SHARED `ANONYMIZE_SIGNER_PII`
    // (same mapping the erase orchestrator uses → no drift); signature_base64 is
    // layered on here because the sweep destroys the seal the orchestrator keeps.
    const signerRes = await db.update(agreementSigners)
        .set({ ...ANONYMIZE_SIGNER_PII, signatureBase64: null })
        .where(inArray(agreementSigners.requestId, dueIds))
        .run();
    const purgedSigners = changeCount(signerRes);

    // Anonymize denormalized client identity + mark purged. The signatures were
    // destroyed on the signer rows above — the envelope has none of its own since
    // the column moved there. The `purged_at IS NULL` guard in the WHERE keeps
    // the count truthful and the operation idempotent under a race. PII SET =
    // shared `ANONYMIZE_REQUEST_PII`; purged_at layered on here.
    // `inspectorSignatureBase64` goes in the SAME pass, and that is a decision
    // rather than tidiness: it is the company's countersignature ON THIS
    // ENVELOPE, so its purpose ends when the envelope's does. The inspector's
    // SAVED DEFAULT signature (`users.default_signature_base64`) is a different
    // clock — an account asset that expires with the account — and both are now
    // written down in erasure-out-of-scope.ts rather than left indefinite by
    // omission (counsel round 26).
    const envRes = await db.update(agreementRequests)
        .set({ ...ANONYMIZE_REQUEST_PII, inspectorSignatureBase64: null, purgedAt: new Date(now) })
        .where(and(inArray(agreementRequests.id, dueIds), isNull(agreementRequests.purgedAt)))
        .run();
    const purgedEnvelopes = changeCount(envRes);

    return { purgedEnvelopes, purgedSigners, purgedArtefacts };
}
