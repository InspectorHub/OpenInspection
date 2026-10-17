/**
 * The team routes (and the inspection list) mounted for one acting person, the way the production chain
 * reads them: the acting person is a REAL row, `capabilitiesFor` asks a tenant-scoped database handle for
 * their overrides on every request, and only the verified-token claims are set by hand.
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import { vi } from 'vitest';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { AppError } from '../../../server/lib/errors';
import { TeamService } from '../../../server/services/team.service';
import { InspectionService } from '../../../server/services/inspection.service';
import teamRoutes from '../../../server/api/team';
import bulkRoutes from '../../../server/api/inspections/bulk';
import { ScopedDB } from '../../../server/lib/db/scoped';
import { asScopedDbSource } from './test-db';
import type * as schema from '../../../server/lib/db/schema';
import type { HonoConfig } from '../../../server/types/hono';

export const TEAM_ENV = { JWT_SECRET: 'x', APP_BASE_URL: 'https://oi.test' };

export function buildTeamApp(
    db: BetterSQLite3Database<typeof schema>,
    tenantId: string,
    userId: string,
    role: 'owner' | 'manager' | 'inspector',
): OpenAPIHono<HonoConfig> {
    const app = new OpenAPIHono<HonoConfig>();
    app.onError((err, c) => (err instanceof AppError
        ? c.json({ success: false, error: { code: err.code, message: err.message } }, err.status)
        : c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500)));
    app.use('*', async (c, next) => {
        c.set('userRole', role);
        c.set('tenantId', tenantId);
        c.set('user', { sub: userId, role, tenantId } as HonoConfig['Variables']['user']);
        c.set('profile', { hasSeatQuota: false } as HonoConfig['Variables']['profile']);
        const sdb = new ScopedDB(asScopedDbSource(db), tenantId);
        c.set('sdb', sdb as unknown as HonoConfig['Variables']['sdb']);
        c.set('services', {
            team: new TeamService({} as D1Database),
            inspection: new InspectionService({} as D1Database, undefined, sdb),
            email: { sendInvitation: vi.fn().mockResolvedValue(undefined) },
        } as unknown as HonoConfig['Variables']['services']);
        await next();
    });
    app.route('/api/team', teamRoutes);
    app.route('/api/inspections', bulkRoutes);
    return app;
}
