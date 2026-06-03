import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentService } from '../../server/services/agent.service';
import { createTestDb, setupSchema } from './db';
import * as schema from '../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { EmailService } from '../../server/services/email.service';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-000000000001';
const INSPECTOR = '00000000-0000-0000-0000-000000000010';

describe('AgentService.invite — A1', () => {
    let svc: AgentService;
    let testDb: BetterSQLite3Database<typeof schema>;
    let stubEmail: { sendAgentInvite: ReturnType<typeof vi.fn> };

    beforeEach(async () => {
        const fixture = createTestDb();
        testDb = fixture.db;
        await setupSchema(fixture.sqlite);

        await testDb.insert(schema.tenants).values({
            id: TENANT,
            name: 'Acme Inspections',
            slug: 'acme',
            status: 'active',
            deploymentMode: 'shared',
            tier: 'free',
            createdAt: new Date(),
        });
        await testDb.insert(schema.users).values({
            id: INSPECTOR,
            tenantId: TENANT,
            email: 'mike@acme.com',
            name: 'Mike Reynolds',
            role: 'inspector',
            createdAt: new Date(),
            passwordHash: 'x',
        });

        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);

        stubEmail = { sendAgentInvite: vi.fn().mockResolvedValue(undefined) };
        svc = new AgentService(
            {} as D1Database,
            stubEmail as unknown as EmailService,
            'https://acme.example.com',
        );
    });

    it('creates an invite row, sends an email, and returns the token', async () => {
        const result = await svc.invite(TENANT, INSPECTOR, { email: 'jane@realty.com' });
        expect(result.token).toMatch(/^[a-f0-9]{32,}$/);
        expect(result.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
        expect(result.emailSent).toBe(true);
        expect(stubEmail.sendAgentInvite).toHaveBeenCalledTimes(1);

        const rows = await testDb.select().from(schema.agentInvites).all();
        expect(rows).toHaveLength(1);
        expect(rows[0]?.email).toBe('jane@realty.com');
        expect(rows[0]?.tenantId).toBe(TENANT);
        expect(rows[0]?.invitedByUserId).toBe(INSPECTOR);
        expect(rows[0]?.acceptedAt).toBeNull();
    });

    it('persists tenant + inspector context onto the email payload', async () => {
        await svc.invite(TENANT, INSPECTOR, { email: 'jane@realty.com' });
        const callArgs = stubEmail.sendAgentInvite.mock.calls[0];
        expect(callArgs?.[0]).toBe('jane@realty.com');
        const params = callArgs?.[1];
        expect(params?.inspectorName).toBe('Mike Reynolds');
        expect(params?.tenantName).toBe('Acme Inspections');
        expect(params?.acceptUrl).toContain('/agent-invite/accept?token=');
        expect(params?.token).toMatch(/^[a-f0-9]{32,}$/);
    });

    it('rejects a duplicate pending invite for the same email', async () => {
        await svc.invite(TENANT, INSPECTOR, { email: 'jane@realty.com' });
        await expect(svc.invite(TENANT, INSPECTOR, { email: 'jane@realty.com' }))
            .rejects.toThrow(/already pending/i);
    });

    it('lowercases the email so case variants do not bypass the duplicate check', async () => {
        await svc.invite(TENANT, INSPECTOR, { email: 'Jane@Realty.com' });
        await expect(svc.invite(TENANT, INSPECTOR, { email: 'jane@realty.com' }))
            .rejects.toThrow(/already pending/i);
    });

    it('lets a different tenant invite the same email independently', async () => {
        const TENANT_B = '00000000-0000-0000-0000-000000000002';
        const INSPECTOR_B = '00000000-0000-0000-0000-000000000011';
        await testDb.insert(schema.tenants).values({
            id: TENANT_B, name: 'Bob Co', slug: 'bobco', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await testDb.insert(schema.users).values({
            id: INSPECTOR_B, tenantId: TENANT_B, email: 'bob@bob.com', name: 'Bob',
            role: 'inspector', createdAt: new Date(), passwordHash: 'x',
        });

        await svc.invite(TENANT, INSPECTOR, { email: 'jane@realty.com' });
        await expect(svc.invite(TENANT_B, INSPECTOR_B, { email: 'jane@realty.com' }))
            .resolves.toBeDefined();
    });
});
