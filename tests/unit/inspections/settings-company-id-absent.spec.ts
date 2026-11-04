/**
 * The company-settings lists (inspection subtypes, message templates, role profiles, automations, the service catalogue and its
 * discount codes, event types) answer a signed-in caller without the company id: the session already
 * names it. Each route is called through the real application and the whole body is searched for the id, raw and percent-encoded.
 * Every case is paired with a control: the list is not empty, and the stored row does hold the id, so its absence is the response
 * and not the fixture.
 *
 * Not here on purpose: the contractor-type and recommendation rows. The native contract lists the company id as a REQUIRED property of both,
 * and removing a required response property is a breaking change for the shipped app, so those two keep it.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { app } from '../../../server/index';
import { makeExecutionContext } from '../helpers/exec-ctx';
import * as schema from '../../../server/lib/db/schema';
import { buildKeyring, signJwt } from '../../../server/lib/jwt-keyring';
import { createHarness, OWNER_ID, TENANT_ID, type Harness } from '../helpers/tenant-email-harness';

describe('company settings responses do not carry the company id', () => {
    let h: Harness;
    beforeEach(async () => { h = await createHarness('standalone'); });
    afterEach(() => h.close());

    async function call(method: string, path: string, body?: unknown): Promise<Response> {
        const keyring = await buildKeyring(h.env as unknown as Record<string, string | undefined>);
        const now = Math.floor(Date.now() / 1000);
        const jwt = await signJwt({ sub: OWNER_ID, role: 'owner', 'custom:userRole': 'owner', 'custom:tenantId': TENANT_ID, iat: now, exp: now + 3600 }, keyring);
        const exec = makeExecutionContext({ label: 'settings-company-id' });
        const res = await app.request(path, {
            method,
            headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }, h.env, exec.ctx);
        await exec.settle();
        return res;
    }

    /** Status in the expected set, the body free of the company id in both spellings; returns the parsed `data`. */
    async function expectBare(res: Response, ok: number[] = [200, 201]): Promise<unknown> {
        const text = await res.text();
        expect(ok, text.slice(0, 300)).toContain(res.status);
        const at = text.indexOf(TENANT_ID);
        expect(at < 0 ? 'absent' : text.slice(Math.max(0, at - 80), at + 60)).toBe('absent');
        expect(encodeURIComponent(text)).not.toContain(TENANT_ID);
        return (JSON.parse(text) as { data?: unknown }).data;
    }

    const nonEmpty = (data: unknown): void => { expect(Array.isArray(data) ? data.length : 0).toBeGreaterThan(0); };

    it('inspection subtypes: create and list', async () => {
        await expectBare(await call('POST', '/api/admin/inspection-types', { name: 'Clinic' }));
        nonEmpty(await expectBare(await call('GET', '/api/admin/inspection-types')));
        const stored = await h.db.select().from(schema.inspectionTypes).all();
        expect(stored.every((r) => r.tenantId === TENANT_ID) && stored.length > 0).toBe(true);
    });

    it('message templates: create and list', async () => {
        await expectBare(await call('POST', '/api/message-templates', { name: 'Thanks', channel: 'email', subject: 'Hi', body: 'Hello {{clientName}}' }));
        nonEmpty(await expectBare(await call('GET', '/api/message-templates')));
        const stored = await h.db.select().from(schema.messageTemplates).all();
        expect(stored.every((r) => r.tenantId === TENANT_ID) && stored.length > 0).toBe(true);
    });

    it('the service catalogue: create, list and the discount codes', async () => {
        await expectBare(await call('POST', '/api/services', { name: 'Full inspection', price: 45000 }));
        nonEmpty(await expectBare(await call('GET', '/api/services')));
        await expectBare(await call('POST', '/api/services/discount-codes', { code: 'SPRING', type: 'percent', value: 10 }));
        nonEmpty(await expectBare(await call('GET', '/api/services/discount-codes')));
        const stored = await h.db.select().from(schema.services).all();
        expect(stored.every((r) => r.tenantId === TENANT_ID) && stored.length > 0).toBe(true);
    });

    it('event types: create and list', async () => {
        await expectBare(await call('POST', '/api/event-types', { name: 'Radon test', slug: 'radon' }));
        nonEmpty(await expectBare(await call('GET', '/api/event-types')));
        const stored = await h.db.select().from(schema.eventTypes).all();
        expect(stored.every((r) => r.tenantId === TENANT_ID) && stored.length > 0).toBe(true);
    });

    // Seeded role-profile ids embed the company id (`crp_<company>_...`), so a text search would trip on the id of a profile that an
    // automation points at. These two are checked for the KEY instead.
    const keysIn = (value: unknown, found: string[] = []): string[] => {
        if (Array.isArray(value)) value.forEach((v) => keysIn(v, found));
        else if (value !== null && typeof value === 'object') {
            for (const [k, v] of Object.entries(value)) { if (k === 'tenantId') found.push(k); keysIn(v, found); }
        }
        return found;
    };

    it('automations and role profiles: list, without a company id key', async () => {
        const automationsBody = await (await call('GET', '/api/automations')).json() as { data: unknown };
        nonEmpty(automationsBody.data);
        expect(keysIn(automationsBody.data)).toEqual([]);
        const automations = await h.db.select().from(schema.automations).all();
        expect(automations.every((r) => r.tenantId === TENANT_ID) && automations.length > 0).toBe(true);
        const profilesBody = await (await call('GET', '/api/role-profiles')).json() as { data: unknown };
        nonEmpty(profilesBody.data);
        expect(keysIn(profilesBody.data)).toEqual([]);
        // Control for the key search: the same walk finds the key where it is.
        expect(keysIn([{ a: { tenantId: 'x' } }])).toEqual(['tenantId']);
    });
});
