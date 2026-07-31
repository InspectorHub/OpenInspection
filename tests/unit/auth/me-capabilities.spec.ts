/**
 * Task 3 (two-layer role model) — GET /api/auth/me returns the RESOLVED
 * capability set: role defaults with the user's own overrides applied.
 *
 * With nothing on the wire a page has to guess, and the inspector portal
 * guessed wrong: it re-implemented ROLE_DEFAULTS from the role string,
 * ignoring permission_overrides, so an inspector whose publish was withdrawn
 * saw the button and got a 403 on click (IA-95's frontend half).
 *
 * The profile router is mounted over the real test DB (mocked drizzle →
 * better-sqlite3) so the handler's users-row read AND the override resolver's
 * permission_overrides read both hit seeded data — no hand-stubbed resolver
 * that could drift from production wiring.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { OpenAPIHono } from '@hono/zod-openapi';
import profileRoutes from '../../../server/api/auth/profile';
import { getCapabilities, type PermissionOverrides } from '../../../server/lib/auth/capabilities';
import type { Role } from '../../../server/lib/auth/roles';
import type { HonoConfig } from '../../../server/types/hono';
import { createScopedDb } from '../../../server/lib/db/scoped';

const TENANT = 't-me-1';
const USER = 'u-me-1';

let db: BetterSQLite3Database<typeof schema>;

const ENV = { DB: {} } as never;
const CTX = { waitUntil: () => {}, passThroughOnException: () => {} } as never;

async function callMe({ role, overrides }: { role: Role; overrides: PermissionOverrides | null }) {
    const fixture = createTestDb();
    db = fixture.db;
    await setupSchema(fixture.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);

    await db.insert(schema.tenants).values({ id: TENANT, name: 'T', slug: 't-me', createdAt: new Date() });
    await db.insert(schema.users).values({
        id: USER, tenantId: TENANT, email: 'me@example.com', passwordHash: 'x',
        name: 'Me', role, createdAt: new Date(),
        permissionOverrides: overrides ? JSON.stringify(overrides) : null,
    } as never);

    const app = new OpenAPIHono<HonoConfig>();
    app.use('*', async (c, next) => {
        c.set('userRole', role as never);
        c.set('user', { sub: USER, role, tenantId: TENANT } as never);
        c.set('tenantId', TENANT);
        // The override resolver reads permission_overrides through the scoped
        // DB, exactly as production's jwt-auth middleware wires it.
        c.set('sdb', createScopedDb(db as never, TENANT) as never);
        await next();
    });
    app.route('/api/auth', profileRoutes);
    const res = await app.request('/api/auth/me', {}, ENV, CTX);
    expect(res.status).toBe(200);
    return (await res.json()) as { data: { capabilities: Record<string, boolean> } };
}

describe('GET /api/auth/me capabilities', () => {
    beforeEach(() => vi.clearAllMocks());

    it('returns every toggleable capability for an inspector with no overrides', async () => {
        const body = await callMe({ role: 'inspector', overrides: null });
        expect(body.data.capabilities).toEqual(getCapabilities('inspector', null));
    });

    it('reflects a withdrawn publish override', async () => {
        const body = await callMe({ role: 'inspector', overrides: { publish: false } });
        expect(body.data.capabilities.publish).toBe(false);
    });

    it('never lets an override elevate an agent', async () => {
        const body = await callMe({ role: 'agent', overrides: { publish: true } });
        expect(body.data.capabilities.publish).toBe(false);
    });
});
