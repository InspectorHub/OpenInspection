/**
 * A request that names a template or agreement that is not the caller's own company's answers 400, never a
 * database constraint failure. A row of another company reads exactly like one that does not exist.
 *
 * Covers POST /api/inspections, PATCH /api/inspections/:id, POST/PUT /api/services. Each refusal is paired
 * with a control that names a real template/agreement and goes through.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { app } from '../../../server/index';
import { makeExecutionContext } from '../helpers/exec-ctx';
import * as schema from '../../../server/lib/db/schema';
import { buildKeyring, signJwt } from '../../../server/lib/jwt-keyring';
import { createHarness, OWNER_ID, TENANT_ID, type Harness } from '../helpers/tenant-email-harness';

const OTHER_TENANT = '11111111-0000-4000-8000-0000000000ff';
const OWN_TEMPLATE = 'tpl-own';
const FOREIGN_TEMPLATE = 'tpl-foreign';
const OWN_AGREEMENT = 'agr-own';
const FOREIGN_AGREEMENT = 'agr-foreign';

describe('unknown reference ids are refused with 400', () => {
    let h: Harness | undefined;
    afterEach(() => { h?.close(); h = undefined; });

    async function seed(): Promise<Harness> {
        const created = await createHarness('saas');
        const now = new Date();
        await created.db.insert(schema.tenants).values({
            id: OTHER_TENANT, slug: 'other-co', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: now,
        });
        await created.db.insert(schema.templates).values([
            { id: OWN_TEMPLATE, tenantId: TENANT_ID, name: 'Own', schema: { sections: [] }, version: 1, createdAt: now },
            { id: FOREIGN_TEMPLATE, tenantId: OTHER_TENANT, name: 'Foreign', schema: { sections: [] }, version: 1, createdAt: now },
        ] as (typeof schema.templates.$inferInsert)[]);
        await created.db.insert(schema.agreements).values([
            { id: OWN_AGREEMENT, tenantId: TENANT_ID, name: 'Own', content: 'x', version: 1, createdAt: now },
            { id: FOREIGN_AGREEMENT, tenantId: OTHER_TENANT, name: 'Foreign', content: 'x', version: 1, createdAt: now },
        ] as (typeof schema.agreements.$inferInsert)[]);
        return created;
    }

    async function call(method: string, path: string, body: unknown): Promise<{ status: number; text: string }> {
        const keyring = await buildKeyring(h!.env as unknown as Record<string, string | undefined>);
        const now = Math.floor(Date.now() / 1000);
        const jwt = await signJwt({
            sub: OWNER_ID, role: 'owner', 'custom:userRole': 'owner', 'custom:tenantId': TENANT_ID, iat: now, exp: now + 3600,
        }, keyring);
        const exec = makeExecutionContext({ label: 'unknown-reference-ids' });
        const res = await app.request(path, {
            method,
            headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
            body: JSON.stringify(body),
        }, h!.env, exec.ctx);
        await exec.settle();
        return { status: res.status, text: await res.text() };
    }

    const createBody = (templateId: string) => ({ propertyAddress: '1 Reference Way', templateId });

    it('POST /api/inspections: a nonexistent and another company\'s template answer the same 400', async () => {
        h = await seed();
        const missing = await call('POST', '/api/inspections', createBody('tpl-nope'));
        const foreign = await call('POST', '/api/inspections', createBody(FOREIGN_TEMPLATE));
        expect(missing.status).toBe(400);
        expect(foreign.status).toBe(400);
        expect(foreign.text).toBe(missing.text);
        expect(missing.text).not.toContain('tpl-nope');
        const rows = await h.db.select().from(schema.inspections).all();
        expect(rows).toHaveLength(0);
    });

    it('POST /api/inspections: control, an own template creates the inspection', async () => {
        h = await seed();
        const ok = await call('POST', '/api/inspections', createBody(OWN_TEMPLATE));
        expect(ok.status).toBe(201);
    });

    it('PATCH /api/inspections/:id: unknown and foreign template are refused alike; an own one is accepted', async () => {
        h = await seed();
        const made = JSON.parse((await call('POST', '/api/inspections', createBody(OWN_TEMPLATE))).text) as { data: { inspection: { id: string } } };
        const path = `/api/inspections/${made.data.inspection.id}`;
        const missing = await call('PATCH', path, { templateId: 'tpl-nope' });
        const foreign = await call('PATCH', path, { templateId: FOREIGN_TEMPLATE });
        expect(missing.status).toBe(400);
        expect(foreign.status).toBe(400);
        expect(foreign.text).toBe(missing.text);
        expect((await call('PATCH', path, { templateId: OWN_TEMPLATE })).status).toBe(200);
    });

    it('POST/PUT /api/services: unknown and foreign template or agreement are refused alike; own ones are accepted', async () => {
        h = await seed();
        for (const field of ['templateId', 'agreementId'] as const) {
            const own = field === 'templateId' ? OWN_TEMPLATE : OWN_AGREEMENT;
            const foreign = field === 'templateId' ? FOREIGN_TEMPLATE : FOREIGN_AGREEMENT;
            const base = { name: `Svc ${field}`, price: 10000 };
            const missing = await call('POST', '/api/services', { ...base, [field]: 'nope' });
            const other = await call('POST', '/api/services', { ...base, [field]: foreign });
            expect(missing.status, field).toBe(400);
            expect(other.status, field).toBe(400);
            expect(other.text).toBe(missing.text);
            const created = await call('POST', '/api/services', { ...base, [field]: own });
            expect(created.status, field).toBe(201);
            const id = (JSON.parse(created.text) as { data: { id: string } }).data.id;
            const putMissing = await call('PUT', `/api/services/${id}`, { [field]: 'nope' });
            const putOther = await call('PUT', `/api/services/${id}`, { [field]: foreign });
            expect(putMissing.status, field).toBe(400);
            expect(putOther.text).toBe(putMissing.text);
            expect((await call('PUT', `/api/services/${id}`, { [field]: own })).status, field).toBe(200);
        }
    });
});
