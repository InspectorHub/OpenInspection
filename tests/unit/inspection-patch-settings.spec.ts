import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as schema from '../../server/lib/db/schema';
import { createTestDb, setupSchema } from './db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { OpenAPIHono } from '@hono/zod-openapi';
import { inspectionsRoutes } from '../../server/api/inspections';
import type { HonoConfig } from '../../server/types/hono';

/**
 * B-22 follow-up — the settings sheet's "Save changes" (save-settings intent)
 * PATCHes /api/inspections/:id through the BFF relay. Two defects made every
 * such save return `{ ok: false }` ("Error — try again") with template_id
 * staying null:
 *
 *   1. `templateId` was NOT a field on UpdateInspectionSchema, so zod stripped
 *      it on the way in — the template could never be (re)assigned.
 *   2. When the validated body reduced to `{}` (e.g. a templateId-only payload
 *      after the strip, or a save that changed nothing), the handler ran
 *      `db.update(...).set({})`, which drizzle rejects with "No values to set"
 *      → HTTP 500 → `res.ok === false`.
 *
 * These tests exercise the REAL mounted route (RBAC + zod + handler) against an
 * in-memory SQLite DB, mirroring auto-sign-publish.spec.ts.
 */

const TENANT = '00000000-0000-0000-0000-000000000001';
const USER_ID = '00000000-0000-0000-0000-000000000300';
const INSP_ID = '550e8400-e29b-41d4-a716-446655440000';
const TPL_ID = 'tpl-e2e-trackA'; // template ids are free-text, not UUIDs

let db: BetterSQLite3Database<typeof schema>;

function buildApp(role: string) {
    const app = new OpenAPIHono<HonoConfig>();
    app.use('*', async (c, next) => {
        c.set('userRole', role as never);
        c.set('tenantId', TENANT);
        c.set('user', { sub: USER_ID } as never);
        c.set(
            'services',
            { inspection: { getInspection: vi.fn().mockResolvedValue({ inspection: { status: 'draft' } }) } } as never,
        );
        await next();
    });
    app.route('/api/inspections', inspectionsRoutes);
    return app;
}

async function patch(role: string, body: unknown): Promise<number> {
    const res = await buildApp(role).request(
        `/api/inspections/${INSP_ID}`,
        { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
        { DB: {} },
    );
    return res.status;
}

describe('PATCH /api/inspections/:id — settings save (B-22 follow-up)', () => {
    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        await setupSchema(fixture.sqlite);
        await db.insert(schema.tenants).values({
            id: TENANT, name: 'A', slug: 's', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await db.insert(schema.templates).values({
            id: TPL_ID, tenantId: TENANT, name: 'Track A', slug: 'track-a',
            schema: '{}', createdAt: new Date(),
        } as never);
        await db.insert(schema.inspections).values({
            id: INSP_ID, tenantId: TENANT,
            propertyAddress: '1 Main St', clientName: 'Jane', clientEmail: 'jane@x',
            date: '2026-06-01', status: 'draft', paymentStatus: 'unpaid', price: 50000,
            agreementRequired: false, paymentRequired: false, createdAt: new Date(),
        });
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    });

    it('assigns the template — a templateId-only payload returns 200 and persists', async () => {
        expect(await patch('admin', { templateId: TPL_ID })).toBe(200);
        const row = await db.select().from(schema.inspections).where(eq(schema.inspections.id, INSP_ID)).get();
        expect((row as { templateId?: string | null }).templateId).toBe(TPL_ID);
    });

    it('a payload that reduces to no recognised fields is a 200 no-op (not a 500)', async () => {
        // Mirrors the sanitizer dropping every empty-string "unchanged" field:
        // the validated body is `{}`, which must not crash `.set({})`.
        expect(await patch('admin', { unknownField: 'x' })).toBe(200);
    });

    it('still updates a normal scalar field', async () => {
        expect(await patch('admin', { clientName: 'Updated Name' })).toBe(200);
        const row = await db.select().from(schema.inspections).where(eq(schema.inspections.id, INSP_ID)).get();
        expect((row as { clientName?: string }).clientName).toBe('Updated Name');
    });

    it('accepts the inspector/lead and owner roles (RBAC)', async () => {
        expect(await patch('inspector', { clientName: 'A' })).toBe(200);
        expect(await patch('owner', { clientName: 'B' })).toBe(200);
    });
});
