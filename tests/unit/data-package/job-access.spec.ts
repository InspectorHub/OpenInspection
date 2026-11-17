/** E-1 data-endpoint authorization boundary tests. */
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../db';
import { asScopedDbSource } from '../helpers/test-db';
import { authorizeDataJob } from '../../../server/lib/data-package/job-access';
import { signJobToken } from '../../../server/lib/data-package/job-token';
import { tenantDataJobs } from '../../../server/lib/db/schema/data-package';
import { ErrorCode } from '../../../server/lib/errors';

const SECRET = 'job-access-test-secret';
const CLAIMS = { tenantId: 'tenant-1', jobId: 'job-1', userId: 'user-7' };

describe('authorizeDataJob', () => {
    let db: any;

    beforeEach(async () => {
        const setup = createTestDb();
        db = setup.db;
        const now = Date.now();
        await db.insert(tenantDataJobs).values([
            {
                id: 'job-1', tenantId: 'tenant-1', kind: 'export', status: 'running', stage: 'rows',
                createdBy: 'user-7', createdAt: new Date(now), updatedAt: new Date(now),
            },
            {
                id: 'job-x', tenantId: 'tenant-2', kind: 'export', status: 'running', stage: 'rows',
                createdBy: 'user-7', createdAt: new Date(now), updatedAt: new Date(now),
            },
        ]);
    });

    const call = (over: Partial<Parameters<typeof authorizeDataJob>[2]> = {}) =>
        authorizeDataJob(asScopedDbSource(db), SECRET, { ...CLAIMS, token: 't', ...over });

    it('authorizes a valid token whose claims match the session and a tenant-scoped job', async () => {
        const token = await signJobToken(CLAIMS, SECRET);
        const job = await call({ token });
        expect(job.id).toBe('job-1');
        expect(job.tenantId).toBe('tenant-1');
    });

    it('refuses a missing token', async () => {
        await expect(call({ token: undefined })).rejects.toMatchObject({ code: ErrorCode.JOB_TOKEN_INVALID, status: 401 });
    });

    it('refuses a token minted for a different tenant, job or user than the session', async () => {
        const otherTenant = await signJobToken({ ...CLAIMS, tenantId: 'tenant-2' }, SECRET);
        const otherJob = await signJobToken({ ...CLAIMS, jobId: 'job-2' }, SECRET);
        const otherUser = await signJobToken({ ...CLAIMS, userId: 'user-9' }, SECRET);
        for (const token of [otherTenant, otherJob, otherUser]) {
            await expect(call({ token })).rejects.toMatchObject({ code: ErrorCode.JOB_TOKEN_INVALID });
        }
    });

    it('refuses a forged or wrong-secret token', async () => {
        const forged = await signJobToken(CLAIMS, 'other-secret');
        await expect(call({ token: forged })).rejects.toMatchObject({ code: ErrorCode.JOB_TOKEN_INVALID });
        await expect(call({ token: 'garbage' })).rejects.toMatchObject({ code: ErrorCode.JOB_TOKEN_INVALID });
    });

    it('refuses a job id that exists only in another tenant', async () => {
        // job-x exists, but ONLY in tenant-2. The session is tenant-1 and the
        // token binds tenant-1/job-x; a missing tenant filter would wrongly
        // return tenant-2's row. The scoped re-read must not find it.
        const token = await signJobToken({ tenantId: 'tenant-1', jobId: 'job-x', userId: 'user-7' }, SECRET);
        await expect(call({ token, jobId: 'job-x' })).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND, status: 404 });
    });

    it('refuses a cancelled/finished job even while its token is still valid', async () => {
        await db.update(tenantDataJobs).set({ status: 'cancelled' }).where(eq(tenantDataJobs.id, 'job-1'));
        const token = await signJobToken(CLAIMS, SECRET);
        await expect(call({ token })).rejects.toMatchObject({ code: ErrorCode.JOB_LEASE_EXPIRED });
    });

    it('refuses when the verified session identity is missing', async () => {
        const token = await signJobToken(CLAIMS, SECRET);
        await expect(call({ token, tenantId: '' })).rejects.toMatchObject({ code: ErrorCode.JOB_TOKEN_INVALID });
        await expect(call({ token, userId: '' })).rejects.toMatchObject({ code: ErrorCode.JOB_TOKEN_INVALID });
    });
});
