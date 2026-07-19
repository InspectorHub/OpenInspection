/**
 * Spec 3 Task 3 — POST /api/agent/report-context, the read-only probe the
 * portal report-landing BFF loader (app/routes/public/portal-inspection.tsx)
 * uses to decide which CTA to render below the report.
 *
 * Harness mirrors tests/unit/agent/magic-login.spec.ts — a real seeded
 * better-sqlite3 db behind a mocked drizzle('drizzle-orm/d1'), with
 * PeopleService + AgentService constructed directly (not hand-rolled chain
 * stubs) so kindForKey/accountExistsForEmail exercise real queries.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

import { OpenAPIHono } from '@hono/zod-openapi';
// eslint-disable-next-line import/order
import { agentReportContextRoutes } from '../../../server/api/agent/report-context';
import { PeopleService } from '../../../server/services/people.service';
import { AgentService } from '../../../server/services/agent.service';
import type { HonoConfig } from '../../../server/types/hono';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

const TENANT_ID = '00000000-0000-0000-0000-0000000000a1';
const INSP_ID = '00000000-0000-0000-0000-0000000000b1';
const AGENT_USER_ID = '00000000-0000-0000-0000-0000000000c1';
const AGENT_EMAIL = 'agent@example.com';
const CLIENT_EMAIL = 'client@example.com';

describe('POST /api/agent/report-context', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: any; // eslint-disable-line @typescript-eslint/no-explicit-any

    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        sqlite = fixture.sqlite;
        await setupSchema(sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);

        await db.insert(schema.tenants).values({
            id: TENANT_ID, name: 'Acme', slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        } as any);
    });

    afterEach(() => sqlite.close());

    async function seedRoleProfile(key: string, kind: 'agent' | 'client' | 'other') {
        const now = new Date();
        await db.insert(schema.contactRoleProfiles).values({
            id: crypto.randomUUID(), tenantId: TENANT_ID, key, label: key,
            kind, isSystem: false, sortOrder: 0, active: true,
            createdAt: now, updatedAt: now,
        } as any);
    }

    async function seedGlobalAgent(id: string, email: string) {
        await db.insert(schema.users).values({
            id, tenantId: null, email, name: 'Agent Smith', role: 'agent',
            createdAt: new Date(), passwordHash: 'x',
        } as any);
    }

    function buildApp(resolveToken: ReturnType<typeof vi.fn>) {
        const app = new OpenAPIHono<HonoConfig>();
        app.use('*', async (c, next) => {
            c.env = { DB: {} } as unknown as HonoConfig['Bindings'];
            c.set('services', {
                portalAccess: { resolveToken },
                people: new PeopleService({ DB: {} as D1Database }),
                agent: new AgentService({} as D1Database, {} as any, ''),
            } as unknown as HonoConfig['Variables']['services']);
            await next();
        });
        app.route('/api/agent', agentReportContextRoutes);
        return app;
    }

    async function postContext(app: OpenAPIHono<HonoConfig>, token = 'live-report-token') {
        const res = await app.request('/api/agent/report-context', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ tenant: 'acme', inspectionId: INSP_ID, token }),
        });
        return { res, body: (await res.json()) as { data: { kind: string | null; recipientEmail?: string; hasAccount?: boolean } } };
    }

    it('agent-kind token + an existing agent account → kind:agent, recipientEmail, hasAccount:true', async () => {
        await seedRoleProfile('buyer_agent', 'agent');
        await seedGlobalAgent(AGENT_USER_ID, AGENT_EMAIL);

        const resolveToken = vi.fn().mockResolvedValue({
            inspectionId: INSP_ID, tenantId: TENANT_ID, role: 'buyer_agent',
            recipientEmail: AGENT_EMAIL, revokedAt: null, expiresAt: null,
        });
        const app = buildApp(resolveToken);

        const { res, body } = await postContext(app);
        expect(res.status).toBe(200);
        expect(body.data).toEqual({ kind: 'agent', recipientEmail: AGENT_EMAIL, hasAccount: true });
    });

    it('agent-kind token, no agent account yet → kind:agent, hasAccount:false', async () => {
        await seedRoleProfile('buyer_agent', 'agent');
        // Deliberately no users row for this email.

        const resolveToken = vi.fn().mockResolvedValue({
            inspectionId: INSP_ID, tenantId: TENANT_ID, role: 'buyer_agent',
            recipientEmail: 'nobody@example.com', revokedAt: null, expiresAt: null,
        });
        const app = buildApp(resolveToken);

        const { res, body } = await postContext(app);
        expect(res.status).toBe(200);
        expect(body.data).toEqual({ kind: 'agent', recipientEmail: 'nobody@example.com', hasAccount: false });
    });

    it('client-kind token → kind:client, no recipientEmail/hasAccount', async () => {
        await seedRoleProfile('client', 'client');

        const resolveToken = vi.fn().mockResolvedValue({
            inspectionId: INSP_ID, tenantId: TENANT_ID, role: 'client',
            recipientEmail: CLIENT_EMAIL, revokedAt: null, expiresAt: null,
        });
        const app = buildApp(resolveToken);

        const { res, body } = await postContext(app);
        expect(res.status).toBe(200);
        expect(body.data).toEqual({ kind: 'client' });
    });

    it('invalid/expired/mismatched report token → 200 kind:null (not a 401)', async () => {
        const resolveToken = vi.fn().mockResolvedValue(null);
        const app = buildApp(resolveToken);

        const { res, body } = await postContext(app, 'bad-token');
        expect(res.status).toBe(200);
        expect(body.data).toEqual({ kind: null });
    });
});
