/**
 * E-1 job/lease service tests. The service runs against a real in-memory
 * SQLite database with an injected clock and deterministic token signer, so
 * lease timing and conflict behaviour are exact rather than timing-dependent.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../db';
import { asScopedDbSource } from '../helpers/test-db';
import { DataPackageJobService, JOB_LEASE_TTL_MS, JOB_HEARTBEAT_WRITE_WINDOW_MS } from '../../../server/services/data-package/job.service';
import { tenantDataJobs } from '../../../server/lib/db/schema/data-package';
import { AppError, ErrorCode } from '../../../server/lib/errors';
import type * as schema from '../../../server/lib/db/schema';

const TENANT = 'tenant-1';
const OTHER = 'tenant-2';

describe('DataPackageJobService', () => {
    let svc: DataPackageJobService;
    let clock: { t: number };
    let sqlite: any;
    let db: any;

    beforeEach(() => {
        const setup = createTestDb();
        sqlite = setup.sqlite;
        db = setup.db;
        clock = { t: 1_700_000_000_000 };
        svc = new DataPackageJobService(asScopedDbSource(setup.db as any), 'secret', {
            now: () => clock.t,
            genId: (() => { let n = 0; return () => `job-${++n}`; })(),
            signToken: async (claims) => `token:${claims.tenantId}:${claims.jobId}:${claims.userId}`,
        });
    });

    const baseInput = { kind: 'export' as const, clientKind: 'desktop-windows', deviceLabel: 'laptop-A', createdBy: 'user-7' };

    it('creates a queued job with a lease and a bound job token', async () => {
        const { job, jobToken } = await svc.create(TENANT, baseInput);
        expect(job.id).toBe('job-1');
        expect(job.status).toBe('queued');
        expect(job.stage).toBe('rows');
        expect(job.leaseHolder).toBe('laptop-A');
        expect(job.leaseExpiresAt?.getTime()).toBe(clock.t + JOB_LEASE_TTL_MS);
        expect(job.tenantId).toBe(TENANT);
        expect(jobToken).toBe('token:tenant-1:job-1:user-7');
    });

    it('refuses a second active job with JOB_LEASE_HELD and the holder details', async () => {
        await svc.create(TENANT, baseInput);
        await expect(svc.create(TENANT, { ...baseInput, deviceLabel: 'laptop-B' }))
            .rejects.toMatchObject({
                code: ErrorCode.JOB_LEASE_HELD,
                status: 409,
                details: { holder: 'laptop-A', leaseExpiresAt: clock.t + JOB_LEASE_TTL_MS },
            });
    });

    it('allows one active job per tenant — different tenants do not conflict', async () => {
        await svc.create(TENANT, baseInput);
        const other = await svc.create(OTHER, baseInput);
        expect(other.job.tenantId).toBe(OTHER);
    });

    it('frees the slot once a job is terminal', async () => {
        const { job } = await svc.create(TENANT, baseInput);
        await svc.complete(TENANT, job.id, { bytes: 100, sha256: 'abc' });
        const next = await svc.create(TENANT, { ...baseInput, deviceLabel: 'laptop-B' });
        expect(next.job.id).toBe('job-2');
    });

    it('scopes get and list to the tenant', async () => {
        const { job } = await svc.create(TENANT, baseInput);
        expect((await svc.get(TENANT, job.id))?.id).toBe(job.id);
        expect(await svc.get(OTHER, job.id)).toBeNull();
        await svc.create(OTHER, baseInput);
        expect((await svc.list(TENANT)).every((j) => j.tenantId === TENANT)).toBe(true);
        expect((await svc.list(OTHER)).every((j) => j.tenantId === OTHER)).toBe(true);
    });

    it('heartbeat renews the token but does not write D1 while the lease is far from expiry', async () => {
        const { job, jobToken } = await svc.create(TENANT, baseInput);
        const first = await svc.heartbeat(TENANT, job.id, 'laptop-A');
        expect(first.wrote).toBe(false);
        expect(first.jobToken).toBe(jobToken);
        expect(first.leaseExpiresAt).toBe(clock.t + JOB_LEASE_TTL_MS);
        // The stored row is untouched.
        const stored = await db.select().from(tenantDataJobs).where(eq(tenantDataJobs.id, job.id)).all();
        expect(stored[0].updatedAt.getTime()).toBe(clock.t);
    });

    it('heartbeat writes D1 once the lease enters the write window', async () => {
        const { job } = await svc.create(TENANT, baseInput);
        clock.t += JOB_LEASE_TTL_MS - JOB_HEARTBEAT_WRITE_WINDOW_MS + 1;
        const hb = await svc.heartbeat(TENANT, job.id, 'laptop-A');
        expect(hb.wrote).toBe(true);
        expect(hb.leaseExpiresAt).toBe(clock.t + JOB_LEASE_TTL_MS);
        const stored = await db.select().from(tenantDataJobs).where(eq(tenantDataJobs.id, job.id)).all();
        expect(stored[0].leaseExpiresAt.getTime()).toBe(clock.t + JOB_LEASE_TTL_MS);
    });

    it('heartbeat refuses a different device while the lease is live', async () => {
        const { job } = await svc.create(TENANT, baseInput);
        await expect(svc.heartbeat(TENANT, job.id, 'laptop-B'))
            .rejects.toMatchObject({ code: ErrorCode.JOB_LEASE_HELD, details: { holder: 'laptop-A' } });
    });

    it('heartbeat refuses an expired lease', async () => {
        const { job } = await svc.create(TENANT, baseInput);
        clock.t += JOB_LEASE_TTL_MS + 1;
        await expect(svc.heartbeat(TENANT, job.id, 'laptop-A'))
            .rejects.toMatchObject({ code: ErrorCode.JOB_LEASE_EXPIRED });
    });

    it('resume reclaims an expired lease with a fresh token', async () => {
        const { job } = await svc.create(TENANT, baseInput);
        clock.t += JOB_LEASE_TTL_MS + 1;
        const resumed = await svc.resume(TENANT, job.id, 'laptop-B');
        expect(resumed.job.status).toBe('running');
        expect(resumed.job.leaseHolder).toBe('laptop-B');
        expect(resumed.job.leaseExpiresAt?.getTime()).toBe(clock.t + JOB_LEASE_TTL_MS);
        expect(resumed.jobToken).toBe('token:tenant-1:job-1:user-7');
    });

    it('resume refuses a job older than 14 days', async () => {
        const { job } = await svc.create(TENANT, baseInput);
        clock.t += 14 * 24 * 60 * 60 * 1000 + 1;
        await expect(svc.resume(TENANT, job.id, 'laptop-B'))
            .rejects.toMatchObject({ code: ErrorCode.JOB_LEASE_EXPIRED });
    });

    it('complete and abort are terminal and reject further mutation', async () => {
        const { job } = await svc.create(TENANT, baseInput);
        const done = await svc.complete(TENANT, job.id, { bytes: 100, sha256: 'abc', counts: '{"rows":5}' });
        expect(done.status).toBe('complete');
        expect(done.bytes).toBe(100);
        expect(done.sha256).toBe('abc');
        expect(done.counts).toBe('{"rows":5}');
        expect(done.leaseHolder).toBeNull();
        expect(done.leaseExpiresAt).toBeNull();
        await expect(svc.heartbeat(TENANT, job.id, 'laptop-A'))
            .rejects.toMatchObject({ code: ErrorCode.JOB_LEASE_EXPIRED });

        const { job: job2 } = await svc.create(TENANT, { ...baseInput, deviceLabel: 'laptop-B' });
        const aborted = await svc.abort(TENANT, job2.id, 'cancelled_by_user');
        expect(aborted.status).toBe('cancelled');
        expect(aborted.errorCode).toBe('cancelled_by_user');
        expect(aborted.leaseHolder).toBeNull();
    });

    it('resume refuses a terminated job', async () => {
        const { job } = await svc.create(TENANT, baseInput);
        await svc.abort(TENANT, job.id);
        await expect(svc.resume(TENANT, job.id, 'laptop-B'))
            .rejects.toMatchObject({ code: ErrorCode.JOB_LEASE_EXPIRED });
    });

    it('does not mask an unrelated insert error as a lease conflict', async () => {
        // A non-unique driver error must propagate, not be disguised as a 409
        // merely because another job happens to be active.
        const boom = new Error('database disk image is malformed');
        const activeRow = [{ status: 'running', leaseHolder: 'x', leaseExpiresAt: new Date(clock.t + JOB_LEASE_TTL_MS), tenantId: TENANT }];
        const mockDb = {
            select: () => ({
                from: () => ({
                    where: () => ({
                        limit: () => ({ all: async () => activeRow }),
                    }),
                }),
            }),
            insert: () => ({
                values: () => ({
                    returning: async () => { throw boom; },
                }),
            }),
        };
        const broken = new DataPackageJobService(asScopedDbSource(mockDb as any), 'secret', {
            now: () => clock.t,
            signToken: async () => 't',
        });
        await expect(broken.create(TENANT, baseInput)).rejects.toBe(boom);
    });

    it('rejects a cross-tenant get/heartbeat/complete without touching the other tenant row', async () => {
        const { job } = await svc.create(TENANT, baseInput);
        await expect(svc.heartbeat(OTHER, job.id, 'laptop-A')).rejects.toBeInstanceOf(AppError);
        await expect(svc.complete(OTHER, job.id, {})).rejects.toBeInstanceOf(AppError);
        const stored = await db.select().from(tenantDataJobs).where(eq(tenantDataJobs.id, job.id)).all();
        expect(stored[0].status).toBe('queued');
    });
});

