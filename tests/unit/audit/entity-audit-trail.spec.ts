/**
 * IA-64 — GET /api/audit/entity/:entityId exposes the change history that was
 * already being WRITTEN (template and comment audit rows) but never read back.
 * Must be tenant-scoped (never leak another tenant's history), newest-first,
 * and resolve the actor's name.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { OpenAPIHono } from '@hono/zod-openapi';
import auditRoutes from '../../../server/api/audit';
import type { HonoConfig } from '../../../server/types/hono';
import { makeExecutionContext } from '../helpers/exec-ctx';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTHER_TENANT = '00000000-0000-0000-0000-0000000000ff';
const USER = 'user-1';
const TEMPLATE = 'tmpl-1';

let db: BetterSQLite3Database<typeof schema>;

function buildApp() {
    const app = new OpenAPIHono<HonoConfig>();
    app.use('*', async (c, next) => {
        c.set('userRole', 'owner' as never);
        c.set('tenantId', TENANT);
        await next();
    });
    app.route('/api/audit', auditRoutes);
    return app;
}

const ENV = { DB: {} } as never;
// Settled at teardown by the helper. A no-op stub still lets the promise RUN --
// it only removes any way to await it, which is how a run with every test
// passing could still exit 1 on an unhandled teardown rejection.
const CTX = makeExecutionContext().ctx;

type Entry = { id: string; action: string; actorId: string | null; actorName: string | null; createdAt: number };

async function seedAudit(rows: Array<{ id: string; tenantId: string; entityId: string | null; action: string; userId: string | null; at: number }>) {
    await db.insert(schema.auditLogs).values(rows.map(r => ({
        id: r.id, tenantId: r.tenantId, userId: r.userId, action: r.action,
        entityType: 'template', entityId: r.entityId, createdAt: new Date(r.at),
    })) as never);
}

describe('GET /api/audit/entity/:entityId (IA-64)', () => {
    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        await setupSchema(fixture.sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);

        await db.insert(schema.tenants).values([
            { id: TENANT, slug: 'acme', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
            { id: OTHER_TENANT, slug: 'rival', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
        ]);
        await db.insert(schema.users).values({
            id: USER, tenantId: TENANT, email: 'ed@acme.test', passwordHash: 'x', name: 'Ed Editor', createdAt: new Date(),
        } as never);
    });

    it('returns the entity history newest-first with the actor name resolved', async () => {
        await seedAudit([
            { id: 'a1', tenantId: TENANT, entityId: TEMPLATE, action: 'template.create', userId: USER, at: 1000 },
            { id: 'a2', tenantId: TENANT, entityId: TEMPLATE, action: 'template.update', userId: USER, at: 3000 },
            { id: 'a3', tenantId: TENANT, entityId: TEMPLATE, action: 'template.update', userId: USER, at: 2000 },
        ]);

        const res = await buildApp().request(`/api/audit/entity/${TEMPLATE}`, {}, ENV, CTX);
        expect(res.status).toBe(200);
        const entries = ((await res.json()) as { data: { entries: Entry[] } }).data.entries;
        expect(entries.map(e => e.id)).toEqual(['a2', 'a3', 'a1']); // newest first
        expect(entries[0].actorName).toBe('Ed Editor');
        expect(entries[0].action).toBe('template.update');
    });

    it('never leaks another tenant\'s audit rows for the same entity id', async () => {
        await seedAudit([
            { id: 'mine', tenantId: TENANT, entityId: TEMPLATE, action: 'template.update', userId: USER, at: 1000 },
            { id: 'theirs', tenantId: OTHER_TENANT, entityId: TEMPLATE, action: 'template.update', userId: null, at: 5000 },
        ]);

        const res = await buildApp().request(`/api/audit/entity/${TEMPLATE}`, {}, ENV, CTX);
        const entries = ((await res.json()) as { data: { entries: Entry[] } }).data.entries;
        expect(entries.map(e => e.id)).toEqual(['mine']);
    });

    it('respects the limit query', async () => {
        await seedAudit([
            { id: 'a1', tenantId: TENANT, entityId: TEMPLATE, action: 'template.update', userId: USER, at: 1000 },
            { id: 'a2', tenantId: TENANT, entityId: TEMPLATE, action: 'template.update', userId: USER, at: 2000 },
            { id: 'a3', tenantId: TENANT, entityId: TEMPLATE, action: 'template.update', userId: USER, at: 3000 },
        ]);
        const res = await buildApp().request(`/api/audit/entity/${TEMPLATE}?limit=2`, {}, ENV, CTX);
        const entries = ((await res.json()) as { data: { entries: Entry[] } }).data.entries;
        expect(entries.map(e => e.id)).toEqual(['a3', 'a2']);
    });
});
