/**
 * E-1 job/lease service for the dumb data-package Worker API.
 *
 * The desktop client owns the export/import work; this service owns only the
 * lease and progress ledger in `tenant_data_jobs`. Exactly one active
 * (queued/running) job per tenant is enforced by the DB's partial unique
 * index `uq_tenant_data_jobs_active`, so creating a job is a plain insert the
 * database refuses when another is active — no read-then-write race.
 *
 * All dependencies (clock, id generator, DB, token signer) are injected so the
 * service is exercised against a real in-memory SQLite database in unit tests
 * with deterministic time. Every read and write is scoped by the tenant id
 * taken from the verified session; the caller passes it in, never the client.
 *
 * The service deliberately does NOT re-check step-up or role: those are route
 * guards. It does check lease ownership/expiry and job state, because those are
 * invariants of the ledger itself and must hold no matter who calls it.
 */
import { and, eq, desc, or } from 'drizzle-orm';
import type { DrizzleDB } from '../../lib/db/scoped';
import type {
    DATA_JOB_KINDS,
    DATA_JOB_ERROR_CODES} from '../../lib/db/schema/data-package';
import {
    tenantDataJobs,
    type TenantDataJob,
    type NewTenantDataJob,
} from '../../lib/db/schema/data-package';
import { Errors } from '../../lib/errors';
import { isUniqueViolation } from '../../lib/db/unique-violation';
import { signJobToken } from '../../lib/data-package/job-token';

/** A lease lasts 30 minutes without a heartbeat; the client renews every few minutes. */
export const JOB_LEASE_TTL_MS = 30 * 60 * 1000;
/** A heartbeat writes the renewed expiry to D1 only when fewer than this many ms remain, to save free-tier writes. */
export const JOB_HEARTBEAT_WRITE_WINDOW_MS = 5 * 60 * 1000;
/** A finished/failed job may be inspected this long; after that its row is no longer resumable (14 days). */
export const JOB_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export type JobKind = (typeof DATA_JOB_KINDS)[number];
export type JobErrorCode = (typeof DATA_JOB_ERROR_CODES)[number];

export interface CreateJobInput {
    kind: JobKind;
    clientKind: string;
    deviceLabel: string;
    createdBy: string;
    packageId?: string;
}

export interface CompleteJobInput {
    counts?: string;
    bytes?: number;
    sha256?: string;
    errorCode?: JobErrorCode;
}

export interface JobServiceDeps {
    now?: () => number;
    genId?: () => string;
    /** Signs a one-hour job token; injected so tests use a deterministic stand-in. */
    signToken?: (claims: { tenantId: string; jobId: string; userId: string }, secret: string) => Promise<string>;
}

export class DataPackageJobService {
    private readonly now: () => number;
    private readonly genId: () => string;
    private readonly signToken: NonNullable<JobServiceDeps['signToken']>;

    constructor(
        private readonly db: DrizzleDB,
        private readonly secret: string,
        deps: JobServiceDeps = {},
    ) {
        this.now = deps.now ?? (() => Date.now());
        this.genId = deps.genId ?? (() => crypto.randomUUID());
        this.signToken = deps.signToken ?? signJobToken;
    }

    private tokenFor(job: TenantDataJob): Promise<string> {
        return this.signToken({ tenantId: job.tenantId, jobId: job.id, userId: job.createdBy }, this.secret);
    }

    /** The single active job for a tenant, or null. Used to report a lease conflict. */
    async activeJob(tenantId: string): Promise<TenantDataJob | null> {
        const rows = await this.db.select().from(tenantDataJobs)
            .where(and(
                eq(tenantDataJobs.tenantId, tenantId),
                or(eq(tenantDataJobs.status, 'queued'), eq(tenantDataJobs.status, 'running'))!,
            ))
            .limit(1)
            .all();
        return rows[0] ?? null;
    }

    /** Create a job and take the lease. A partial-unique-index conflict becomes 409 JOB_LEASE_HELD. */
    async create(tenantId: string, input: CreateJobInput): Promise<{ job: TenantDataJob; jobToken: string }> {
        const nowMs = this.now();
        const values: NewTenantDataJob = {
            id: this.genId(),
            tenantId,
            kind: input.kind,
            status: 'queued',
            stage: 'rows',
            leaseHolder: input.deviceLabel,
            leaseExpiresAt: new Date(nowMs + JOB_LEASE_TTL_MS),
            clientKind: input.clientKind,
            createdBy: input.createdBy,
            createdAt: new Date(nowMs),
            updatedAt: new Date(nowMs),
            ...(input.packageId ? { packageId: input.packageId } : {}),
        };
        let inserted: TenantDataJob;
        try {
            const rows = await this.db.insert(tenantDataJobs).values(values).returning();
            inserted = rows[0]!;
        } catch (err) {
            // Only the one-active-job partial index (on tenant_id) is a lease
            // conflict. Any other insert error (id collision, NOT NULL, CHECK)
            // is a real bug and must propagate, not be disguised as a 409.
            if (isUniqueViolation(err, 'tenant_data_jobs.tenant_id')) {
                const held = await this.activeJob(tenantId);
                if (held) {
                    throw Errors.JobLeaseHeld(held.leaseHolder ?? 'another device', held.leaseExpiresAt?.getTime() ?? nowMs + JOB_LEASE_TTL_MS);
                }
            }
            throw err;
        }
        return { job: inserted, jobToken: await this.tokenFor(inserted) };
    }

    /** Tenant-scoped job read. */
    async get(tenantId: string, jobId: string): Promise<TenantDataJob | null> {
        const rows = await this.db.select().from(tenantDataJobs)
            .where(and(eq(tenantDataJobs.tenantId, tenantId), eq(tenantDataJobs.id, jobId)))
            .limit(1)
            .all();
        return rows[0] ?? null;
    }

    /** Tenant-scoped job list, newest first. */
    async list(tenantId: string, limit = 50): Promise<TenantDataJob[]> {
        return this.db.select().from(tenantDataJobs)
            .where(eq(tenantDataJobs.tenantId, tenantId))
            .orderBy(desc(tenantDataJobs.createdAt), desc(tenantDataJobs.id))
            .limit(limit)
            .all();
    }

    /**
     * Renew the lease and return a fresh job token. The renewed expiry is
     * persisted only when fewer than JOB_HEARTBEAT_WRITE_WINDOW_MS remain (or
     * the lease has no expiry), so a long export does not write D1 every few
     * minutes. `wrote` is returned for observability/tests.
     */
    async heartbeat(tenantId: string, jobId: string, deviceLabel: string): Promise<{
        job: TenantDataJob;
        jobToken: string;
        leaseExpiresAt: number;
        wrote: boolean;
    }> {
        const job = await this.get(tenantId, jobId);
        if (!job) throw Errors.NotFound('Data job not found.');
        if (job.status !== 'queued' && job.status !== 'running') throw Errors.JobLeaseExpired('This job is no longer active.');
        const nowMs = this.now();
        const expiresAtMs = job.leaseExpiresAt?.getTime() ?? 0;
        if (expiresAtMs <= nowMs) throw Errors.JobLeaseExpired();
        if (job.leaseHolder && job.leaseHolder !== deviceLabel) {
            throw Errors.JobLeaseHeld(job.leaseHolder, expiresAtMs);
        }
        const shouldWrite = !job.leaseExpiresAt || (expiresAtMs - nowMs) < JOB_HEARTBEAT_WRITE_WINDOW_MS;
        let current = job;
        if (shouldWrite) {
            const updated = await this.db.update(tenantDataJobs)
                .set({ leaseExpiresAt: new Date(nowMs + JOB_LEASE_TTL_MS), updatedAt: new Date(nowMs) })
                .where(and(eq(tenantDataJobs.tenantId, tenantId), eq(tenantDataJobs.id, jobId)))
                .returning();
            current = updated[0] ?? job;
        }
        return {
            job: current,
            jobToken: await this.tokenFor(current),
            leaseExpiresAt: current.leaseExpiresAt?.getTime() ?? nowMs + JOB_LEASE_TTL_MS,
            wrote: shouldWrite,
        };
    }

    /**
     * Reclaim a job whose lease has lapsed, by its original owner. No step-up
     * (the job was already authorised); bearer + non-expired job are checked by
     * the route. A live lease held by another device is a 409.
     */
    async resume(tenantId: string, jobId: string, deviceLabel: string): Promise<{ job: TenantDataJob; jobToken: string }> {
        const job = await this.get(tenantId, jobId);
        if (!job) throw Errors.NotFound('Data job not found.');
        if (job.status !== 'queued' && job.status !== 'running') throw Errors.JobLeaseExpired('This job is no longer active.');
        const nowMs = this.now();
        if (nowMs - job.createdAt.getTime() >= JOB_MAX_AGE_MS) throw Errors.JobLeaseExpired('This job is too old to resume.');
        const expiresAtMs = job.leaseExpiresAt?.getTime() ?? 0;
        if (expiresAtMs > nowMs) {
            if (job.leaseHolder && job.leaseHolder !== deviceLabel) {
                throw Errors.JobLeaseHeld(job.leaseHolder, expiresAtMs);
            }
            // Same device resuming a live lease is a no-op renewal; still a fresh token.
            return { job, jobToken: await this.tokenFor(job) };
        }
        const updated = await this.db.update(tenantDataJobs)
            .set({
                status: 'running',
                leaseHolder: deviceLabel,
                leaseExpiresAt: new Date(nowMs + JOB_LEASE_TTL_MS),
                updatedAt: new Date(nowMs),
            })
            .where(and(eq(tenantDataJobs.tenantId, tenantId), eq(tenantDataJobs.id, jobId)))
            .returning();
        const current = updated[0] ?? job;
        return { job: current, jobToken: await this.tokenFor(current) };
    }

    /** Record the client's declared result and release the lease (terminal complete). */
    async complete(tenantId: string, jobId: string, result: CompleteJobInput): Promise<TenantDataJob> {
        const job = await this.get(tenantId, jobId);
        if (!job) throw Errors.NotFound('Data job not found.');
        if (job.status !== 'queued' && job.status !== 'running') throw Errors.JobLeaseExpired('This job is no longer active.');
        const nowMs = this.now();
        const updated = await this.db.update(tenantDataJobs)
            .set({
                status: 'complete',
                ...(result.counts !== undefined ? { counts: result.counts } : {}),
                ...(result.bytes !== undefined ? { bytes: result.bytes } : {}),
                ...(result.sha256 !== undefined ? { sha256: result.sha256 } : {}),
                finishedAt: new Date(nowMs),
                updatedAt: new Date(nowMs),
                leaseHolder: null,
                leaseExpiresAt: null,
            })
            .where(and(eq(tenantDataJobs.tenantId, tenantId), eq(tenantDataJobs.id, jobId)))
            .returning();
        return updated[0] ?? job;
    }

    /** Abort a job and release the lease (terminal cancelled). */
    async abort(tenantId: string, jobId: string, errorCode?: JobErrorCode): Promise<TenantDataJob> {
        const job = await this.get(tenantId, jobId);
        if (!job) throw Errors.NotFound('Data job not found.');
        if (job.status !== 'queued' && job.status !== 'running') throw Errors.JobLeaseExpired('This job is no longer active.');
        const nowMs = this.now();
        const updated = await this.db.update(tenantDataJobs)
            .set({
                status: 'cancelled',
                ...(errorCode ? { errorCode } : {}),
                finishedAt: new Date(nowMs),
                updatedAt: new Date(nowMs),
                leaseHolder: null,
                leaseExpiresAt: null,
            })
            .where(and(eq(tenantDataJobs.tenantId, tenantId), eq(tenantDataJobs.id, jobId)))
            .returning();
        return updated[0] ?? job;
    }
}
