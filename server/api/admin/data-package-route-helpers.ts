/** Shared request helpers for the data-package sub-router and its split handlers. */
import type { Context } from 'hono';
import { getDrizzle } from '../../lib/route-helpers';
import type { DrizzleDB } from '../../lib/db/scoped';
import { authorizeDataJob } from '../../lib/data-package/job-access';
import type { HonoConfig } from '../../types/hono';

export function envOf(c: Context<HonoConfig>) {
    // getDrizzle() is schema-agnostic (drizzle<any>); the data-package services
    // are typed against the full schema. The underlying D1 handle is identical.
    return {
        db: getDrizzle(c) as DrizzleDB,
        secret: c.env.JWT_SECRET,
        tenantId: c.get('tenantId')!,
        userId: c.get('user')!.sub,
    };
}

export async function authorize(c: Context<HonoConfig>, jobId: string) {
    const { db, secret, tenantId, userId } = envOf(c);
    const token = c.req.header('X-Data-Job');
    const job = await authorizeDataJob(db, secret, { tenantId, userId, jobId, token });
    return { job, db };
}
