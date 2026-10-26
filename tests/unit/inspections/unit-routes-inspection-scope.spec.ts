/**
 * The unit write routes under /api/inspections/:id/units/... resolve the unit by BOTH the company and the
 * inspection in the path. A restricted inspector who is assigned to inspection A and knows a unit id of
 * inspection B (same company) must not be able to change, delete or move it, and a parent on create or move
 * must belong to the same inspection. The scoping is by inspection, not by role: owners and managers cannot
 * cross inspections by id either. A unit of another company answers like a missing one.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { createTestDb, setupSchema } from '../db';
import { asD1DrizzleReturn, asScopedDbSource } from '../helpers/test-db';
import { ScopedDB } from '../../../server/lib/db/scoped';
import { AppError } from '../../../server/lib/errors';
import { registerInspectionScopeGuards } from '../../../server/lib/middleware/inspection-scope';
import hierarchyApp from '../../../server/api/inspections/hierarchy';
import { UnitService } from '../../../server/services/unit.service';
import * as schema from '../../../server/lib/db/schema';
import { seedVisibilityFixture, TENANT, OTHER_TENANT, USERS, INSP } from '../helpers/visibility-fixture';
import type { HonoConfig } from '../../../server/types/hono';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

type Persona = { userId: string; role: 'owner' | 'manager' | 'inspector' };
const A: Persona = { userId: USERS.inspA, role: 'inspector' };
const MANAGER: Persona = { userId: USERS.manager, role: 'manager' };
const OWNER: Persona = { userId: USERS.owner, role: 'owner' };

const U = {
    mine: 'unit-mine', mineChild: 'unit-mine-child', mineParent: 'unit-mine-parent',
    theirs: 'unit-theirs', theirsChild: 'unit-theirs-child', foreign: 'unit-foreign', foreignSameInspection: 'unit-foreign-same-insp',
} as const;

const NOT_FOUND = { success: false, error: { code: 'not_found', message: 'Unit not found' } };

describe('unit routes are scoped to the inspection in the path', () => {
    let db: ReturnType<typeof createTestDb>['db'];

    beforeEach(async () => {
        const f = createTestDb(); db = f.db; await setupSchema(f.sqlite); await seedVisibilityFixture(db);
        vi.mocked(drizzle).mockReturnValue(asD1DrizzleReturn(db));
        const row = (id: string, tenantId: string, inspectionId: string, parentUnitId: string | null, name: string) =>
            ({ id, tenantId, inspectionId, parentUnitId, kind: 'unit' as const, type: 'unit' as const, name, sortOrder: 5, createdAt: new Date() });
        await db.insert(schema.inspectionUnits).values([
            row(U.mine, TENANT, INSP.own, null, 'Mine'),
            row(U.mineParent, TENANT, INSP.own, null, 'Mine parent'),
            row(U.mineChild, TENANT, INSP.own, U.mineParent, 'Mine child'),
            row(U.theirs, TENANT, INSP.other, null, 'Theirs'),
            row(U.theirsChild, TENANT, INSP.other, U.theirs, 'Theirs child'),
            row(U.foreign, OTHER_TENANT, INSP.foreign, null, 'Foreign'),
            // Another company's row that even carries this inspection's id: only the company filter excludes it.
            row(U.foreignSameInspection, OTHER_TENANT, INSP.own, null, 'Foreign same inspection'),
        ]);
    });

    const snapshot = () => db.select().from(schema.inspectionUnits).orderBy(schema.inspectionUnits.id).all();

    async function call(persona: Persona, method: string, path: string, body?: unknown) {
        const app = new OpenAPIHono<HonoConfig>();
        app.onError((err, c) => err instanceof AppError
            ? c.json({ success: false, error: { code: err.code, message: err.message } }, err.status)
            : c.json({ success: false, error: { message: String(err) } }, 500));
        app.use('*', async (c, next) => {
            c.set('userRole', persona.role);
            c.set('user', { sub: persona.userId, role: persona.role, tenantId: TENANT } as never);
            c.set('tenantId', TENANT);
            c.set('sdb', new ScopedDB(asScopedDbSource(db), TENANT));
            c.set('services', { unit: new UnitService({} as D1Database) } as never);
            await next();
        });
        registerInspectionScopeGuards(app);
        app.route('/api/inspections', hierarchyApp);
        const init: RequestInit = { method };
        if (body !== undefined) { init.body = JSON.stringify(body); init.headers = { 'content-type': 'application/json' }; }
        const res = await app.request(`/api/inspections/${path}`, init, { DB: {} } as never);
        return { status: res.status, body: await res.json().catch(() => null) as unknown };
    }

    const patch = (who: Persona, insp: string, unit: string) => call(who, 'PATCH', `${insp}/units/${unit}`, { name: 'Renamed', sortOrder: 99 });
    const del = (who: Persona, insp: string, unit: string) => call(who, 'DELETE', `${insp}/units/${unit}`);
    const move = (who: Persona, insp: string, unit: string, parent: string | null) =>
        call(who, 'POST', `${insp}/units/${unit}/move`, { newParentUnitId: parent, newSortOrder: 77 });
    const duplicate = (who: Persona, insp: string, unit: string) => call(who, 'POST', `${insp}/units/${unit}/duplicate`);
    const create = (who: Persona, insp: string, parent: string | null) =>
        call(who, 'POST', `${insp}/units`, { parentUnitId: parent, kind: 'floor', name: 'Hijack' });
    const bulk = (who: Persona, insp: string, parent: string | null) =>
        call(who, 'POST', `${insp}/units/bulk`, { mode: 'csv', csv: '101\n102', parentUnitId: parent });

    describe('a restricted inspector assigned to A cannot touch a unit of B', () => {
        it('PATCH answers 404 and leaves the row unchanged', async () => {
            const before = await snapshot();
            const r = await patch(A, INSP.own, U.theirs);
            expect(r.status).toBe(404);
            expect(r.body).toEqual(NOT_FOUND);
            expect(await snapshot()).toEqual(before);
        });
        it('DELETE answers 404 and removes neither the unit nor its children', async () => {
            const before = await snapshot();
            const r = await del(A, INSP.own, U.theirs);
            expect(r.status).toBe(404);
            expect(r.body).toEqual(NOT_FOUND);
            expect(await snapshot()).toEqual(before);
        });
        it('MOVE answers 404 and leaves the row unchanged', async () => {
            const before = await snapshot();
            const r = await move(A, INSP.own, U.theirs, U.mineParent);
            expect(r.status).toBe(404);
            expect(r.body).toEqual(NOT_FOUND);
            expect(await snapshot()).toEqual(before);
        });
        it('control: through B\'s own path the visibility guard refuses (B is hidden from A)', async () => {
            const before = await snapshot();
            expect((await patch(A, INSP.other, U.theirs)).status).toBe(404);
            expect(await snapshot()).toEqual(before);
        });
    });

    describe('a parent from another inspection is refused', () => {
        it('create with a foreign parentUnitId changes nothing', async () => {
            const before = await snapshot();
            expect([400, 404]).toContain((await create(A, INSP.own, U.theirs)).status);
            expect(await snapshot()).toEqual(before);
        });
        it('bulk create with a foreign parentUnitId changes nothing', async () => {
            const before = await snapshot();
            expect([400, 404]).toContain((await bulk(A, INSP.own, U.theirs)).status);
            expect(await snapshot()).toEqual(before);
        });
        it('move under a foreign parent changes nothing', async () => {
            const before = await snapshot();
            expect([400, 404]).toContain((await move(A, INSP.own, U.mine, U.theirs)).status);
            expect(await snapshot()).toEqual(before);
        });
        it('a parent in another company is refused too', async () => {
            const before = await snapshot();
            expect([400, 404]).toContain((await create(A, INSP.own, U.foreign)).status);
            expect(await snapshot()).toEqual(before);
        });
    });

    describe('positive controls on the same harness', () => {
        it('PATCH, MOVE and DELETE succeed on the inspector\'s own units', async () => {
            expect((await patch(A, INSP.own, U.mine)).status).toBe(200);
            let row = (await db.select().from(schema.inspectionUnits).where(eq(schema.inspectionUnits.id, U.mine)).get())!;
            expect(row.name).toBe('Renamed');
            expect(row.sortOrder).toBe(99);

            expect((await move(A, INSP.own, U.mine, U.mineParent)).status).toBe(200);
            row = (await db.select().from(schema.inspectionUnits).where(eq(schema.inspectionUnits.id, U.mine)).get())!;
            expect(row.parentUnitId).toBe(U.mineParent);
            expect(row.sortOrder).toBe(77);

            expect((await del(A, INSP.own, U.mineParent)).status).toBe(200);
            expect((await snapshot()).filter((u) => u.inspectionId === INSP.own && u.tenantId === TENANT)).toEqual([]);
        });
        it('create and bulk create under a parent of the same inspection succeed', async () => {
            expect((await create(A, INSP.own, U.mineParent)).status).toBe(200);
            expect((await bulk(A, INSP.own, U.mineParent)).status).toBe(200);
        });
        it('moving to the top level (null parent) still works', async () => {
            expect((await move(A, INSP.own, U.mineChild, null)).status).toBe(200);
        });
        it('deleting a unit cascades only within its own inspection', async () => {
            expect((await del(A, INSP.own, U.mineParent)).status).toBe(200);
            const ids = (await snapshot()).map((u) => u.id);
            expect(ids).toEqual(expect.arrayContaining([U.theirs, U.theirsChild, U.foreign]));
            expect(ids).not.toContain(U.mineChild);
        });
    });

    describe('duplicate is scoped to the inspection in the path', () => {
        it('refuses a unit of another inspection or company exactly like a missing one, and copies nothing', async () => {
            const before = await snapshot();
            for (const who of [A, MANAGER, OWNER]) {
                const missing = await duplicate(who, INSP.own, 'no-such-unit');
                expect(missing.status).toBe(400);
                for (const id of [U.theirs, U.foreign, U.foreignSameInspection]) {
                    expect(await duplicate(who, INSP.own, id)).toEqual(missing);
                }
            }
            expect(await snapshot()).toEqual(before);
        });
        it("control: the unit's own inspection duplicates it", async () => {
            expect((await duplicate(A, INSP.own, U.mine)).status).toBe(200);
            expect((await snapshot()).filter((u) => u.inspectionId === INSP.own && u.tenantId === TENANT)).toHaveLength(4);
        });
    });

    describe('the scoping is by inspection, not by role', () => {
        for (const [label, who] of [['manager', MANAGER], ['owner', OWNER]] as const) {
            it(`${label} cannot PATCH, DELETE or MOVE a unit of another inspection through this one`, async () => {
                const before = await snapshot();
                for (const r of [
                    await patch(who, INSP.own, U.theirs),
                    await del(who, INSP.own, U.theirs),
                    await move(who, INSP.own, U.theirs, null),
                ]) {
                    expect(r.status).toBe(404);
                    expect(r.body).toEqual(NOT_FOUND);
                }
                expect(await snapshot()).toEqual(before);
            });
            it(`${label} cannot create or move under a parent of another inspection`, async () => {
                const before = await snapshot();
                expect([400, 404]).toContain((await create(who, INSP.own, U.theirs)).status);
                expect([400, 404]).toContain((await move(who, INSP.own, U.mine, U.theirs)).status);
                expect(await snapshot()).toEqual(before);
            });
            it(`control: ${label} can change a unit through the inspection it belongs to`, async () => {
                expect((await patch(who, INSP.other, U.theirs)).status).toBe(200);
            });
        }
    });

    describe('another company\'s unit id', () => {
        it('answers the same 404 as a missing unit, on every write, and changes nothing', async () => {
            const before = await snapshot();
            for (const who of [A, OWNER]) {
                for (const id of [U.foreignSameInspection]) {
                    expect((await patch(who, INSP.own, id)).status).toBe(404);
                    expect((await del(who, INSP.own, id)).status).toBe(404);
                    expect((await move(who, INSP.own, id, null)).status).toBe(404);
                    expect([400, 404]).toContain((await create(who, INSP.own, id)).status);
                }
                const foreign = await patch(who, INSP.own, U.foreign);
                const missing = await patch(who, INSP.own, 'no-such-unit');
                expect(foreign.status).toBe(404);
                expect(foreign).toEqual(missing);
                // Same status AND same body as a missing unit, so the id's existence is not confirmed.
                const delForeign = await del(who, INSP.own, U.foreign);
                expect(delForeign.status).toBe(404);
                expect(delForeign).toEqual(await del(who, INSP.own, 'no-such-unit'));
                const moveForeign = await move(who, INSP.own, U.foreign, null);
                expect(moveForeign.status).toBe(404);
                expect(moveForeign).toEqual(await move(who, INSP.own, 'no-such-unit', null));
            }
            expect(await snapshot()).toEqual(before);
        });
    });
});
