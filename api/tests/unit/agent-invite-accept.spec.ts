import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentInviteAcceptPage } from '../../src/templates/pages/agent-invite-accept';
import { AgentInviteExpiredPage } from '../../src/templates/pages/agent-invite-expired';
import { AgentService } from '../../src/services/agent.service';
import { createTestDb, setupSchema } from './db';
import * as schema from '../../src/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { EmailService } from '../../src/services/email.service';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

function render(node: JSX.Element): string {
    return String(node as unknown as { toString(): string });
}

describe('AgentInviteAcceptPage — A1', () => {
    it('leads with inspector name + tenant name (frontend-design directive 1)', () => {
        const html = render(
            AgentInviteAcceptPage({
                token: 'tok123',
                inspector: { name: 'Mike Reynolds', photoUrl: 'https://r2/me.jpg' },
                tenantName: 'Acme Inspections',
                inviteEmail: 'jane@realty.com',
            }),
        );
        expect(html).toContain('Mike Reynolds');
        expect(html).toContain('Acme Inspections');
        expect(html).toContain('me.jpg');
    });

    it('renders the three value-prop icons before the form', () => {
        const html = render(
            AgentInviteAcceptPage({
                token: 'x',
                inspector: { name: 'M' },
                tenantName: 'A',
                inviteEmail: 'j@x.com',
            }),
        );
        expect(html).toMatch(/data-testid="value-prop-1"/);
        expect(html).toMatch(/data-testid="value-prop-2"/);
        expect(html).toMatch(/data-testid="value-prop-3"/);
    });

    it('pre-fills the email field as readonly so the recipient cannot retarget', () => {
        const html = render(
            AgentInviteAcceptPage({
                token: 'x',
                inspector: { name: 'M' },
                tenantName: 'A',
                inviteEmail: 'jane@realty.com',
            }),
        );
        expect(html).toMatch(/value="jane@realty\.com"/);
        expect(html).toMatch(/readonly/);
    });

    it('uses Fraunces serif for the editorial heading', () => {
        const html = render(
            AgentInviteAcceptPage({
                token: 'x',
                inspector: { name: 'M' },
                tenantName: 'A',
                inviteEmail: 'j@x.com',
            }),
        );
        expect(html).toContain('Fraunces');
    });

    it('falls back gracefully when inspector photoUrl is omitted', () => {
        const html = render(
            AgentInviteAcceptPage({
                token: 'x',
                inspector: { name: 'Mike' },
                tenantName: 'A',
                inviteEmail: 'j@x.com',
            }),
        );
        expect(html).not.toContain('undefined');
        expect(html).toContain('Mike');
    });
});

describe('AgentInviteExpiredPage — A1', () => {
    it('offers the friendly "ask Inspector to send a new invite" recovery (directive 2)', () => {
        const html = render(
            AgentInviteExpiredPage({
                reason: 'expired',
                inviterEmail: 'mike@acme.com',
                inviterName: 'Mike',
            }),
        );
        expect(html.toLowerCase()).toContain('ask');
        expect(html.toLowerCase()).toContain('mike');
        expect(html).toMatch(/mailto:mike@acme\.com/);
    });

    it('handles the no-token reason without dead-ending the user', () => {
        const html = render(AgentInviteExpiredPage({ reason: 'no-token' }));
        expect(html.toLowerCase()).toContain('invite');
        // Recovery copy should still be present even without an inviter email.
        expect(html.length).toBeGreaterThan(200);
    });
});

const TENANT = '00000000-0000-0000-0000-000000000001';
const INSPECTOR = '00000000-0000-0000-0000-000000000010';

describe('AgentService.resolveInvite + acceptInvite — A1', () => {
    let svc: AgentService;
    let testDb: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fixture = createTestDb();
        testDb = fixture.db;
        await setupSchema(fixture.sqlite);

        await testDb.insert(schema.tenants).values({
            id: TENANT, name: 'Acme', subdomain: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await testDb.insert(schema.users).values({
            id: INSPECTOR, tenantId: TENANT, email: 'mike@acme.com', name: 'Mike',
            role: 'inspector', createdAt: new Date(), passwordHash: 'x',
        });

        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
        const stubEmail: Pick<EmailService, 'sendAgentInvite'> = {
            sendAgentInvite: vi.fn().mockResolvedValue(undefined),
        };
        svc = new AgentService(
            {} as D1Database,
            stubEmail as unknown as EmailService,
            'https://acme.example.com',
        );
    });

    it('resolveInvite returns invite metadata for a fresh token', async () => {
        const invite = await svc.invite(TENANT, INSPECTOR, { email: 'jane@realty.com' });
        const resolved = await svc.resolveInvite(invite.token);
        expect(resolved).not.toBeNull();
        expect(resolved?.expired).toBe(false);
        expect(resolved?.email).toBe('jane@realty.com');
        expect(resolved?.tenantName).toBe('Acme');
        expect(resolved?.inspector.name).toBe('Mike');
    });

    it('resolveInvite flags expired tokens', async () => {
        // Insert an already-expired invite directly so we don't have to wait.
        const expiredAt = new Date(Date.now() - 1000);
        await testDb.insert(schema.agentInvites).values({
            token: 'expired-tok',
            tenantId: TENANT,
            email: 'jane@realty.com',
            invitedByUserId: INSPECTOR,
            expiresAt: expiredAt,
            createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
        });
        const resolved = await svc.resolveInvite('expired-tok');
        expect(resolved?.expired).toBe(true);
        // Inviter contact info still surfaced so the page can offer recovery copy.
        expect(resolved?.inviterEmail).toBe('mike@acme.com');
    });

    it('acceptInvite creates the user + active link + flips accepted_at', async () => {
        const invite = await svc.invite(TENANT, INSPECTOR, { email: 'jane@realty.com' });
        const result = await svc.acceptInvite(invite.token, {
            password: 'CorrectHorseBatteryStaple1!',
            name: 'Jane Smith',
        });

        expect(result.userId).toMatch(/^[0-9a-f-]{36}$/);

        const userRow = await testDb.select().from(schema.users).all();
        const agent = userRow.find((u) => u.email === 'jane@realty.com');
        expect(agent).toBeDefined();
        expect(agent?.tenantId).toBeNull();
        expect(agent?.role).toBe('agent');
        expect(agent?.name).toBe('Jane Smith');

        const links = await testDb.select().from(schema.agentTenantLinks).all();
        const acmeLink = links.find((l) => l.tenantId === TENANT);
        expect(acmeLink).toBeDefined();
        expect(acmeLink?.status).toBe('active');
        expect(acmeLink?.agentUserId).toBe(result.userId);

        const inviteRow = await testDb
            .select()
            .from(schema.agentInvites)
            .all();
        expect(inviteRow[0]?.acceptedAt).not.toBeNull();
    });

    it('acceptInvite rejects expired tokens', async () => {
        await testDb.insert(schema.agentInvites).values({
            token: 'expired-tok-2',
            tenantId: TENANT,
            email: 'jane@realty.com',
            invitedByUserId: INSPECTOR,
            expiresAt: new Date(Date.now() - 1000),
            createdAt: new Date(),
        });
        await expect(
            svc.acceptInvite('expired-tok-2', { password: 'pw1234567890!', name: 'Jane' }),
        ).rejects.toThrow(/expired/i);
    });

    it('acceptInvite is idempotent — second call on used token throws', async () => {
        const invite = await svc.invite(TENANT, INSPECTOR, { email: 'jane@realty.com' });
        await svc.acceptInvite(invite.token, {
            password: 'CorrectHorseBatteryStaple1!',
            name: 'Jane',
        });
        await expect(
            svc.acceptInvite(invite.token, {
                password: 'AnotherPassword1!',
                name: 'Jane',
            }),
        ).rejects.toThrow(/already/i);
    });
});
