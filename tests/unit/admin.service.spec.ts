import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { AdminService } from '../../src/services/admin.service';
import { MockKV } from './mocks';
import { createTestDb, setupSchema } from './db';
import { users, tenantInvites, inspections, inspectionAgreements, tenants, templates } from '../../src/lib/db/schema';
import { eq } from 'drizzle-orm';
import { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../src/lib/db/schema';

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
            subdomain: 'test',
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
        expect(result.matched).toBe(1);
        expect(result.deletedAgreements).toBe(1);

        const insp = await testDb.select().from(inspections).where(eq(inspections.id as any, 'insp-1')).get();
        expect(insp).toBeDefined();
        expect(insp!.clientName).toBeNull();

        const agree = await testDb.select().from(inspectionAgreements).where(eq(inspectionAgreements.id as any, 'agree-1')).get();
        expect(agree).toBeUndefined();
    });
});
