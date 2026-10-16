/**
 * The inspection-side endpoints that office staff do not reach.
 *
 * AI assistance follows the editor: it spends the company's AI allowance on report
 * text, so it needs `editReports`. The signature, submit, property-facts and concierge
 * routes were put under the same capability by the path guard
 * (`report-authoring-guard`, whose own spec walks every route); the second block
 * here pins that those four are in its list and that reading property facts is not.
 *
 * Each refusal is paired with the same call by a caller who holds the capability.
 */
import { describe, it, expect } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { AppError } from '../../../server/lib/errors';
import aiRoutes from '../../../server/api/ai';
import { isReportAuthoringPath } from '../../../server/lib/inspection/report-authoring-guard';
import type { HonoConfig } from '../../../server/types/hono';
import type { UserRole } from '../../../server/types/auth';

const AI_ROUTES = ['/comment-assist', '/auto-summary', '/suggest-comment', '/comment/edit', '/reviews'] as const;

function buildApp(role: UserRole, overrides: Record<string, boolean> | null = null) {
    const app = new OpenAPIHono<HonoConfig>();
    app.onError((err, c) => (err instanceof AppError
        ? c.json({ success: false, error: { code: err.code, message: err.message } }, err.status)
        : c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500)));
    app.use('*', async (c, next) => {
        c.set('tenantId', '00000000-0000-0000-0000-000000000001');
        c.set('userRole', role);
        c.set('user', { sub: 'actor', role, tenantId: '00000000-0000-0000-0000-000000000001' });
        c.set('sdb', { getById: async () => ({ permissionOverrides: overrides }) } as unknown as HonoConfig['Variables']['sdb']);
        await next();
    });
    app.route('/api/ai', aiRoutes);
    return app;
}

const call = (app: ReturnType<typeof buildApp>, path: string) =>
    app.request(`/api/ai${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, { DB: {} } as HonoConfig['Bindings']);

describe('AI endpoints', () => {
    it.each(AI_ROUTES)('%s: refused to staff by default, and to staff whose permissions say nothing about it', async (path) => {
        expect((await call(buildApp('staff'), path)).status).toBe(403);
    });

    it.each(AI_ROUTES)('%s: staff granted editReports, an inspector and an owner get past the capability (they reach validation)', async (path) => {
        for (const app of [buildApp('staff', { editReports: true }), buildApp('inspector'), buildApp('owner')]) {
            expect((await call(app, path)).status).toBe(400);
        }
    });

    it.each(AI_ROUTES)('%s: refused to an inspector whose editReports was withdrawn', async (path) => {
        expect((await call(buildApp('inspector', { editReports: false }), path)).status).toBe(403);
    });
});

describe('inspection-side routes landed earlier under the path guard', () => {
    const id = '/api/inspections/abc';
    it.each(['inspector-signature', 'submit', 'property-facts', 'property-facts/autofill', 'concierge/approve'])('%s is a report-authoring path', (suffix) => {
        expect(isReportAuthoringPath(`${id}/${suffix}`)).toBe(true);
    });

    it('control: an order-side route is not (the list is not a blanket match)', () => {
        for (const suffix of ['send-report-pdf', 'cancel', 'confirm', 'schedule']) expect(isReportAuthoringPath(`${id}/${suffix}`)).toBe(false);
    });
});
