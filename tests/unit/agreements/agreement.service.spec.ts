import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgreementService } from '../../../server/services/agreement.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { TENANT_A, INSP_ID, seedBase } from '../helpers/agreement-signers-setup';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

// Basic single-signer transition coverage (findOrCreate/markViewedBySigner/
// markSignedBySigner/markDeclinedBySigner/expireOlderThan happy paths) lives
// in agreement-signers.spec.ts (the canonical state-machine suite, which also
// owns getSignerLinkByEmail — moved there). This file keeps only the one
// transition NOT covered there: signing a signer that already declined.
describe('AgreementService', () => {
    let svc: AgreementService;
    let testDb: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fixture = createTestDb();
        testDb = fixture.db;
        await setupSchema(fixture.sqlite);
        await seedBase(testDb);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
        svc = new AgreementService({} as D1Database, { jwtSecret: 'test-secret' });
    });

    it('markSignedBySigner on a declined signer throws Conflict', async () => {
        const { token } = await svc.findOrCreate(TENANT_A, INSP_ID);
        await svc.markDeclinedBySigner(token);
        await expect(svc.markSignedBySigner(token, 'sig', { signedAtMs: Date.now(), channel: 'remote' })).rejects.toThrow();
    });
});
