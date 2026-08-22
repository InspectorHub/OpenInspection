/**
 * Privacy P3 — the appliers behind `cmd.subject.export` and `cmd.subject.erase`.
 *
 * They live beside `apply-commands.ts` rather than inside `cmd-consumer.ts` for
 * two reasons: the consumer is the PIPELINE (parse → park → dedup → stale guard
 * → apply → reply) and stays readable only if the per-command work is elsewhere;
 * and taking a drizzle handle instead of a raw `D1Database` makes both of these
 * exercisable in the node-env unit suite against better-sqlite3, which is where
 * the DSAR behaviour that actually matters can be asserted cheaply.
 *
 * Both return the EXTRA fields their reply carries beyond the
 * `{tenantId, correlationId, replyto}` base the consumer adds.
 */
import { eq } from 'drizzle-orm';
import { tenantConfigs } from '../lib/db/schema';
import { runErasure } from '../lib/compliance/erasure-orchestrator';
import { buildErasureCoverage, type ErasureCoverageDisclosure } from '../lib/compliance/erasure-coverage';
import type { ErasureDecision } from '../lib/compliance/erasure-orchestrator';
import { SubjectExportService } from '../services/subject-export.service';
import { logger } from '../lib/logger';

/** Same escape hatch as `runErasure`: D1 drizzle in prod, better-sqlite3 in unit tests. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

/** Fallback retention window when a tenant has no `tenant_configs` row yet.
 *  Mirrors `AdminService.eraseClientData` — the two must not disagree about how
 *  long signed evidence survives, so the number is the same one, not a new one. */
const DEFAULT_RETENTION_YEARS = 6;

// `type`, not `interface`, in both cases: the consumer's `applyKnownCmd` returns
// `Record<string, unknown> | undefined`, and only a type alias picks up the
// implicit index signature that makes it assignable. An interface here compiles
// to "index signature is missing" at the one call site that matters.
export type SubjectExportReply = {
    r2Key: string;
    manifest: { rows: number; photos: number; photosEmbedded: number };
};

/**
 * What core sends back for `cmd.subject.erase`.
 *
 * A UNION, because a subject erasure has two honest endings and only one of
 * them is an erasure. `outcome` is the discriminant, and `coverage` — the field
 * portal reads before it records a request as complete — exists on exactly one
 * branch. That is the guarantee: a preserved run cannot be mistaken for a
 * completed one by a consumer that reads the payload rather than the prose,
 * because the payload does not contain the thing a completion is made of.
 *
 * There is no third branch for a run that could not happen. That case does not
 * reply at all — see the header on `applySubjectErase`.
 */
export type SubjectErasedReply =
    | {
        /** The subject's data was erased. The only outcome that may be recorded as done. */
        outcome: 'erased';
        anonymizedCount: number;
        deletedCount: number;
        retainedCount: number;
        decisions: ErasureDecision[];
        coverage: ErasureCoverageDisclosure;
    }
    | {
        /**
         * The request was accepted and executed, and a preservation order
         * required the data to stay. NOT a refusal and NOT a failure — the
         * request was answered, and this is the answer.
         */
        outcome: 'held';
        /** How many scopes were kept. Tenant-wide today, so this is 1 or 0. */
        preserved: number;
        /** The sentence the data subject is given. Not an internal code. */
        reason: string;
        /** The exception record: what was preserved, and on what grounds. */
        decisions: ErasureDecision[];
    };

/**
 * Assemble the subject's data and stream it into the shared exports bucket.
 *
 * The reply reports the key that was WRITTEN. Portal allocated it and portal
 * will read it back, so echoing the request would be indistinguishable from
 * success even if nothing landed; returning what the writer returned means the
 * two can eventually disagree, which is the point of reporting it at all.
 */
export async function applySubjectExport(
    db: AnyDb,
    buckets: { photos?: R2Bucket | undefined; exports?: R2Bucket | undefined },
    data: { tenantId: string; subjectEmail: string; subjectPhone?: string | undefined; r2Key: string },
): Promise<SubjectExportReply> {
    if (!buckets.photos || !buckets.exports) {
        // Retryable by design: a genuinely misconfigured deploy exhausts the
        // retries and surfaces as a `failed` cmd row on the portal console,
        // which is visible. Replying "done" with no archive would not be.
        throw new Error('subject.export: PHOTOS/EXPORTS_BUCKET not bound');
    }
    const svc = new SubjectExportService(db, buckets.photos);
    const manifest = await svc.buildZipToR2(
        {
            tenantId: data.tenantId,
            subjectEmail: data.subjectEmail,
            ...(data.subjectPhone !== undefined && { subjectPhone: data.subjectPhone }),
        },
        buckets.exports,
        data.r2Key,
    );
    return { r2Key: data.r2Key, manifest };
}

/**
 * Run the manifest-driven erasure for one subject and build the disclosure that
 * has to ride back with it.
 *
 * A PARTIAL RUN DOES NOT REPLY. `runErasure` is fail-closed per step: a step
 * that throws is recorded and the others still land, and the summary comes back
 * `partially_completed`. There is no field on `reply.subject.erased` for that —
 * so emitting one would hand portal a payload it can only read as success, and
 * portal would write `completed` on a request where some tables were never
 * touched. Throwing instead leaves the command to retry (the erasure is
 * idempotent, so a retry is safe and may well succeed), and on exhaustion the
 * DLQ marks the outbox row `failed`. The DSAR then sits visibly at `fulfilling`
 * with a failed command beside it, which is the honest state.
 *
 * A HELD RUN DOES REPLY, and that is not an exception to the rule above — it is
 * the other side of it. A partial run is a run that may yet succeed, so not
 * replying leaves it to retry. A preservation order is not a transient fault:
 * it can outlast every retry the queue has, and staying silent would leave the
 * request unanswered while a statutory clock runs. So the run replies, with a
 * payload that carries no coverage disclosure and says plainly that the data
 * was preserved. Refusing the request outright is equally wrong and is not what
 * this does — the request was admitted, executed and recorded; what changed is
 * the answer, not whether there is one.
 */
export async function applySubjectErase(
    db: AnyDb,
    data: { tenantId: string; subjectEmail: string },
    opts: { requestedBy?: string | undefined } = {},
): Promise<SubjectErasedReply> {
    const cfg = await db.select({ years: tenantConfigs.agreementRetentionYears })
        .from(tenantConfigs).where(eq(tenantConfigs.tenantId, data.tenantId)).get();

    const summary = await runErasure(db, {
        tenantId: data.tenantId,
        subjectEmail: data.subjectEmail,
        retentionYears: cfg?.years ?? DEFAULT_RETENTION_YEARS,
        // The portal DSAR request id (`dsar:<id>`), so the append-only
        // `erasure_log` row points back at the console record that authorised it
        // — including the admin attestation portal refuses to run without.
        ...(opts.requestedBy !== undefined && { requestedBy: opts.requestedBy }),
        identityBasis: 'portal_dsar',
    });

    // The predicate is the DECISIONS, not the summary status string. Those two
    // are the same fact — `runErasure` derives `partially_completed` from
    // precisely "some step threw" — but reading the decisions keeps this in step
    // with `buildErasureCoverage`, which excludes exactly the same rows from
    // `executedTables`. One signal, two consumers, no chance of the refusal and
    // the disclosure disagreeing about what failed.
    const failed = summary.decisions.filter((d) => d.error !== undefined);
    const failedTables = failed.map((d) => d.table);
    if (failedTables.length > 0) {
        // The REASON travels with the table name. A DSAR that stops here sits at
        // `fulfilling` on portal with a statutory clock running, and the only
        // trace is this line; "failed: notification_preferences" without the
        // error is an hour of guessing at exactly the wrong moment.
        logger.error('[cmd] subject erasure did not complete — refusing to reply',
            {
                tenantId: data.tenantId, status: summary.status, failedTables,
                failures: failed.map((d) => `${d.table}: ${d.error}`),
            });
        throw new Error(
            `subject.erase: run was '${summary.status}' (failed: ${failedTables.join(', ')}). ` +
            'No reply emitted — a coverage disclosure for a partial run would read as a completed erasure.',
        );
    }

    if (summary.status === 'held') {
        // Checked AFTER the failure branch above, deliberately. An unreadable
        // holds table comes back as `refused` carrying an errored decision, so
        // it is caught there and does not reply — which is right, because that
        // one IS transient and a retry may read the table. Only a run that was
        // executed and preserved reaches here.
        logger.info('[cmd] subject erasure preserved under a legal hold', {
            tenantId: data.tenantId, preserved: summary.preservedCount,
        });
        return {
            outcome: 'held',
            preserved: summary.preservedCount,
            // The reason travels from the arbiter rather than being written
            // again here: two sentences for one fact drift, and this one is
            // read by a person deciding whether we answered them honestly.
            reason: summary.decisions.find((d) => d.action === 'preserve')?.holdReason
                ?? 'An active legal hold covers this workspace.',
            decisions: summary.decisions,
        };
    }

    return {
        outcome: 'erased',
        anonymizedCount: summary.anonymizedCount,
        deletedCount: summary.deletedCount,
        retainedCount: summary.retainedCount,
        decisions: summary.decisions,
        coverage: buildErasureCoverage(summary.decisions),
    };
}
