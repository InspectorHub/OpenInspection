/**
 * The dashboard checklist's inputs, run two ways.
 *
 *   1. Against the REAL routes (in-memory SQLite, real middleware, real zod
 *      validators). Only the client object is an adapter: each `$get` sends the
 *      same query the typed client would, straight into the application. This
 *      is the test that would have caught the template count always reading 0:
 *      the loader asked for `pageSize=1`, the route answers 400 for it, and the
 *      best-effort branch turned the 400 into "no templates".
 *   2. Against a fake whose templates endpoint rejects a page size outside the
 *      shared enum with 400, exactly like the real validator, so the failure
 *      is visible without a database.
 */
import { describe, it, expect } from 'vitest';
import { app } from '../../../server/index';
import { makeExecutionContext } from '../helpers/exec-ctx';
import * as schema from '../../../server/lib/db/schema';
import { buildKeyring, signJwt } from '../../../server/lib/jwt-keyring';
import { createHarness, TENANT_ID, OWNER_ID } from '../helpers/tenant-email-harness';
import { loadChecklistInputs } from '../../../app/lib/dashboard-setup.server';
import { recordRoundTrips } from '../helpers/round-trip-recorder';

const PAGE_SIZES = [12, 25, 50, 100];

type Query = Record<string, string | undefined> | undefined;

async function setup(templateCount: number, options: { retired?: number } = {}) {
    const h = await createHarness('standalone');
    const now = new Date();
    if (templateCount > 0) {
        await h.db.insert(schema.templates).values(Array.from({ length: templateCount }, (_, i) => ({
            id: `77777777-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
            tenantId: TENANT_ID, name: `Template ${i + 1}`, version: 1, schema: '{"sections":[]}', createdAt: now,
            retiredAt: i < (options.retired ?? 0) ? now : null,
        })) as never);
    }
    const keyring = await buildKeyring(h.env as unknown as Record<string, string | undefined>);
    const iat = Math.floor(Date.now() / 1000);
    const token = await signJwt({ sub: OWNER_ID, 'custom:tenantId': TENANT_ID, 'custom:userRole': 'owner', iat, exp: iat + 3600 }, keyring);
    const get = (path: string) => async (arg?: { query?: Query }) => {
        const qs = new URLSearchParams();
        for (const [k, v] of Object.entries(arg?.query ?? {})) if (v !== undefined) qs.set(k, v);
        const exec = makeExecutionContext({ label: path });
        const res = await app.request(`${path}${qs.size ? `?${qs}` : ''}`, { headers: { authorization: `Bearer ${token}` } }, h.env, exec.ctx);
        await exec.settle();
        return res;
    };
    const api = {
        inspections: { templates: { $get: get('/api/inspections/templates'), count: { $get: get('/api/inspections/templates/count') } } },
        services: { index: { $get: get('/api/services') } },
        availability: { index: { $get: get('/api/availability') } },
        calendar: { status: { $get: get('/api/calendar/status') } },
    } as never;
    return { h, api, get, token };
}

describe('dashboard checklist inputs against the real routes', () => {
    it('counts the templates the company has', async () => {
        const { h, api } = await setup(3);
        try {
            expect((await loadChecklistInputs(api)).templateCount).toBe(3);
        } finally { h.close(); }
    });

    it('reads zero for a company with no template, without an error', async () => {
        const { h, api } = await setup(0);
        try {
            expect((await loadChecklistInputs(api)).templateCount).toBe(0);
        } finally { h.close(); }
    });

    it('the smallest page the route accepts answers 200 and carries meta.total', async () => {
        const { h, get } = await setup(2);
        try {
            const res = await get('/api/inspections/templates')({ query: { page: '1', pageSize: String(Math.min(...PAGE_SIZES)) } });
            expect(res.status).toBe(200);
            const body = await res.json() as { meta?: { total?: number } };
            expect(body.meta?.total).toBe(2);
            // Control: the value the loader used to send is refused by the real validator.
            const bad = await get('/api/inspections/templates')({ query: { page: '1', pageSize: '1' } });
            expect(bad.status).toBe(400);
        } finally { h.close(); }
    });
});

describe('dashboard checklist inputs against a validating fake', () => {
    it('reads the count route, and a list call with an unaccepted page size would be refused', async () => {
        const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
        let listCalls = 0;
        const api = {
            inspections: { templates: {
                $get: async ({ query }: { query?: Query }) => {
                    listCalls++;
                    if (query?.pageSize !== undefined && !PAGE_SIZES.includes(Number(query.pageSize))) {
                        return json(400, { success: false, error: { code: 'VALIDATION_ERROR', message: 'pageSize must be one of 12, 25, 50, 100' } });
                    }
                    return json(200, { success: true, data: [], meta: { total: 7, page: 1, pageSize: 12, totalPages: 1 } });
                },
                count: { $get: async () => json(200, { success: true, data: { total: 7 } }) },
            } },
            services: { index: { $get: async () => json(200, { data: [] }) } },
            availability: { index: { $get: async () => json(200, { data: [] }) } },
            calendar: { status: { $get: async () => json(200, { data: { connected: false } }) } },
        } as never;
        expect((await loadChecklistInputs(api)).templateCount).toBe(7);
        // The count comes from the count route; the list (and its schema reads) is not involved.
        expect(listCalls).toBe(0);
    });
});

describe('the checklist count path', () => {
    it('equals the list total, retired templates included', async () => {
        const { h, api, get } = await setup(5, { retired: 2 });
        try {
            const list = await (await get('/api/inspections/templates')({ query: { page: '1', pageSize: '12' } })).json() as { meta: { total: number } };
            expect(list.meta.total).toBe(5);
            expect((await loadChecklistInputs(api)).templateCount).toBe(list.meta.total);
        } finally { h.close(); }
    });

    it('does not read any template content (statement recording)', async () => {
        const { h, get } = await setup(3);
        try {
            const rec = recordRoundTrips(h.env.DB as D1Database, 0);
            (h.env as unknown as Record<string, unknown>).DB = rec.binding;
            const res = await get('/api/inspections/templates/count')();
            expect(res.status).toBe(200);
            expect((await res.json() as { data: { total: number } }).data.total).toBe(3);
            const reads = rec.log.sql.filter((q) => /from "templates"/i.test(q));
            // Positive control: the templates table WAS read, and only to count it.
            expect(reads).toHaveLength(1);
            expect(reads[0]).toMatch(/count\(\*\)/i);
            expect(reads.some((q) => /"schema"/.test(q))).toBe(false);
            // Control: the list route does select the schema, so the check above can see what it guards.
            rec.reset();
            await get('/api/inspections/templates')({ query: { page: '1', pageSize: '12' } });
            expect(rec.log.sql.some((q) => /from "templates"/i.test(q) && /"schema"/.test(q))).toBe(true);
        } finally { h.close(); }
    });

    it('another company has its own templates, which are not counted', async () => {
        const { h, api } = await setup(2);
        try {
            await h.db.insert(schema.tenants).values({ id: '99999999-0000-4000-8000-000000000009', slug: 'other-co', status: 'active', tier: 'free', maxUsers: 5, deploymentMode: 'shared', createdAt: new Date() } as never);
            await h.db.insert(schema.templates).values({ id: 'x-tpl', tenantId: '99999999-0000-4000-8000-000000000009', name: 'Foreign', version: 1, schema: '{"sections":[]}', createdAt: new Date() } as never);
            expect((await loadChecklistInputs(api)).templateCount).toBe(2);
        } finally { h.close(); }
    });
});
