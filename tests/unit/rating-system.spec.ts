/**
 * Sprint 2 S2-1 — RatingSystemService unit suite.
 *
 * Critical invariants:
 *   - seedDefaults is idempotent (re-runs are no-ops)
 *   - seed systems are read-only (cannot edit / delete)
 *   - clone produces an editable copy with fresh level UUIDs
 *   - delete refuses when any template still binds the system
 *   - default flag is mutually exclusive within a tenant
 *   - tenants cannot read each other's systems
 *   - hardcoded recommendation enum has 50+ entries with unique slugs
 *   - report-utils + bucket mapping survives the new shape
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RatingSystemService } from '../../server/services/rating-system.service';
import { RECOMMENDATION_CATEGORIES, getRecommendationCategory, getRecommendationPhrase } from '../../server/lib/recommendation-categories';
import { createTestDb, setupSchema } from './db';
import * as schema from '../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT_A = '00000000-0000-0000-0000-000000000001';
const TENANT_B = '00000000-0000-0000-0000-000000000002';

async function seedTenants(testDb: BetterSQLite3Database<typeof schema>) {
    await testDb.insert(schema.tenants).values([
        { id: TENANT_A, name: 'A', subdomain: 'a', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
        { id: TENANT_B, name: 'B', subdomain: 'b', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
    ]);
}

describe('RatingSystemService — seed + tenant scope', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let svc: RatingSystemService;

    beforeEach(async () => {
        const setup = createTestDb();
        testDb = setup.db;
        await setupSchema(setup.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        svc = new RatingSystemService({} as any);
        await seedTenants(testDb);
    });

    it('seeds the four canonical systems and is idempotent', async () => {
        const first = await svc.seedDefaults(TENANT_A);
        expect(first.inserted).toBe(4);
        expect(first.skipped).toBe(0);

        const second = await svc.seedDefaults(TENANT_A);
        expect(second.inserted).toBe(0);
        expect(second.skipped).toBe(4);

        const list = await svc.list(TENANT_A);
        expect(list).toHaveLength(4);
        const slugs = list.map(s => s.slug).sort();
        expect(slugs).toEqual(['itb', 'itb-3', 'oi-4tier', 'trec']);
        // Levels are normalized + sorted
        const oi4 = list.find(s => s.slug === 'oi-4tier')!;
        expect(oi4.levels.length).toBe(5);
        expect(oi4.levels[0]!.order).toBe(0);
        expect(oi4.isDefault).toBe(true);
        expect(oi4.isSeed).toBe(true);
    });

    it('isolates each tenant\'s systems', async () => {
        await svc.seedDefaults(TENANT_A);
        const aList = await svc.list(TENANT_A);
        const bList = await svc.list(TENANT_B);
        expect(aList).toHaveLength(4);
        expect(bList).toHaveLength(0);
    });

    it('refuses to edit or delete seed systems', async () => {
        await svc.seedDefaults(TENANT_A);
        const seed = (await svc.list(TENANT_A))[0]!;
        await expect(svc.update(seed.id, TENANT_A, { name: 'Renamed' })).rejects.toThrow(/read-only/);
        await expect(svc.delete(seed.id, TENANT_A)).rejects.toThrow(/cannot be deleted/);
    });

    it('clones a seed into an editable custom copy', async () => {
        await svc.seedDefaults(TENANT_A);
        const seed = (await svc.list(TENANT_A)).find(s => s.slug === 'trec')!;
        const cloned = await svc.clone(seed.id, TENANT_A, 'TREC (Custom)');
        expect(cloned.isSeed).toBe(false);
        expect(cloned.name).toBe('TREC (Custom)');
        expect(cloned.levels).toHaveLength(seed.levels.length);
        // Level ids are fresh
        const seedIds = new Set(seed.levels.map(l => l.id));
        const cloneIds = new Set(cloned.levels.map(l => l.id));
        for (const id of cloneIds) expect(seedIds.has(id)).toBe(false);

        // The clone is mutable now
        const updated = await svc.update(cloned.id, TENANT_A, { name: 'TREC (Renamed)' });
        expect(updated.name).toBe('TREC (Renamed)');
    });

    it('refuses to delete a system referenced by a template', async () => {
        await svc.seedDefaults(TENANT_A);
        const seed = (await svc.list(TENANT_A)).find(s => s.slug === 'oi-4tier')!;
        const cloned = await svc.clone(seed.id, TENANT_A, 'My System');
        // Bind a template to the clone
        await testDb.insert(schema.templates).values({
            id: '11111111-1111-1111-1111-111111111111',
            tenantId: TENANT_A,
            name: 'T',
            schema: { schemaVersion: 2, sections: [] },
            version: 1,
            createdAt: new Date(),
            ratingSystemId: cloned.id,
        });
        await expect(svc.delete(cloned.id, TENANT_A)).rejects.toThrow(/template/);
    });

    it('makes default flag mutually exclusive within a tenant', async () => {
        await svc.seedDefaults(TENANT_A);
        const seed = (await svc.list(TENANT_A)).find(s => s.slug === 'trec')!;
        const a = await svc.clone(seed.id, TENANT_A, 'A');
        const b = await svc.clone(seed.id, TENANT_A, 'B');
        await svc.update(a.id, TENANT_A, { isDefault: true });
        await svc.update(b.id, TENANT_A, { isDefault: true });

        const list = await svc.list(TENANT_A);
        const defaults = list.filter(s => s.isDefault);
        expect(defaults).toHaveLength(1);
        expect(defaults[0]!.id).toBe(b.id);
    });

    it('rejects duplicate slugs within a tenant', async () => {
        await svc.create(TENANT_A, {
            name: 'X', slug: 'my-system', isDefault: false,
            levels: [
                { abbr: 'A', label: 'Apple',  color: '#10b981', bucket: 'satisfactory' },
                { abbr: 'B', label: 'Banana', color: '#ef4444', bucket: 'defect' },
            ],
        });
        await expect(svc.create(TENANT_A, {
            name: 'Y', slug: 'my-system', isDefault: false,
            levels: [
                { abbr: 'A', label: 'Apple',  color: '#10b981', bucket: 'satisfactory' },
                { abbr: 'B', label: 'Banana', color: '#ef4444', bucket: 'defect' },
            ],
        })).rejects.toThrow(/already exists/);
    });

    it('resolveForTemplate falls back to tenant default when template is unbound', async () => {
        await svc.seedDefaults(TENANT_A);
        const sys = await svc.resolveForTemplate(null, TENANT_A);
        expect(sys?.slug).toBe('oi-4tier');
    });

    it('resolveForTemplate honors a template\'s explicit rating_system_id', async () => {
        await svc.seedDefaults(TENANT_A);
        const trec = (await svc.list(TENANT_A)).find(s => s.slug === 'trec')!;
        const tplId = '22222222-2222-2222-2222-222222222222';
        await testDb.insert(schema.templates).values({
            id: tplId, tenantId: TENANT_A, name: 'T',
            schema: { schemaVersion: 2, sections: [] }, version: 1, createdAt: new Date(),
            ratingSystemId: trec.id,
        });
        const sys = await svc.resolveForTemplate(tplId, TENANT_A);
        expect(sys?.slug).toBe('trec');
    });
});

describe('Recommendation categories enum (S2-3)', () => {
    it('exposes more than 50 contractor categories', () => {
        expect(RECOMMENDATION_CATEGORIES.length).toBeGreaterThanOrEqual(50);
    });

    it('uses unique stable slugs', () => {
        const slugs = RECOMMENDATION_CATEGORIES.map(c => c.id);
        const set = new Set(slugs);
        expect(set.size).toBe(slugs.length);
    });

    it('every entry has a non-empty defaultPhrase', () => {
        for (const c of RECOMMENDATION_CATEGORIES) {
            expect(c.defaultPhrase.length).toBeGreaterThan(0);
            expect(c.label.length).toBeGreaterThan(0);
            expect(c.group.length).toBeGreaterThan(0);
        }
    });

    it('lookup helpers return the matching phrase or empty string', () => {
        const electrician = getRecommendationCategory('electrician');
        expect(electrician).toBeTruthy();
        expect(electrician?.label).toMatch(/Electrician/);

        expect(getRecommendationPhrase('electrician')).toMatch(/electrician/i);
        expect(getRecommendationPhrase(null)).toBe('');
        expect(getRecommendationPhrase('nope-not-a-slug')).toBe('');
    });
});
