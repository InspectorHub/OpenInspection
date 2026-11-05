/**
 * The slug in a URL the server builds for the headless browser comes from the company's own row. Only when the row has none is the
 * request's `:tenant` segment considered, and then only if it is a plain slug.
 */
import { describe, it, expect } from 'vitest';
import { createTestDb } from '../db';
import { toD1Binding } from '../helpers/d1-binding';
import * as schema from '../../../server/lib/db/schema';
import { companySlugFor } from '../../../server/lib/report-link-access';

async function ctxWith(slug: string) {
    const { sqlite, db } = createTestDb();
    await db.insert(schema.tenants).values({ id: 't1', slug, status: 'active', deploymentMode: 'shared', tier: 'free', maxUsers: 5, createdAt: new Date() } as never);
    return { env: { DB: toD1Binding(sqlite) } } as never;
}

describe('companySlugFor', () => {
    it('uses the company slug whatever segment the request carried', async () => {
        const c = await ctxWith('acme');
        expect(await companySlugFor(c, 't1', 'acme')).toBe('acme');
        expect(await companySlugFor(c, 't1', 'other')).toBe('acme');
        expect(await companySlugFor(c, 't1', 'x/../../api?')).toBe('acme');
    });

    it('falls back to the request segment only when the company has no slug and the segment is a plain slug', async () => {
        const c = await ctxWith('');
        expect(await companySlugFor(c, 't1', 'plain-slug')).toBe('plain-slug');
        expect(await companySlugFor(c, 't1', 'x/../../api?')).toBe('');
        expect(await companySlugFor(c, 't1', '..')).toBe('');
        expect(await companySlugFor(c, 'unknown-company', 'plain-slug')).toBe('plain-slug');
    });
});
