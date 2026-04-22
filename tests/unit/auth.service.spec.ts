import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { AuthService } from '../../src/services/auth.service';
import { verifyPassword } from '../../src/lib/password';
import { MockKV } from './mocks';
import { createTestDb, setupSchema } from './db';
import { users, tenantInvites, tenants } from '../../src/lib/db/schema';
import { eq } from 'drizzle-orm';
import { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../src/lib/db/schema';

// Mock the drizzle-orm/d1 module to return our in-memory SQLite DB
vi.mock('drizzle-orm/d1', () => ({
    drizzle: vi.fn(),
}));

import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

describe('AuthService', () => {
    let authService: AuthService;
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
        
        authService = new AuthService({} as any, mockKV as any);
    });

    afterEach(() => {
        sqlite.close();
        vi.clearAllMocks();
    });

    it('should hash passwords using PBKDF2 with a random salt', async () => {
        const password = 'password123';
        const hash = await authService.hashPassword(password);
        expect(hash.startsWith('pbkdf2:')).toBe(true);
        // Random salt means two hashes of the same password must differ.
        const other = await authService.hashPassword(password);
        expect(hash).not.toBe(other);
        // Both hashes must still verify.
        expect((await verifyPassword(password, hash))[0]).toBe(true);
        expect((await verifyPassword(password, other))[0]).toBe(true);
    });

    it('should verify a legacy SHA-256 hash and signal rehash', async () => {
        // Legacy plain SHA-256 hex of "password123"
        const encoder = new TextEncoder();
        const buf = await crypto.subtle.digest('SHA-256', encoder.encode('password123'));
        const legacy = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
        const [valid, needsRehash] = await verifyPassword('password123', legacy);
        expect(valid).toBe(true);
        expect(needsRehash).toBe(true);
    });

    it('should validate valid credentials', async () => {
        const email = 'test@example.com';
        const password = 'password123';
        const hash = await authService.hashPassword(password);
        
        await testDb.insert(users).values({
            id: 'u1',
            tenantId: 't1',
            email,
            passwordHash: hash,
            role: 'owner',
            createdAt: new Date(),
        });

        const result = await authService.validateCredentials(email, password);
        expect(result.id).toBe('u1');
    });

    it('should throw error for invalid password', async () => {
        const email = 'test@example.com';
        const hash = await authService.hashPassword('correct');
        
        await testDb.insert(users).values({
            id: 'u1',
            tenantId: 't1',
            email,
            passwordHash: hash,
            role: 'owner',
            createdAt: new Date(),
        });

        await expect(authService.validateCredentials(email, 'wrong'))
            .rejects.toThrow('Invalid email or password');
    });

    it('should allow joining a team with valid invitation', async () => {
        const token = 'invite-123';
        const email = 'new@example.com';
        
        await testDb.insert(tenantInvites).values({ 
            id: token, 
            tenantId: 't1', 
            email, 
            role: 'inspector', 
            status: 'pending', 
            expiresAt: new Date(Date.now() + 1000000),
            invitedBy: 'u1'
        } as any);

        const result = await authService.joinTeam(token, 'password');
        expect(result.email).toBe(email);
        expect(result.role).toBe('inspector');

        const dbUser = await testDb.select().from(users).where(eq(users.email as any, email)).get();
        expect(dbUser).toBeDefined();
    });

    it('should handle password reset flow via KV', async () => {
        const email = 'reset@example.com';
        await testDb.insert(users).values({
            id: 'u-reset',
            tenantId: 't1',
            email,
            passwordHash: 'old',
            role: 'owner',
            createdAt: new Date(),
        });

        const token = await authService.createPasswordResetToken(email);
        expect(token).toBeDefined();
        
        (mockKV.get as any).mockResolvedValue('u-reset');

        await authService.resetPassword(token!, 'new-pass');

        const updatedUser = await testDb.select().from(users).where(eq(users.id as any, 'u-reset')).get();
        expect(updatedUser).toBeDefined();
        const [valid] = await verifyPassword('new-pass', updatedUser!.passwordHash);
        expect(valid).toBe(true);
        // Reset should also write a pwchanged invalidation marker with a 90000s TTL.
        expect(mockKV.put).toHaveBeenCalledWith(
            'pwchanged:u-reset',
            expect.any(String),
            expect.objectContaining({ expirationTtl: 90000 })
        );
    });

    it('should reject a reset token that predates the last password change', async () => {
        await testDb.insert(users).values({
            id: 'u-stale',
            tenantId: 't1',
            email: 'stale@example.com',
            passwordHash: 'old',
            role: 'owner',
            createdAt: new Date(),
        });

        // Reset token issued at t=1000, but password was changed at t=2000.
        await mockKV.put('pw_reset:stale-token', 'u-stale:1000');
        await mockKV.put('pwchanged:u-stale', '2000');

        await expect(authService.resetPassword('stale-token', 'new-pass'))
            .rejects.toThrow('Invalid or expired reset token');

        // Stale token should have been scrubbed from KV as a side effect.
        expect(await mockKV.get('pw_reset:stale-token')).toBeNull();
    });
});
