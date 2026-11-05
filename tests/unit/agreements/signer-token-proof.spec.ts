/**
 * A signer's own link is handed out only to a recipient who proved who they are.
 *
 * The inspection id is not a credential: it shows up in calendar feeds, report links and other pages. Two public doors used to answer
 * an inspection id alone with the first outstanding signer's sign link: `GET /sign/:tenant/:id` (a redirect) and the report-gate
 * payload (`actionUrl`). Both now need the recipient's portal token, and return that recipient's own link, never another signer's.
 * Every refusal sits beside the request that goes through, so a route that refuses everything cannot pass.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { app } from '../../../server/index';
import { makeExecutionContext } from '../helpers/exec-ctx';
import * as schema from '../../../server/lib/db/schema';
import { AgreementService } from '../../../server/services/agreement.service';
import { PortalAccessService } from '../../../server/services/portal-access.service';
import { createHarness, TENANT_ID, TENANT_SLUG, INSPECTOR_ID, type Harness } from '../helpers/tenant-email-harness';

const INSPECTION_ID = '33333333-0000-4000-8000-000000000a01';
const OTHER_INSPECTION_ID = '33333333-0000-4000-8000-000000000a02';
const AGREEMENT_ID = '33333333-0000-4000-8000-000000000b01';
const CASEY = 'casey@client.test';
const DREW = 'drew@client.test';

describe('a signer link needs a recipient proof', () => {
    let h: Harness;
    let caseyToken: string;
    let otherToken: string;
    let caseyLink: string;

    const get = async (path: string): Promise<Response> => {
        const exec = makeExecutionContext({ label: 'signer-token-proof' });
        const res = await app.request(path, { redirect: 'manual' }, h.env, exec.ctx);
        await exec.settle();
        return res;
    };

    beforeEach(async () => {
        h = await createHarness('standalone');
        const now = new Date();
        for (const id of [INSPECTION_ID, OTHER_INSPECTION_ID]) {
            await h.db.insert(schema.inspections).values({
                id, tenantId: TENANT_ID, inspectorId: INSPECTOR_ID, propertyAddress: '12 Lighthouse Road', date: '2026-06-01', status: 'requested',
                paymentStatus: 'unpaid', price: 0, agreementRequired: true, paymentRequired: false, createdAt: now,
            } as never);
        }
        await h.db.insert(schema.agreements).values({ id: AGREEMENT_ID, tenantId: TENANT_ID, name: 'Standard Agreement', content: 'Text', version: 1, createdAt: now });
        const agreements = new AgreementService(h.env.DB, { jwtSecret: h.env.JWT_SECRET });
        await agreements.findOrCreate(TENANT_ID, INSPECTION_ID, {
            signers: [{ name: 'Casey Client', email: CASEY, role: 'client' }, { name: 'Drew Client', email: DREW, role: 'co_client' }],
            completionPolicy: 'all',
        });
        // Casey is the FIRST signer in order: "the first outstanding signer" would be Casey's link.
        caseyLink = (await agreements.getSignerLinkByEmail(TENANT_ID, INSPECTION_ID, CASEY))!;
        expect(caseyLink).toBeTruthy();
        const portal = new PortalAccessService(h.env.DB, { jwtSecret: h.env.JWT_SECRET });
        caseyToken = await portal.issueToken({ tenantId: TENANT_ID, inspectionId: INSPECTION_ID, recipientEmail: DREW });
        otherToken = await portal.issueToken({ tenantId: TENANT_ID, inspectionId: OTHER_INSPECTION_ID, recipientEmail: CASEY });
    });
    afterEach(() => h.close());

    describe('GET /sign/:tenant/:id', () => {
        it('sends an inspection id alone to the client portal and never to a signer link', async () => {
            const res = await get(`/sign/${TENANT_SLUG}/${INSPECTION_ID}`);
            expect(res.status).toBe(302);
            const location = res.headers.get('location') ?? '';
            expect(location).toBe(`/portal/${TENANT_SLUG}/i/${INSPECTION_ID}?section=overview`);
            expect(location).not.toContain('/agreements/sign/');
            expect(location).not.toContain(caseyLink);
        });

        it('sends a token of ANOTHER inspection to the portal, and a token that names nothing to a page that is not a signer link', async () => {
            const other = (await get(`/sign/${TENANT_SLUG}/${INSPECTION_ID}?token=${otherToken}`)).headers.get('location') ?? '';
            expect(other).toBe(`/portal/${TENANT_SLUG}/i/${INSPECTION_ID}?section=overview`);
            const bogus = (await get(`/sign/${TENANT_SLUG}/${INSPECTION_ID}?token=not-a-real-token`)).headers.get('location') ?? '';
            expect(bogus).not.toContain('/agreements/sign/');
            expect(bogus).not.toContain(caseyLink);
        });

        it('with the recipient token, sends that recipient to THEIR OWN signer link, not the first signer', async () => {
            const location = (await get(`/sign/${TENANT_SLUG}/${INSPECTION_ID}?token=${caseyToken}`)).headers.get('location') ?? '';
            const drewLink = (await new AgreementService(h.env.DB, { jwtSecret: h.env.JWT_SECRET }).getSignerLinkByEmail(TENANT_ID, INSPECTION_ID, DREW))!;
            expect(location).toBe(`/agreements/sign/${TENANT_SLUG}/${drewLink}`);
            expect(location).not.toContain(caseyLink);
        });
    });

    describe('GET /api/public/report-gate/:tenant/:id', () => {
        const gateUrl = (query = '') => `/api/public/report-gate/${TENANT_SLUG}/${INSPECTION_ID}${query}`;
        const actionUrl = async (query = ''): Promise<string> => {
            const res = await get(gateUrl(query));
            expect(res.status).toBe(200);
            const body = await res.json() as { data: { actionUrl: string } | null };
            return body.data!.actionUrl;
        };

        it('carries no signer token without a recipient proof, and falls back to the portal', async () => {
            const url = await actionUrl();
            expect(url).not.toContain(caseyLink);
            expect(url).not.toContain('/agreements/sign/');
            expect(url).not.toContain('/checkout/');
            expect(url).toBe(`/portal/${TENANT_SLUG}/i/${INSPECTION_ID}?section=overview`);
            // A token of another inspection proves nothing here either.
            expect(await actionUrl(`?token=${otherToken}`)).toBe(`/portal/${TENANT_SLUG}/i/${INSPECTION_ID}?section=overview`);
        });

        it('with the recipient token returns that recipient own link', async () => {
            const drewLink = (await new AgreementService(h.env.DB, { jwtSecret: h.env.JWT_SECRET }).getSignerLinkByEmail(TENANT_ID, INSPECTION_ID, DREW))!;
            const url = await actionUrl(`?token=${caseyToken}`);
            expect(url).toContain(drewLink);
            expect(url).not.toContain(caseyLink);
        });
    });
});
