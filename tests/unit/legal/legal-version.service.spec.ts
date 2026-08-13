/**
 * Versioning a tenant's own Privacy / Terms (design §6A.3).
 *
 * The requirement is narrow and easy to satisfy wrongly: a row per publish that
 * can PRODUCE the text it describes. The three ways to get that wrong, all
 * pinned below, are (a) hashing without snapshotting, (b) minting a version
 * every time somebody saves the settings form, and (c) computing the date in
 * UTC so a company west of Greenwich reads tomorrow's date on their own policy.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { LegalVersionService } from '../../../server/services/legal-version.service';

const TENANT = 'tenant-1';

describe('LegalVersionService', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let svc: LegalVersionService;

    beforeEach(async () => {
        const fix = createTestDb();
        db = fix.db;
        await setupSchema(fix.sqlite);
        await db.insert(schema.tenants).values({
            id: TENANT, slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await db.insert(schema.tenantConfigs).values({
            tenantId: TENANT, companyName: 'Acme', defaultTimezone: 'America/Los_Angeles',
            updatedAt: new Date(),
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        svc = new LegalVersionService(db as any);
    });

    it('stores the BODY, not only a hash of it', async () => {
        await svc.recordPublish({ tenantId: TENANT, doc: 'privacy', body: 'We collect nothing.' });
        const latest = await svc.latest(TENANT, 'privacy');
        // The whole reason this table exists rather than a hash registry: the
        // source column is mutable with no git behind it, so a row that cannot
        // reproduce the text proves a change it cannot show.
        expect(latest?.bodySnapshot).toBe('We collect nothing.');
        expect(latest?.contentHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('keeps the OLD text after the source column is overwritten', async () => {
        await svc.recordPublish({ tenantId: TENANT, doc: 'privacy', body: 'First text.', now: Date.parse('2026-06-01T12:00:00Z') });
        await svc.recordPublish({ tenantId: TENANT, doc: 'privacy', body: 'Second text.', now: Date.parse('2026-06-02T12:00:00Z') });

        const all = await svc.list(TENANT, 'privacy');
        expect(all.map((r) => r.bodySnapshot)).toEqual(['Second text.', 'First text.']);
        expect(all.map((r) => r.version)).toEqual(['2026-06-02', '2026-06-01']);
    });

    it('does NOT mint a version when the text did not change', async () => {
        const at = Date.parse('2026-06-01T12:00:00Z');
        await svc.recordPublish({ tenantId: TENANT, doc: 'privacy', body: 'Same.', now: at });
        // A tenant saving an unrelated setting re-sends the same body. A
        // registry that grows a row per form submission stops meaning "the
        // document changed" on its first busy afternoon.
        const second = await svc.recordPublish({
            tenantId: TENANT, doc: 'privacy', body: 'Same.', now: at + 86_400_000,
        });
        expect(second).toBe('2026-06-01');
        expect(await svc.list(TENANT, 'privacy')).toHaveLength(1);
    });

    it('treats whitespace-only and null as the same "reverted to the template" publish', async () => {
        await svc.recordPublish({ tenantId: TENANT, doc: 'terms', body: 'Custom.', now: Date.parse('2026-06-01T12:00:00Z') });
        await svc.recordPublish({ tenantId: TENANT, doc: 'terms', body: null, now: Date.parse('2026-06-02T12:00:00Z') });
        await svc.recordPublish({ tenantId: TENANT, doc: 'terms', body: '   ', now: Date.parse('2026-06-03T12:00:00Z') });

        const all = await svc.list(TENANT, 'terms');
        // Clearing the override IS a publish and is recorded as one — "they went
        // back to the default" is exactly what a missing row would hide. But the
        // second clearing changed nothing, so it does not add a third row.
        expect(all).toHaveLength(2);
        expect(all[0].bodySnapshot).toBeNull();
        expect(all[0].version).toBe('2026-06-02');
    });

    it('dates the version in the TENANT timezone, not UTC', async () => {
        // 2026-06-02T04:00Z is still June 1st in Los Angeles. A UTC date here
        // would show a company a "last updated" one day ahead of their own
        // calendar, which is the kind of wrong that only surfaces in a complaint.
        const version = await svc.recordPublish({
            tenantId: TENANT, doc: 'privacy', body: 'Evening save.',
            now: Date.parse('2026-06-02T04:00:00Z'),
        });
        expect(version).toBe('2026-06-01');
    });

    it('collapses same-day republishes onto the text that ENDED the day', async () => {
        const morning = Date.parse('2026-06-01T16:00:00Z');   // 09:00 LA
        const evening = Date.parse('2026-06-02T01:00:00Z');   // 18:00 LA, same day
        await svc.recordPublish({ tenantId: TENANT, doc: 'privacy', body: 'Morning.', now: morning });
        await svc.recordPublish({ tenantId: TENANT, doc: 'privacy', body: 'Evening.', now: evening });

        const all = await svc.list(TENANT, 'privacy');
        expect(all).toHaveLength(1);
        expect(all[0].version).toBe('2026-06-01');
        expect(all[0].bodySnapshot).toBe('Evening.');
    });

    it('keeps privacy and terms on separate tracks', async () => {
        await svc.recordPublish({ tenantId: TENANT, doc: 'privacy', body: 'P', now: Date.parse('2026-06-01T12:00:00Z') });
        await svc.recordPublish({ tenantId: TENANT, doc: 'terms', body: 'T', now: Date.parse('2026-06-05T12:00:00Z') });
        expect((await svc.latest(TENANT, 'privacy'))?.version).toBe('2026-06-01');
        expect((await svc.latest(TENANT, 'terms'))?.version).toBe('2026-06-05');
    });

    it('reports no version at all before the first publish', async () => {
        // The page then says nothing rather than inventing a date.
        expect(await svc.latest(TENANT, 'privacy')).toBeNull();
    });

    it('never lets one tenant read another tenant version', async () => {
        await db.insert(schema.tenants).values({
            id: 'tenant-2', slug: 'other', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await svc.recordPublish({ tenantId: TENANT, doc: 'privacy', body: 'Acme text.' });
        expect(await svc.latest('tenant-2', 'privacy')).toBeNull();
    });

    it('records is_material so opt-in re-acceptance stays possible without a backfill', async () => {
        await svc.recordPublish({ tenantId: TENANT, doc: 'privacy', body: 'Big change.', isMaterial: true });
        expect((await svc.latest(TENANT, 'privacy'))?.isMaterial).toBe(true);
    });
});
