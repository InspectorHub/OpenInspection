import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentSignupPage } from '../../src/templates/pages/agent-signup';
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

describe('AgentSignupPage — A1', () => {
    it('uses the split-screen layout (left value-prop, right form) — directive 3', () => {
        const html = render(AgentSignupPage({ siteKey: 'turnstile' }));
        expect(html).toMatch(/data-testid="signup-value-prop"/);
        expect(html).toMatch(/data-testid="signup-form"/);
    });

    it('exposes the canonical form fields (email, password, name)', () => {
        const html = render(AgentSignupPage({ siteKey: 'k' }));
        expect(html).toMatch(/name="email"/);
        expect(html).toMatch(/name="password"/);
        expect(html).toMatch(/name="name"/);
    });

    it('renders the editorial Fraunces headline', () => {
        const html = render(AgentSignupPage({ siteKey: 'k' }));
        expect(html).toContain('Fraunces');
        expect(html.toLowerCase()).toContain('partner agent');
    });

    it('renders the Turnstile sitekey when provided', () => {
        const html = render(AgentSignupPage({ siteKey: 'my-site-key' }));
        expect(html).toContain('my-site-key');
    });

    it('omits Turnstile widget gracefully when no sitekey is provided', () => {
        const html = render(AgentSignupPage({}));
        expect(html).not.toContain('cf-turnstile');
    });
});

const TENANT = '00000000-0000-0000-0000-000000000001';

describe('AgentService.signup — A1', () => {
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

    it('creates a global agent user with tenant_id NULL', async () => {
        const result = await svc.signup({
            email: 'jane@realty.com',
            password: 'CorrectHorseBatteryStaple1!',
            name: 'Jane Smith',
        });
        expect(result.userId).toMatch(/^[0-9a-f-]{36}$/);

        const rows = await testDb.select().from(schema.users).all();
        const jane = rows.find((u) => u.email === 'jane@realty.com');
        expect(jane).toBeDefined();
        expect(jane?.tenantId).toBeNull();
        expect(jane?.role).toBe('agent');
        expect(jane?.name).toBe('Jane Smith');
    });

    it('rejects duplicate email with 409 — caller should redirect to login', async () => {
        await svc.signup({ email: 'jane@realty.com', password: 'Password123456!', name: 'Jane' });
        await expect(
            svc.signup({ email: 'jane@realty.com', password: 'OtherPwd!1234567', name: 'Jane Two' }),
        ).rejects.toThrow(/already exists/i);
    });

    it('auto-links to every tenant that already had this email as type=agent contact', async () => {
        const TENANT_B = '00000000-0000-0000-0000-000000000002';
        await testDb.insert(schema.tenants).values({
            id: TENANT_B, name: 'Bob Co', subdomain: 'bobco', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await testDb.insert(schema.contacts).values([
            { id: 'c1', tenantId: TENANT, type: 'agent', name: 'Jane', email: 'jane@realty.com', createdAt: new Date() },
            { id: 'c2', tenantId: TENANT_B, type: 'agent', name: 'Jane', email: 'jane@realty.com', createdAt: new Date() },
            { id: 'c3', tenantId: TENANT, type: 'client', name: 'Other Jane', email: 'jane@realty.com', createdAt: new Date() },
        ]);

        await svc.signup({ email: 'jane@realty.com', password: 'StrongPass1234!', name: 'Jane' });
        const links = await testDb.select().from(schema.agentTenantLinks).all();
        expect(links).toHaveLength(2);
        const tenantIds = links.map((l) => l.tenantId).sort();
        expect(tenantIds).toEqual([TENANT, TENANT_B].sort());
        // All auto-links default to active.
        for (const link of links) expect(link.status).toBe('active');
    });

    it('lowercases the email so case variants do not bypass the duplicate check', async () => {
        await svc.signup({ email: 'Jane@Realty.COM', password: 'StrongPass1234!', name: 'Jane' });
        await expect(
            svc.signup({ email: 'JANE@realty.com', password: 'AnotherPass!12345', name: 'Imposter' }),
        ).rejects.toThrow(/already exists/i);
    });
});
