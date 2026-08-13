import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { AgreementService } from '../../../server/services/agreement.service';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const INSP_ID = '00000000-0000-0000-0000-000000000010';
const AGR_ID = '00000000-0000-0000-0000-000000000020';
const JWT_SECRET = 'test-secret';

// IA-37 — signer tokens gained expiresAt/revokedAt columns. Issuance stamps a
// default TTL; resolution fails closed on a revoked or expired link.
describe('signer token lifecycle (IA-37)', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: any;

    beforeEach(async () => {
        const setup = createTestDb();
        db = setup.db as BetterSQLite3Database<typeof schema>;
        sqlite = setup.sqlite;
        await setupSchema(sqlite);
        (mockDrizzle as any).mockReturnValue(db);
        await db.insert(schema.tenants).values({
            id: TENANT_ID, slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', maxUsers: 5, createdAt: new Date(),
        } as any);
        await db.insert(schema.inspections).values({
            id: INSP_ID, tenantId: TENANT_ID, propertyAddress: '1 Main St',
            date: '2026-06-01', status: 'requested', paymentStatus: 'unpaid',
            price: 50000, agreementRequired: true, paymentRequired: false, createdAt: new Date(),
        });
        await db.insert(schema.agreements).values({
            id: AGR_ID, tenantId: TENANT_ID, name: 'Standard Agreement',
            content: 'terms', version: 1, createdAt: new Date(),
        } as any);
    });

    afterEach(() => sqlite.close());

    async function newEnvelope() {
        const svc = new AgreementService({} as D1Database, { jwtSecret: JWT_SECRET });
        const r = await svc.findOrCreate(TENANT_ID, INSP_ID, {
            signers: [{ name: 'Jane', email: 'jane@test.com', role: 'client' }],
            completionPolicy: 'one',
        });
        return { svc, token: r.token, requestId: r.requestId };
    }

    it('issues signer links with a ~90-day expiry stamped', async () => {
        const { requestId } = await newEnvelope();
        const signer = await db.select().from(schema.agreementSigners)
            .where(eq(schema.agreementSigners.requestId, requestId)).get();
        expect(signer!.expiresAt).toBeInstanceOf(Date);
        const deltaDays = ((signer!.expiresAt as Date).getTime() - Date.now()) / 86_400_000;
        expect(deltaDays).toBeGreaterThan(89);
        expect(deltaDays).toBeLessThan(91);
        expect(signer!.revokedAt).toBeNull();
    });

    it('resolves a live signer token', async () => {
        const { svc, token } = await newEnvelope();
        const resolved = await svc.getSignerByPresentedToken(token);
        expect(resolved).not.toBeNull();
        expect(resolved!.signer.email).toBe('jane@test.com');
    });

    it('fails closed on a revoked signer token', async () => {
        const { svc, token, requestId } = await newEnvelope();
        await db.update(schema.agreementSigners).set({ revokedAt: new Date() })
            .where(eq(schema.agreementSigners.requestId, requestId));
        expect(await svc.getSignerByPresentedToken(token)).toBeNull();
    });

    it('fails closed on an expired signer token', async () => {
        const { svc, token, requestId } = await newEnvelope();
        await db.update(schema.agreementSigners).set({ expiresAt: new Date(Date.now() - 1000) })
            .where(eq(schema.agreementSigners.requestId, requestId));
        expect(await svc.getSignerByPresentedToken(token)).toBeNull();
    });
});
