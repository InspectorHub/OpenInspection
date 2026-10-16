/**
 * Staff users exist in the company but are never offered as, and can
 * never be made, the inspector on a job. Each exclusion is paired with a control
 * showing the same call still admits an inspector, manager and owner.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { asD1Db } from '../helpers/test-db';
import { AppError } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';
import { isFieldRole } from '../../../server/lib/auth/roles';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

// eslint-disable-next-line import/order
import { setServiceInspectors } from '../../../server/services/service/qualification';
// eslint-disable-next-line import/order
import { BookingService } from '../../../server/services/booking.service';
// eslint-disable-next-line import/order
import { findPatchRefusal } from '../../../server/api/inspections/patch-guards';
// eslint-disable-next-line import/order
import { createPayRule } from '../../../server/services/service/pay-rules';
// eslint-disable-next-line import/order
import { resolveCreateInput } from '../../../server/api/inspections/create-support';
// eslint-disable-next-line import/order
import bulkRoutes from '../../../server/api/inspections/bulk';

const T = 'aaaaaaaa-0000-0000-0000-000000000001';
const S1 = 'ssssssss-0000-0000-0000-000000000001';
const ID = { owner: 'u-owner', manager: 'u-manager', inspector: 'u-inspector', staff: 'u-staff' } as const;

describe('field roles', () => {
  let db: BetterSQLite3Database<typeof schema>;
  let sqlite: { close(): void; exec(sql: string): void };

  beforeEach(async () => {
    const setup = createTestDb();
    db = setup.db;
    sqlite = setup.sqlite;
    await setupSchema(setup.sqlite);
    vi.mocked(mockDrizzle).mockReturnValue(db as never);
    await db.insert(schema.tenants).values({
      id: T, slug: 'acme', tier: 'free', status: 'active', maxUsers: 10, deploymentMode: 'shared', createdAt: new Date(),
    } as never);
    await db.insert(schema.users).values(
      (Object.entries(ID) as Array<[keyof typeof ID, string]>).map(([role, id]) => ({
        id, tenantId: T, email: `${id}@x.test`, passwordHash: 'h', role, createdAt: new Date(),
      })) as never,
    );
    await db.insert(schema.services).values({
      id: S1, tenantId: T, name: 'Standard', price: 40000, active: true, createdAt: new Date(), sortOrder: 0,
    } as never);
  });

  afterEach(() => { sqlite.close(); });

  it('isFieldRole admits owner, manager and inspector only', () => {
    expect(['owner', 'manager', 'inspector', 'staff', 'agent', 'nope'].filter(isFieldRole))
      .toEqual(['owner', 'manager', 'inspector']);
  });

  it('refuses staff as a service qualification, and admits the field roles (control)', async () => {
    await expect(setServiceInspectors(asD1Db(db), T, S1, [ID.staff])).rejects.toMatchObject({ status: 400 });
    await expect(setServiceInspectors(asD1Db(db), T, S1, [ID.owner, ID.manager, ID.inspector])).resolves.toBe(3);
  });

  it('leaves staff out of the bookable set with no qualification rows', async () => {
    const ids = await new BookingService({} as D1Database).getQualifiedInspectorIds(T, []);
    expect([...ids].sort()).toEqual([ID.inspector, ID.manager, ID.owner].sort());
  });

  it('keeps staff out of the public inspector list, and keeps the inspector (control)', async () => {
    const list = await new BookingService({} as D1Database).listInspectors(T);
    expect(list.map((r) => r.id)).toEqual([ID.inspector]);
  });

  it('refuses a patch that assigns staff, and accepts a field role (control)', async () => {
    const check = (inspectorId: string) =>
      findPatchRefusal(db as never, T, 'insp-1', { inspectorId }, async () => true);
    expect(await check(ID.staff)).toMatchObject({ code: 'INVALID_INSPECTOR' });
    for (const ok of [ID.owner, ID.manager, ID.inspector]) expect(await check(ok)).toBeNull();
  });

  it('refuses a pay rule naming staff, and accepts an inspector (control)', async () => {
    const rule = { userId: ID.staff, kind: 'percent', percentBps: 5000 } as never;
    await expect(createPayRule(asD1Db(db), T, S1, rule)).rejects.toMatchObject({ status: 400 });
    await expect(createPayRule(asD1Db(db), T, S1, { ...(rule as object), userId: ID.inspector } as never)).resolves.toBeTruthy();
  });

  describe('a new inspection is only assigned to its creator when the creator can inspect', () => {
    const ctxFor = (userRole: string, sub: string) => ({
      get: (k: string) => ({ tenantId: T, userRole, user: { sub } } as Record<string, unknown>)[k],
      var: { services: { contact: {} } },
    }) as never;
    const body = { propertyAddress: '1 Main St', date: '2026-06-22' } as never;

    it.each(['owner', 'manager', 'inspector'] as const)('%s becomes the inspector', async (role) => {
      expect((await resolveCreateInput(ctxFor(role, `me-${role}`), body)).inspectorId).toBe(`me-${role}`);
    });

    it.each(['staff'] as const)('%s leaves the job unassigned', async (role) => {
      expect((await resolveCreateInput(ctxFor(role, `me-${role}`), body)).inspectorId).toBeUndefined();
    });

    it('an explicit inspector is kept whoever creates the job', async () => {
      const out = await resolveCreateInput(ctxFor('staff', 'me'), { ...(body as object), inspectorId: ID.inspector } as never);
      expect(out.inspectorId).toBe(ID.inspector);
    });
  });

  describe('GET /api/inspections/inspectors', () => {
    const rows = (Object.entries(ID) as Array<[string, string]>).map(([role, id]) => ({
      id, email: `${id}@x.test`, role, createdAt: new Date(),
    }));
    const app = () => {
      const a = new OpenAPIHono<HonoConfig>();
      a.onError((err, c) => c.json({ error: String(err) }, err instanceof AppError ? err.status : 500));
      a.use('*', async (c, next) => {
        c.set('tenantId', T);
        c.set('userRole', 'owner');
        c.set('user', { sub: 'actor', role: 'owner', tenantId: T });
        c.set('services', { admin: { getMembers: async () => ({ members: rows }) } } as unknown as HonoConfig['Variables']['services']);
        await next();
      });
      a.route('/api/inspections', bulkRoutes);
      return a;
    };

    it('lists the field roles and not staff', async () => {
      const res = await app().request('/api/inspections/inspectors', {}, { DB: {} } as HonoConfig['Bindings']);
      expect(res.status).toBe(200);
      const body = await res.json() as { data: Array<{ role: string }> };
      expect(body.data.map((r) => r.role).sort()).toEqual(['inspector', 'manager', 'owner']);
    });
  });
});
