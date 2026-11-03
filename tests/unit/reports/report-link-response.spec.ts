/**
 * The report a person reads from a report link is built from lists of fields (server/lib/report-link-response.ts), not from whole rows.
 *
 * Three things are checked, because each can fail alone:
 *  1. the projection itself (a key nobody classified does not get out);
 *  2. every column of the three tables the report is built from is CLASSIFIED here, so a column added later fails this spec until a person
 *     says whether a report reader receives it;
 *  3. the real route, through the real application, for a client link and an agent link, with a value planted in the columns that must
 *     stay out and a control that the same value is read where it belongs.
 */
import { getTableColumns } from 'drizzle-orm';
import { describe, it, expect } from 'vitest';
import { app } from '../../../server/index';
import { buildKeyring, signJwt } from '../../../server/lib/jwt-keyring';
import {
    projectReportForLink, REPORT_LINK_DOCUMENT_REVIEW_FIELDS, REPORT_LINK_INSPECTION_FIELDS, REPORT_LINK_SIGNOFF_FIELDS, REPORT_LINK_TOP_LEVEL_KEYS,
} from '../../../server/lib/report-link-response';
import type { ReportData } from '../../../server/lib/translation/report-span-register';
import { PortalAccessService } from '../../../server/services/portal-access.service';
import { signRenderToken } from '../../../server/lib/render-token';
import * as schema from '../../../server/lib/db/schema';
import { makeExecutionContext } from '../helpers/exec-ctx';
import { createHarness, INSPECTOR_ID, OWNER_ID, TENANT_ID, TENANT_SLUG } from '../helpers/tenant-email-harness';

/** Columns of `inspections` a report reader does NOT receive. Together with the public four they must be every column of the table. */
const INSPECTION_WITHHELD = [
    'addressCity', 'addressCounty', 'addressGeocodedAt', 'addressLat', 'addressLng', 'addressPlaceId', 'addressState', 'addressStreet', 'addressZip',
    'agreementRequired', 'autoSignOnPublish', 'badgeLayoutOverride', 'bathrooms', 'bedrooms', 'cancelNotes', 'cancelReason', 'closingDate',
    'commercialSubtype', 'conciergeStatus', 'confirmedAt', 'county', 'coverCrop', 'coverImageKey', 'coverPhotoId', 'createdAt', 'depositOverridden',
    'depositRequiredCents', 'deviations', 'disableAutomations', 'discountAmount', 'discountCodeId', 'durationMin', 'foundationType', 'inspectorId',
    'internalNotes', 'locationOptions', 'lotSize', 'paymentRequired', 'paymentStatus', 'pcaNarrative', 'price', 'profileOverride', 'propertyFacts',
    'propertyType', 'referenceNumber', 'referralSource', 'referredByContactId', 'reinspectionRound', 'reportPhotoColumns', 'reportPhotoMode',
    'reportStatus', 'reportTier', 'reportsGeneratedAt', 'requestId', 'requireDefectFieldsOverride', 'rootInspectionId', 'samplingDeclaration',
    'scheduledEndMs', 'scheduledStartMs', 'sourceInspectionId', 'sqft', 'teamMode', 'templateId', 'templateSnapshot', 'templateSnapshotVersion',
    'tenantId', 'unit', 'unitInspectionMode', 'unlockReason', 'unlockedAt', 'unlockedBy', 'yearBuilt',
];
const SIGNOFF_WITHHELD = ['id', 'inspectionId', 'personId', 'signatureRef', 'tenantId'];
const DOCUMENT_REVIEW_WITHHELD = ['id', 'inspectionId', 'sortOrder', 'tenantId'];

describe('the report link response: every column is classified', () => {
    it.each([
        ['inspections', schema.inspections, REPORT_LINK_INSPECTION_FIELDS.filter((field) => field !== 'inspectorName'), INSPECTION_WITHHELD],
        ['report_signoff', schema.reportSignoff, REPORT_LINK_SIGNOFF_FIELDS, SIGNOFF_WITHHELD],
        ['document_review_items', schema.documentReviewItems, REPORT_LINK_DOCUMENT_REVIEW_FIELDS, DOCUMENT_REVIEW_WITHHELD],
    ] as const)('%s: each column is either received or withheld, and nothing is both', (_name, table, received, withheld) => {
        const columns = Object.keys(getTableColumns(table as never)).sort();
        expect([...received, ...withheld].sort()).toEqual(columns);
        expect(received.filter((field) => (withheld as readonly string[]).includes(field))).toEqual([]);
    });

    it('would notice a column nobody classified (the control for the check above)', () => {
        const columns = Object.keys(getTableColumns(schema.inspections)).sort();
        const classified = [...REPORT_LINK_INSPECTION_FIELDS.filter((field) => field !== 'inspectorName'), ...INSPECTION_WITHHELD];
        expect(classified.sort()).toEqual(columns);
        expect([...classified, 'aColumnAddedLater'].sort()).not.toEqual(columns);
        expect(classified.filter((name) => name !== 'tenantId').sort()).not.toEqual(columns);
    });
});

describe('projectReportForLink', () => {
    const report = {
        inspection: { id: 'i', propertyAddress: 'a', date: 'd', status: 's', inspectorName: 'n', tenantId: 't', internalNotes: 'x', paymentStatus: 'paid', discountAmount: 5 },
        reportSignoffs: [{ id: 's1', role: 'field_observer', name: 'N', license: 'L', qualificationsRef: 'q', signedAt: 1, signatureRef: 'sig', dualRole: false, tenantId: 't', personId: 'p', inspectionId: 'i' }],
        documentReview: [{ id: 'd1', documentKey: 'k', label: 'l', requested: true, received: true, reviewed: true, na: false, notes: 'n', sortOrder: 1, tenantId: 't', inspectionId: 'i' }],
        sections: [{ id: 'sec' }],
        stats: { total: 1 },
        aKeyNobodyClassified: 'not in any list',
    } as unknown as ReportData;

    it('keeps only the listed inspection, signoff and document-review fields', () => {
        const out = projectReportForLink(report);
        expect(Object.keys(out.inspection).sort()).toEqual([...REPORT_LINK_INSPECTION_FIELDS].sort());
        expect(Object.keys(out.reportSignoffs[0] ?? {}).sort()).toEqual([...REPORT_LINK_SIGNOFF_FIELDS].sort());
        expect(Object.keys(out.documentReview[0] ?? {}).sort()).toEqual([...REPORT_LINK_DOCUMENT_REVIEW_FIELDS].sort());
    });

    it('passes the classified report keys on as they are and omits a key nobody classified', () => {
        const out = projectReportForLink(report) as unknown as Record<string, unknown>;
        expect(out.sections).toEqual([{ id: 'sec' }]);
        expect(out.stats).toEqual({ total: 1 });
        expect(out).not.toHaveProperty('aKeyNobodyClassified');
    });

    it('a payload that lacks a key is projected without throwing, and the absent key stays absent', () => {
        const old = { inspectionId: 'insp1', sections: [] } as unknown as ReportData;
        const out = projectReportForLink(old) as unknown as Record<string, unknown>;
        expect(out).toEqual({ sections: [] });
        expect(out).not.toHaveProperty('inspection');
        expect(out).not.toHaveProperty('reportSignoffs');
        expect(out).not.toHaveProperty('documentReview');
    });

    it('a field the source row does not have is left out, not invented', () => {
        const out = projectReportForLink({ ...report, inspection: { id: 'i' } } as unknown as ReportData);
        expect(out.inspection).toEqual({ id: 'i' });
    });
});

const PLANTED = { internalNotes: 'planted-internal', unlockReason: 'planted-unlock', referenceNumber: 'planted-reference', referralSource: 'planted-referral', county: 'planted-county' };
// Distinctive on purpose: a short number can appear by chance among timestamps and hashes.
const AMOUNTS = ['9182737', '9182738', '9182739'];
const SNAPSHOT = { schemaVersion: 2, sections: [{ id: 'sec_roof', title: 'Roof', items: [{ id: 'itm_cover', label: 'Roof cover', type: 'rich' }] }] };

describe('the report route, through the real application', () => {
    async function setup() {
        const h = await createHarness('standalone');
        const id = '44444444-0000-4000-8000-0000000000c3';
        await h.db.insert(schema.inspections).values({
            id, tenantId: TENANT_ID, inspectorId: INSPECTOR_ID, propertyAddress: '500 Commerce Way', propertyType: 'commercial', reportTier: 'full_pca',
            date: '2026-11-01', status: 'completed', reportStatus: 'published', paymentStatus: 'paid', price: 9182737, discountAmount: 9182738,
            depositRequiredCents: 9182739, paymentRequired: false, agreementRequired: false, createdAt: new Date(), templateSnapshot: SNAPSHOT, ...PLANTED,
        } as never);
        await h.db.insert(schema.reportSignoff).values({
            id: 'so-1', tenantId: TENANT_ID, inspectionId: id, role: 'field_observer', personId: INSPECTOR_ID, name: 'Ivan Inspector', license: 'LIC-1',
            qualificationsRef: 'q-ref', signedAt: new Date(), signatureRef: 'sig-ref', dualRole: false,
        });
        await h.db.insert(schema.documentReviewItems).values({
            id: 'dr-1', tenantId: TENANT_ID, inspectionId: id, documentKey: 'pcr', label: 'Prior PCR', requested: true, received: true, reviewed: true,
            na: false, notes: 'Reviewed on site', sortOrder: 1,
        });
        const access = new PortalAccessService(h.env.DB, { jwtSecret: h.env.JWT_SECRET });
        const call = async (path: string, headers: Record<string, string> = {}) => {
            const exec = makeExecutionContext({ label: 'report-link' });
            const res = await app.request(path, { method: 'GET', headers }, h.env, exec.ctx);
            await exec.settle();
            const text = await res.text();
            return { status: res.status, text, json: JSON.parse(text) as { data: Record<string, unknown> } };
        };
        return { h, id, access, call };
    }

    it.each([['client', 'client'], ['agent', 'buyer_agent']] as const)('a %s link receives the listed fields only', async (_kind, role) => {
        const { h, id, access, call } = await setup();
        try {
            const token = await access.issueToken({ tenantId: TENANT_ID, inspectionId: id, recipientEmail: `${role}@example.test`, role });
            const res = await call(`/api/public/report/${TENANT_SLUG}/${id}?token=${encodeURIComponent(token)}`);
            expect(res.status).toBe(200);
            const data = res.json.data;
            expect(Object.keys(data.inspection as object).sort()).toEqual([...REPORT_LINK_INSPECTION_FIELDS].sort());
            expect((data.inspection as Record<string, unknown>).propertyAddress).toBe('500 Commerce Way');
            for (const planted of Object.values(PLANTED)) expect(res.text, planted).not.toContain(planted);
            for (const amount of AMOUNTS) expect(res.text, amount).not.toContain(amount);
            // The company id is not a field of any row below. (The storage key of a photo starts with it, because the photo route checks that
            // prefix; this fixture has no photos, so that carrier is not exercised here.)
            expect(data.inspection).not.toHaveProperty('tenantId');
            expect((data.reportSignoffs as Array<Record<string, unknown>>)[0]).not.toHaveProperty('tenantId');
            expect((data.documentReview as Array<Record<string, unknown>>)[0]).not.toHaveProperty('tenantId');
            expect(Object.keys((data.reportSignoffs as object[])[0] ?? {}).sort()).toEqual([...REPORT_LINK_SIGNOFF_FIELDS].sort());
            expect(Object.keys((data.documentReview as object[])[0] ?? {}).sort()).toEqual([...REPORT_LINK_DOCUMENT_REVIEW_FIELDS].sort());
            expect((data.documentReview as Array<Record<string, unknown>>)[0]?.notes).toBe('Reviewed on site');
            // the page keeps every other key of the report
            expect(Object.keys(data).sort()).toEqual([...REPORT_LINK_TOP_LEVEL_KEYS].sort());
        } finally { h.close(); }
    }, 120_000);

    it('the owner preview and the render-token path receive the same fields (all three paths share one exit)', async () => {
        const { h, id, call } = await setup();
        try {
            const keyring = await buildKeyring(h.env as unknown as Record<string, string | undefined>);
            const now = Math.floor(Date.now() / 1000);
            const jwt = await signJwt({ sub: OWNER_ID, 'custom:tenantId': TENANT_ID, 'custom:userRole': 'owner', iat: now, exp: now + 3600 }, keyring);
            const preview = await call(`/api/public/report/${TENANT_SLUG}/${id}`, { authorization: `Bearer ${jwt}` });
            expect(preview.status).toBe(200);
            expect(Object.keys(preview.json.data.inspection as object).sort()).toEqual([...REPORT_LINK_INSPECTION_FIELDS].sort());
            const render = await signRenderToken(id, h.env.JWT_SECRET);
            const rendered = await call(`/api/public/report/${TENANT_SLUG}/${id}?render=${encodeURIComponent(render)}`);
            expect(rendered.status).toBe(200);
            expect(Object.keys(rendered.json.data.inspection as object).sort()).toEqual([...REPORT_LINK_INSPECTION_FIELDS].sort());
            for (const amount of AMOUNTS) expect(preview.text + rendered.text).not.toContain(amount);
        } finally { h.close(); }
    }, 120_000);

    it('control: the staff report-data route returns the whole row, so the planted values are visible to this check', async () => {
        const { h, id, call } = await setup();
        try {
            const keyring = await buildKeyring(h.env as unknown as Record<string, string | undefined>);
            const now = Math.floor(Date.now() / 1000);
            const jwt = await signJwt({ sub: OWNER_ID, 'custom:tenantId': TENANT_ID, 'custom:userRole': 'owner', iat: now, exp: now + 3600 }, keyring);
            const res = await call(`/api/inspections/${id}/report-data`, { authorization: `Bearer ${jwt}` });
            expect(res.status).toBe(200);
            expect(res.text).toContain('planted-reference');
            expect(res.text).toContain('9182739');
            expect(Object.keys(res.json.data.inspection as object).length).toBeGreaterThan(REPORT_LINK_INSPECTION_FIELDS.length);
        } finally { h.close(); }
    }, 120_000);
});
