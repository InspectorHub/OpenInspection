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
 * `tenant_configs` (NO N+1: one grouped SELECT, oldest signature first, then bounded chunked
 * UPDATEs of SWEEP_CHUNK envelopes each). Already-purged rows (`purged_at IS NOT NULL`) are skipped → idempotent.
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
 * signed record that survives final destruction). It is not free of personal data:
 * its rows keep what was recorded when each event happened, such as the signer's email
 * address, the address and browser of the signing device, and the country. That
 * is why it is retained on purpose and described as retained, not as harmless. The summary line
 * carries counts ONLY — no PII, no token material.
 */
import { and, asc, eq, isNull, isNotNull, inArray } from 'drizzle-orm';
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
import { loadActiveHolds } from './legal-hold';
import { changeCount, toMs, subtractYearsMs } from './db-row-utils';
import { logger } from '../logger';
import { errorSummary } from '../error-summary';

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

/** Envelopes handled per statement: 40 ids plus the other bound values stay well inside D1's 100-per-statement limit, and 3 keys each stay far under a bucket delete's 1000. */
const SWEEP_CHUNK = 40;
/** Envelopes handled per run. The rest are due on the next run. */
const SWEEP_MAX_ENVELOPES_PER_RUN = 400;

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
    /** Chunks skipped because the bucket delete failed. Their envelopes are NOT marked purged, so the next run tries them again. */
    failedChunks: number;
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

    // Legal hold outranks this clock too. It is a SCHEDULED
    // deletion — the invariant is over all of them, not only the fixed-window
    // sweep next door — and it destroys more than most: a signature and three R2
    // artefacts, none of which can be reconstructed. Read before anything is
    // selected, and NOT caught: an unreadable holds table must stop this sweep
    // rather than let it run as though nothing were preserved.
    const holds = await loadActiveHolds(db);

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
        // Oldest signature first, so the per-run cap spends itself on what has been due longest (id breaks ties, so the order is stable).
        .orderBy(asc(agreementRequests.signedAt), asc(agreementRequests.id))
        .all();

    // A row is past-window when signedAt < now - years (i.e. signedAt + years < now).
    const dueEnvelopes: Array<{ id: string; keys: string[] }> = [];
    for (const r of due as Array<{
        id: string; tenantId: string; inspectionId: string | null; signedAt: unknown; years: number | null;
    }>) {
        if (holds.heldTenantIds.has(r.tenantId)) continue;
        const signedAtMs = toMs(r.signedAt);
        if (signedAtMs == null) continue;
        const years = r.years ?? DEFAULT_RETENTION_YEARS;
        const cutoff = subtractYearsMs(now, years);
        if (signedAtMs >= cutoff) continue;
        // The three artefacts that hold a picture of the same signature the
        // column below is about to lose. Keyed per envelope, so a prefix built
        // from the wrong row would destroy a live agreement's evidence.
        const keys = r.inspectionId
            ? SIGNATURE_ARTEFACTS.map((name) => r2Keys.agreementFile(r.tenantId, r.inspectionId as string, r.id, name))
            : [];
        dueEnvelopes.push({ id: r.id, keys });
    }

    if (dueEnvelopes.length === 0) return { purgedEnvelopes: 0, purgedSigners: 0, purgedArtefacts: 0, failedChunks: 0 };

    // Nulling the column while `signed.pdf` still embeds the
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
    // In bounded chunks, and a bounded number of them per run. One statement or one bucket call over EVERY due envelope fails outright
    // once the backlog is large: D1 allows 100 bound values per statement, and a bucket delete takes at most 1000 keys. A sweep that
    // throws on the first oversized batch would then never purge anything again. What is left past the per-run cap is simply due on the
    // next run (the `purged_at IS NULL` filter picks it up), oldest first (the query orders them). A chunk whose bucket delete fails is logged
    // (envelope ids only), left unmarked and skipped, so one persistently failing object cannot hold up the rest of the backlog every day.
    // ACCEPTED: a chunk whose bucket delete keeps failing is skipped unmarked, so its envelopes stay due and, being the oldest, fill the
    // front of this batch every run. With more than SWEEP_MAX_ENVELOPES_PER_RUN of them the sweep would stop progressing; that takes ten or
    // more persistently failing chunks, and it is visible: `failedChunks` in the summary and the `retention.sweep.chunk.failed` error
    // (envelope ids) every run. An operator then clears the cause (a bad object, a bucket permission) and the next run catches up.
    const batch = dueEnvelopes.slice(0, SWEEP_MAX_ENVELOPES_PER_RUN);
    let purgedArtefacts = 0;
    let purgedSigners = 0;
    let purgedEnvelopes = 0;
    let failedChunks = 0;
    for (let at = 0; at < batch.length; at += SWEEP_CHUNK) {
        const chunk = batch.slice(at, at + SWEEP_CHUNK);
        const ids = chunk.map((e) => e.id);
        const keys = chunk.flatMap((e) => e.keys);

        // Objects first, for the same reason as the report-PDF sweep: a failure
        // after this point leaves rows whose objects are gone, which the next pass
        // retries harmlessly. The reverse leaves objects nothing points at.
        if (keys.length > 0) {
            try {
                await bucket.delete(keys);
            } catch (e) {
                failedChunks += 1;
                logger.error('retention.sweep.chunk.failed', { envelopeIds: ids, error: errorSummary(e) });
                continue;
            }
        }
        purgedArtefacts += keys.length;

        // Anonymize satellite PII + destroy signer signatures for the due envelopes
        // (keep the audit chain). The PII SET is the SHARED `ANONYMIZE_SIGNER_PII`
        // (same mapping the erase orchestrator uses → no drift); signature_base64 is
        // layered on here because the sweep destroys the seal the orchestrator keeps.
        const signerRes = await db.update(agreementSigners)
            .set({ ...ANONYMIZE_SIGNER_PII, signatureBase64: null })
            .where(inArray(agreementSigners.requestId, ids))
            .run();
        purgedSigners += changeCount(signerRes);

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
        // omission.
        const envRes = await db.update(agreementRequests)
            .set({ ...ANONYMIZE_REQUEST_PII, inspectorSignatureBase64: null, purgedAt: new Date(now) })
            .where(and(inArray(agreementRequests.id, ids), isNull(agreementRequests.purgedAt)))
            .run();
        purgedEnvelopes += changeCount(envRes);
    }

    return { purgedEnvelopes, purgedSigners, purgedArtefacts, failedChunks };
}
