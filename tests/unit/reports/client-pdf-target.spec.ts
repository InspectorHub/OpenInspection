/**
 * The document a client-facing PDF is made from: the latest PUBLISHED version, keyed by its own hash.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { resolveClientPdfTarget } from '../../../server/lib/client-pdf-target';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';

const TENANT = '00000000-0000-0000-0000-0000000000c1';
const INSPECTION = 'insp-target';

describe('resolveClientPdfTarget', () => {
    let db: BetterSQLite3Database<typeof schema>;
    const hashOf = vi.fn(async (version: number | undefined) => `live-hash:${version ?? 'live'}`);

    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        await setupSchema(fixture.sqlite);
        hashOf.mockClear();
        await db.insert(schema.tenants).values({
            id: TENANT, slug: 'acme', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
    });

    const version = (versionNumber: number, contentHash: string | null) => db.insert(schema.reportVersions).values({
        id: crypto.randomUUID(), tenantId: TENANT, inspectionId: INSPECTION, versionNumber, snapshotJson: '{}',
        publishedAt: new Date(), publishedBy: 'u1', ...(contentHash ? { contentHash } : {}),
    });

    it('is the latest version, under that version\'s own hash', async () => {
        await version(1, 'hash-1');
        await version(2, 'hash-2');
        expect(await resolveClientPdfTarget(db as never, TENANT, INSPECTION, hashOf)).toEqual({ versionNumber: 2, contentHash: 'hash-2' });
        expect(hashOf).not.toHaveBeenCalled();
    });

    it('hashes the version itself when its row predates stored hashes', async () => {
        await version(1, null);
        expect(await resolveClientPdfTarget(db as never, TENANT, INSPECTION, hashOf)).toEqual({ versionNumber: 1, contentHash: 'live-hash:1' });
    });

    it('is the live report, keyed by the live hash, when nothing has been frozen', async () => {
        expect(await resolveClientPdfTarget(db as never, TENANT, INSPECTION, hashOf)).toEqual({ versionNumber: null, contentHash: 'live-hash:live' });
    });

    it('never reads another company\'s version', async () => {
        await version(1, 'hash-1');
        expect(await resolveClientPdfTarget(db as never, '00000000-0000-0000-0000-0000000000c2', INSPECTION, hashOf))
            .toEqual({ versionNumber: null, contentHash: 'live-hash:live' });
    });
});
