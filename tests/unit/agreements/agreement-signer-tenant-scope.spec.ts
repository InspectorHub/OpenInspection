import { describe, it, expect, beforeEach } from 'vitest';
import { AgreementService } from '../../../server/services/agreement.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { TENANT_A, INSP_ID, AGR_ID, seedBase } from '../helpers/agreement-signers-setup';

import { lazyD1 } from '../helpers/d1-binding';
const testD1 = lazyD1();

const TENANT_B = '00000000-0000-0000-0000-000000000002';

describe('AgreementService — getSignerLink cross-tenant isolation', () => {
    let svc: AgreementService;
    let db: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        await setupSchema(fixture.sqlite);
        await seedBase(db);
        testD1.use(db);
        svc = new AgreementService(testD1.binding, { jwtSecret: 'test-secret' });
    });

    it('foreign-tenant cannot retrieve signer token (same requestId + signerId, wrong tenantId)', async () => {
        // Seed a real envelope + signer under TENANT_A
        const r = await svc.findOrCreate(TENANT_A, INSP_ID, {
            signers: [{ name: 'Jane', email: 'jane@test.com', role: 'client' }],
        });
        const signers = await db.select().from(schema.agreementSigners).all();
        expect(signers.length).toBe(1);

        // Own tenant can retrieve it
        const tokenOwn = await svc.getSignerLink(TENANT_A, r.requestId, signers[0].id);
        expect(tokenOwn).toBeTruthy();

        // Foreign tenant with SAME requestId + signerId must NOT get the token
        await expect(
            svc.getSignerLink(TENANT_B, r.requestId, signers[0].id)
        ).rejects.toThrow(); // throws NotFound (or any error)
    });
});
