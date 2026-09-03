/**
 * The portal->engine machine-to-machine seam mounts at `/api/platform`.
 *
 * It used to be `/api/integration` (singular), one letter away from
 * `/api/integrations/*` — the tenant's OWN QuickBooks/Stripe settings API,
 * which differs from it in caller, auth mechanism and visibility. Reading the
 * two apart in a middleware bypass list is a coin flip, so the seam was
 * renamed. Every negative assertion below is paired with a positive control,
 * because a file that stopped containing the string for some unrelated reason
 * reads exactly like a file that was migrated.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..');
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');

const module_ = read('server', 'portal', 'integration.module.ts');
const entry = read('workers', 'app.ts');
const jwtAuth = read('server', 'lib', 'middleware', 'jwt-auth.ts');
const tenantRouter = read('server', 'features', 'tenant-routing', 'index.ts');
const suspendGuard = read('server', 'lib', 'middleware', 'tenant-status-guard.ts');
const authApi = read('server', 'api', 'auth.ts');

describe('portal->engine M2M mounts at /api/platform', () => {
    it('mounts BOTH routers at /api/platform', () => {
        expect(module_).toContain(`app.route('/api/platform', integrationRoutes)`);
        // The second mount arrived after the rename was planned. Leaving it on
        // the old prefix would keep a live M2M surface under the old name.
        expect(module_).toContain(`app.route('/api/platform', statutoryAdminRoutes)`);
    });

    it('leaves no /api/integration/ (singular) reference anywhere in the wiring', () => {
        const wiring = { module_, entry, jwtAuth, tenantRouter, suspendGuard, authApi };
        for (const [name, src] of Object.entries(wiring)) {
            expect(src, `${name} still references the singular prefix`)
                .not.toMatch(/\/api\/integration(?!s)/);
        }
    });

    it('still forwards the prefix from the worker entry, mode-gated', () => {
        expect(entry).toContain(`app.all("/api/platform/*"`);
        expect(entry).toContain('hasPortalIntegrationApi');
    });

    it('keeps the seam exempt from the suspended-tenant guard', () => {
        // Offboarding a suspended tenant (purge, data-export) is exactly the
        // case where portal must still be able to write. Renaming the mount
        // without renaming this list would 403 every one of those calls.
        expect(suspendGuard).toContain(`'/api/platform/'`);
    });

    it('keeps the seam public to the JWT middleware and bypassed by the tenant router', () => {
        // Positive controls for the negative assertion above: the entries must
        // still be present under the new name, not merely gone under the old.
        expect(jwtAuth).toContain(`path.startsWith('/api/platform/')`);
        expect(tenantRouter).toContain(`path.startsWith('/api/platform')`);
    });

    it('keeps the tenant-scoped integrations settings API distinct', () => {
        // Positive control: the PLURAL prefix must still exist, otherwise the
        // negative assertions above are vacuously green.
        expect(read('server', 'index.ts')).toContain(`.route('/api/integrations'`);
    });
});
