/**
 * `POST /api/templates/{oldId}/migrate-to/{newId}` carries TWO verbs.
 *
 * It bumps the new template's version (an edit) and, when `deleteOldTemplate`
 * is set, deletes the old template. `requireCapability` expresses exactly one
 * capability, so the route gate is `templateEdit` and the delete half is
 * checked inside the handler.
 *
 * `tests/unit/platform/authorization-surface.spec.ts` already answers "does
 * this route mount the guard it declares" for every capability-guarded route.
 * It cannot see an in-handler branch, which is exactly the shape that let
 * `financial` ship correct-and-bypassed (`server/lib/auth/money-redaction.ts`).
 * So the branch is pinned here, through a real router, on HTTP STATUS CODES —
 * a service return value would not prove the request was refused.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import templateMigrationRoutes from '../../../server/api/template-migrations';
import { AppError } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';
import type { PermissionOverrides } from '../../../server/lib/auth/capabilities';
import { MockKV } from '../mocks';

const TENANT = 'tenant-mig-cap';
const USER = 'user-inspector-1';
const OLD_ID = 'tpl-old';
const NEW_ID = 'tpl-new';

const migrate = vi.fn();

/**
 * `capabilitiesFor` resolves overrides through `c.get('sdb').getById(users, id)`.
 * The permission_overrides COLUMN is what decides the answer, so the stub
 * returns a row rather than a capability set — anything else would test a
 * different resolution path from the one production takes.
 */
function buildApp(role: 'owner' | 'manager' | 'inspector', overrides: PermissionOverrides | null) {
    const app = new OpenAPIHono<HonoConfig>();
    app.onError((err, c) =>
        err instanceof AppError ? c.json({ error: err.message }, err.status) : c.json({ error: String(err) }, 500),
    );
    app.use('*', async (c, next) => {
        c.set('user', { sub: USER, role } as HonoConfig['Variables']['user']);
        c.set('userRole', role);
        c.set('tenantId', TENANT);
        c.set('sdb', {
            getById: async () => ({ id: USER, tenantId: TENANT, permissionOverrides: overrides }),
        } as unknown as HonoConfig['Variables']['sdb']);
        c.set('services', { templateMigration: { migrate } } as unknown as HonoConfig['Variables']['services']);
        await next();
    });
    app.route('/api/templates', templateMigrationRoutes);

    const env = {
        DB: {} as D1Database,
        TENANT_CACHE: new MockKV() as unknown as KVNamespace,
    };
    return { app, env };
}

async function callMigrate(
    role: 'owner' | 'manager' | 'inspector',
    overrides: PermissionOverrides | null,
    deleteOldTemplate: boolean,
) {
    const { app, env } = buildApp(role, overrides);
    const res = await app.request(
        `/api/templates/${OLD_ID}/migrate-to/${NEW_ID}`,
        {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ strategy: 'preserve_unknown', deleteOldTemplate }),
        },
        env,
    );
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe('the migrate route checks templateDelete on the deleting branch only', () => {
    beforeEach(() => {
        migrate.mockReset();
        migrate.mockResolvedValue({
            dryRun: false, migrated: 0, strategy: 'preserve_unknown',
            preview: { affected: 0, breakingItems: [], compatibleItems: [], oldItemIds: [], newItemIds: [] },
            oldTemplateDeleted: false,
        });
    });

    it('refuses deleteOldTemplate:true for an actor holding templateEdit but not templateDelete', async () => {
        // manager holds both by default, so the withheld half has to be an
        // explicit override — otherwise the case would only be testing the
        // inspector role template and would go green if the branch vanished.
        const res = await callMigrate('manager', { templateDelete: false }, true);
        expect(res.status).toBe(403);
        expect(String(res.body.error)).toContain('templateDelete');
        expect(migrate).not.toHaveBeenCalled();
    });

    it('allows the same actor to migrate WITHOUT deleting', async () => {
        const res = await callMigrate('manager', { templateDelete: false }, false);
        expect(res.status).toBe(200);
        expect(migrate).toHaveBeenCalledTimes(1);
    });

    it('allows deleteOldTemplate:true when the actor holds templateDelete', async () => {
        const res = await callMigrate('manager', null, true);
        expect(res.status).toBe(200);
        expect(migrate).toHaveBeenCalledTimes(1);
    });

    it('refuses at the ROUTE gate when templateEdit is withheld, delete flag or not', async () => {
        // The route gate fires before the handler, so the request never reaches
        // the deleteOldTemplate branch. Asserting both flags proves the gate is
        // the thing refusing, not the in-handler check.
        for (const flag of [true, false]) {
            const res = await callMigrate('manager', { templateEdit: false }, flag);
            expect(res.status).toBe(403);
            expect(String(res.body.error)).toContain('templateEdit');
        }
        expect(migrate).not.toHaveBeenCalled();
    });

    it('an owner cannot be reduced below templateDelete by an override (pinned)', async () => {
        const res = await callMigrate('owner', { templateDelete: false }, true);
        expect(res.status).toBe(200);
    });
});
