import { describe, it, expect, beforeEach } from 'vitest';
import { signViaClaim } from '../helpers/sign-via-claim';
import { AgreementService } from '../../../server/services/agreement.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { TENANT_A, INSP_ID, seedBase } from '../helpers/agreement-signers-setup';

import { lazyD1 } from '../helpers/d1-binding';
const testD1 = lazyD1();

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
        testD1.use(testDb);
        svc = new AgreementService(testD1.binding, { jwtSecret: 'test-secret' });
    });

    it('markSignedBySigner on a declined signer throws Conflict', async () => {
        const { token } = await svc.findOrCreate(TENANT_A, INSP_ID);
        await svc.markDeclinedBySigner(token);
        await expect(signViaClaim(svc, token, 'sig', { signedAtMs: Date.now(), channel: 'remote', languageDisclosureVersion: null })).rejects.toThrow();
    });
});
