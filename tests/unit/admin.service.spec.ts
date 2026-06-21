import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { AdminService } from '../../server/services/admin.service';
import { MockKV } from './mocks';
import { createTestDb, setupSchema } from './db';
import { users, tenantInvites, inspections, inspectionAgreements, tenants, templates, agreements, agreementRequests, agreementSigners } from '../../server/lib/db/schema';
import { eq } from 'drizzle-orm';
import { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../server/lib/db/schema';

// Mock the drizzle-orm/d1 module to return our in-memory SQLite DB
vi.mock('drizzle-orm/d1', () => ({
    drizzle: vi.fn(),
}));

import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

describe('AdminService', () => {
    let adminService: AdminService;
    let mockKV: MockKV;
    let testDb: BetterSQLite3Database<typeof schema>;
    let sqlite: any;

    beforeEach(async () => {
        const setup = createTestDb();
        testDb = setup.db;
        sqlite = setup.sqlite;
        await setupSchema(sqlite);

        (mockDrizzle as any).mockReturnValue(testDb);
        mockKV = new MockKV();
        
        // Seed a default tenant to satisfy foreign keys
        await testDb.insert(tenants).values({
            id: 't1',
            name: 'Test Tenant',
            slug: 'test',
            createdAt: new Date(),
        });

        adminService = new AdminService({} as any, mockKV as any);
    });

    afterEach(() => {
        sqlite.close();
        vi.clearAllMocks();
    });

    it('should list members and pending invites for a tenant', async () => {
        const tenantId = 't1';
        
        await testDb.insert(users).values({
            id: 'u1',
            tenantId,
            email: 'admin@example.com',
            passwordHash: 'hash',
            role: 'owner',
            createdAt: new Date(),
        });

        await testDb.insert(tenantInvites).values({ 
            id: 'invite-456', 
            tenantId: 't1', 
            email: 'invite@example.com', 
            role: 'inspector', 
            status: 'pending', 
            expiresAt: new Date(Date.now() + 1000000),
            invitedBy: 'u1'
        } as any);

        const result = await adminService.getMembers(tenantId);
        expect(result.members).toHaveLength(1);
        expect(result.invites).toHaveLength(1);
    });

    it('should create a new invitation', async () => {
        const tenantId = 't1';
        const email = 'new@example.com';
        const result = await adminService.createInvite(tenantId, email, 'admin');
        expect(result.inviteId).toBeDefined();

        const invite = await testDb.select().from(tenantInvites).where(eq(tenantInvites.id as any, result.inviteId)).get();
        expect(invite).toBeDefined();
        expect(invite!.email).toBe(email);
    });

    it('getExport includes agreement_requests + agreement_signers, projects token material OUT', async () => {
        const tenantId = 't1';

        await testDb.insert(inspections).values({
            id: 'insp-export', tenantId, propertyAddress: '1 Main', clientName: 'Client',
            clientEmail: 'client@example.com', date: '2026-06-01', status: 'requested',
            paymentStatus: 'unpaid', price: 0, createdAt: new Date(),
        } as any);
        await testDb.insert(agreements).values({
            id: 'agr-tpl', tenantId, name: 'Tpl', content: 'body', createdAt: new Date(),
        } as any);
        await testDb.insert(agreementRequests).values({
            id: 'req-1', tenantId, inspectionId: 'insp-export', agreementId: 'agr-tpl',
            clientEmail: 'client@example.com', clientName: 'Client',
            token: 'PLAINTEXT-TOKEN-XYZ', tokenHash: 'HASH-REQ-ABC',
            status: 'signed', signatureBase64: 'data:image/png;base64,SIG',
            signedAt: new Date(), createdAt: new Date(),
        } as any);
        await testDb.insert(agreementSigners).values({
            id: 'sgn-1', tenantId, requestId: 'req-1',
            name: 'Client', email: 'client@example.com', role: 'client',
            tokenHash: 'HASH-SGN-DEF', tokenEnc: 't1:iv:CIPHER-GHI',
            status: 'signed', signatureBase64: 'data:image/png;base64,SIG2',
            signedAt: new Date(), createdAt: new Date(),
        } as any);

        const result: any = await adminService.getExport(tenantId);

        expect(Array.isArray(result.agreementRequests)).toBe(true);
        expect(result.agreementRequests).toHaveLength(1);
        expect(Array.isArray(result.agreementSigners)).toBe(true);
        expect(result.agreementSigners).toHaveLength(1);
        // Subject signature + content survive the export (it's their data).
        expect(result.agreementRequests[0].signatureBase64).toBe('data:image/png;base64,SIG');
        expect(result.agreementSigners[0].email).toBe('client@example.com');
        // Back-compat key retained (dead table -> empty).
        expect('inspectionAgreements' in result).toBe(true);

        // NO token material anywhere in the serialized export.
        const serialized = JSON.stringify(result);
        expect(serialized).not.toContain('PLAINTEXT-TOKEN-XYZ');
        expect(serialized).not.toContain('HASH-REQ-ABC');
        expect(serialized).not.toContain('HASH-SGN-DEF');
        expect(serialized).not.toContain('CIPHER-GHI');
        expect(serialized.toLowerCase()).not.toContain('tokenhash');
        expect(serialized.toLowerCase()).not.toContain('tokenenc');
    });

    it('should perform GDPR erasure of client data', async () => {
        const tenantId = 't1';
        const clientEmail = 'client@privacy.com';
        
        // Seed inspector
        await testDb.insert(users).values({
            id: 'u-insp',
            tenantId,
            email: 'inspector@test.com',
            passwordHash: 'hash',
            role: 'inspector',
            createdAt: new Date(),
        });

        // Seed template
        await testDb.insert(templates).values({
            id: 'temp-1',
            tenantId,
            name: 'Test Template',
            version: 1,
            schema: '{}',
            createdAt: new Date(),
        });

        // Seed inspection
        await testDb.insert(inspections).values({
            id: 'insp-1',
            tenantId,
            propertyAddress: '123 Privacy St',
            clientName: 'Original Name',
            clientEmail,
            inspectorId: 'u-insp',
            templateId: 'temp-1',
            status: 'completed',
            date: new Date().toISOString().split('T')[0], // Text column needs string
            createdAt: new Date(),
        });

        // Seed agreement
        // Note: signatureBase64 is NOT NULL in schema
        await testDb.insert(inspectionAgreements).values({
            id: 'agree-1',
            tenantId,
            inspectionId: 'insp-1',
            signatureBase64: 'data:image/png;base64,abc',
            signedAt: new Date(),
        });

        const result = await adminService.eraseClientData(tenantId, clientEmail);
        // Legacy additive contract.
        expect(result.matched).toBe(1);
        expect(result.deletedAgreements).toBe(1);
        // Richer orchestrator summary (Track I-a).
        expect(result.status).toBe('completed');
        expect(result.logId).toBeTruthy();
        expect(Array.isArray(result.decisions)).toBe(true);
        expect(typeof result.anonymizedCount).toBe('number');
        expect(typeof result.deletedCount).toBe('number');
        expect(typeof result.retainedCount).toBe('number');

        const insp = await testDb.select().from(inspections).where(eq(inspections.id as any, 'insp-1')).get();
        expect(insp).toBeDefined();
        expect(insp!.clientName).toBeNull();
        expect(insp!.clientEmail).toBeNull();

        const agree = await testDb.select().from(inspectionAgreements).where(eq(inspectionAgreements.id as any, 'agree-1')).get();
        expect(agree).toBeUndefined();

        // An append-only erasure_log decision row was written (Art. 5(2)/30).
        const logs = await testDb.select().from(schema.erasureLog).all();
        expect(logs.length).toBe(1);
        expect(logs[0].subjectEmail).toBe(clientEmail);
        expect(logs[0].status).toBe('completed');
    });

    it('eraseClientData persists requestedBy in erasure_log for Art. 30 accountability', async () => {
        const tenantId = 't1';
        const clientEmail = 'actor-test@privacy.com';
        const actorSub = 'user-sub-abc123';

        await testDb.insert(inspections).values({
            id: 'insp-actor',
            tenantId,
            propertyAddress: '99 Actor Ave',
            clientName: 'Actor Client',
            clientEmail,
            status: 'requested',
            paymentStatus: 'unpaid',
            price: 0,
            date: new Date().toISOString().split('T')[0],
            createdAt: new Date(),
        });

        await adminService.eraseClientData(tenantId, clientEmail, { requestedBy: actorSub });

        const logs = await testDb.select().from(schema.erasureLog).all();
        expect(logs.length).toBe(1);
        expect(logs[0].requestedBy).toBe(actorSub);
    });
});
