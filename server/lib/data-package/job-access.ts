/**
 * E-1 authorization boundary for every data-package data endpoint.
 *
 * The desktop client sends its opaque `X-Data-Job` token on each read. That
 * token is NOT trusted as identity: the tenant and user come from the verified
 * bearer/cookie session (`c.get('tenantId')` / `c.get('user')`), and the token
 * is required to bind exactly those values plus the job id. Then the job is
 * re-read FROM THE DATABASE scoped by that tenant — a job id belonging to
 * another tenant, a forged token, or a token minted for another user all fail.
 *
 * This is deliberately a plain function over primitives (db, secret, session
 * values, header) rather than a Hono middleware, so it can be unit-tested
 * exhaustively. The thin route middleware just unwraps the context and calls
 * it. No step-up here: one elevation at job start must cover an export that
 * runs for hours (plan §2.1/§6).
 */
import type { DrizzleDB } from '../../lib/db/scoped';
import { and, eq } from 'drizzle-orm';
import { tenantDataJobs, type TenantDataJob } from '../../lib/db/schema/data-package';
import { verifyJobToken } from '../../lib/data-package/job-token';
import { Errors } from '../../lib/errors';

export interface JobAuthorization {
    tenantId: string;
    userId: string;
    jobId: string;
    /** The X-Data-Job header value; undefined/missing is JOB_TOKEN_INVALID. */
    token: string | undefined;
}

/**
 * Authorize a data read and return the tenant-scoped job.
 * Throws JOB_TOKEN_INVALID (401) for any credential failure and NOT_FOUND
 * (404) when the job does not exist in this tenant — two distinct signals the
 * client can act on, while neither leaks another tenant's job.
 */
export async function authorizeDataJob(
    db: DrizzleDB,
    secret: string,
    auth: JobAuthorization,
): Promise<TenantDataJob> {
    if (!auth.tenantId || !auth.userId || !auth.jobId || !auth.token) {
        throw Errors.JobTokenInvalid();
    }
    const claims = await verifyJobToken(auth.token, secret, {
        tenantId: auth.tenantId,
        jobId: auth.jobId,
        userId: auth.userId,
    });
    if (!claims) throw Errors.JobTokenInvalid();

    const rows = await db.select().from(tenantDataJobs)
        .where(and(eq(tenantDataJobs.tenantId, auth.tenantId), eq(tenantDataJobs.id, auth.jobId)))
        .limit(1)
        .all();
    const job = rows[0];
    if (!job) throw Errors.NotFound('Data job not found.');
    // A cancelled/expired/finished job is no longer authorised to hand out
    // data, even if its short-lived token has not expired yet. This makes
    // abort/complete an immediate kill switch for every data endpoint that
    // funnels through this boundary, rather than trusting the route to check.
    if (job.status !== 'queued' && job.status !== 'running') {
        throw Errors.JobLeaseExpired('This job is no longer active.');
    }
    return job;
}
