/**
 * Settings -> Offline packages: a person brings in a package a device exported,
 * end to end against the seeded standalone worker.
 *
 * The package names three inspections: two that exist in this company and one
 * that does not (and that the package does not create). The server refuses a
 * package for naming the missing one, and says which one; the page must take that
 * inspection out, send the rest, and keep the missing one on screen with a reason
 * and the server's own answer. Importing the same file again must change nothing.
 *
 * The signed-in person is a manager invited for this run, never the shared admin:
 * `auth-two-factor` and `team-remove-member` also work off that admin, and a page
 * login here must not compete with them for it. The admin is used only through
 * the API, to create the template and the two inspections the package refers to.
 *
 * Nothing here switches a native-client flag on: the import is called with the
 * browser's own session cookie, which is how a person on this page reaches it.
 */
import { test, expect } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import * as Y from 'yjs';
import { applyItemPatch, seedResultsDoc } from '../../server/lib/collab/results-doc';
import { buildPackage } from '../unit/helpers/offline-package-fixture';
import { csrfHeaders } from './helpers/csrf';

const BASE_URL = 'http://127.0.0.1:8789';
const ADMIN_EMAIL = 'admin@autotest.com';
const ADMIN_PASSWORD = 'Password123!';
const RUN = Date.now();
const MANAGER_EMAIL = `offline-import-${RUN}@autotest.com`;
const MANAGER_PASSWORD = 'OfflineImport123!';
// A key the server's own document does not hold. Two documents that each create the same key
// concurrently keep only one of the two (Yjs picks a winner), so a device that seeded `roof` itself
// would lose its rating to the server's empty entry; a real device starts from the server's state.
const FINDING = '_default:offline:added-on-device';

interface Real { id: string; reportId: string; before: string; after: string }

async function login(request: APIRequestContext, email: string, password: string): Promise<string> {
    const { headers } = csrfHeaders();
    const res = await request.post(`${BASE_URL}/api/auth/login`, {
        data: { email, password },
        headers: { 'Content-Type': 'application/json', ...headers },
    });
    expect(res.status(), `login as ${email}`).toBe(200);
    const token = (res.headers()['set-cookie'] ?? '').match(/__Host-inspector_token=([^;]+)/)?.[1] ?? '';
    expect(token, 'login returns a session cookie').toBeTruthy();
    return token;
}

function tenantOf(token: string): string {
    const claims = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as Record<string, unknown>;
    const tenantId = claims['custom:tenantId'];
    expect(typeof tenantId, 'the session names its company').toBe('string');
    return tenantId as string;
}

async function seedInspection(request: APIRequestContext, auth: Record<string, string>, templateId: string, label: string): Promise<Real> {
    const before = `1 ${label} Before Road, Testville`;
    const created = await request.post(`${BASE_URL}/api/inspections`, { data: { propertyAddress: before, templateId }, headers: auth });
    expect(created.status(), 'inspection creation').toBe(201);
    const id = (await created.json()).data?.inspection?.id as string;
    expect(id).toBeTruthy();
    const state = await request.get(`${BASE_URL}/api/inspections/${id}/report-translation`, { headers: auth });
    expect(state.status(), 'the primary report id is readable').toBe(200);
    const reportId = (await state.json()).data?.reports?.[0]?.reportId as string;
    expect(reportId, 'the inspection has a primary report').toBeTruthy();
    return { id, reportId, before, after: `2 ${label} After Road, Testville` };
}

async function addManager(request: APIRequestContext, adminToken: string): Promise<void> {
    const invite = await request.post(`${BASE_URL}/api/team/invite`, {
        data: { email: MANAGER_EMAIL, role: 'manager' },
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    });
    expect(invite.status(), 'invite').toBe(201);
    const joinToken = new URL((await invite.json()).data?.inviteLink ?? '').searchParams.get('token') ?? '';
    expect(joinToken, 'the invite link carries a token').toBeTruthy();
    const join = await request.post(`${BASE_URL}/api/auth/join`, {
        data: { token: joinToken, password: MANAGER_PASSWORD, name: 'Offline Import Manager' },
        headers: { 'Content-Type': 'application/json' },
    });
    expect(join.status(), 'join').toBe(200);
}

function deviceState(rating: string): Uint8Array {
    const doc = new Y.Doc();
    seedResultsDoc(doc, [{ findingKey: FINDING }]);
    applyItemPatch(doc, FINDING, 'rating', rating);
    return Y.encodeStateAsUpdate(doc);
}

function buildExport(tenantId: string, exportedBy: string, real: Real[], missingId: string): Buffer {
    const all = [...real.map((r) => ({ id: r.id, reportId: r.reportId })), { id: missingId, reportId: 'device-report' }];
    const zip = buildPackage({
        tenantId, exportedBy,
        inspections: all,
        yjs: Object.fromEntries(all.map((i) => [i.id, deviceState('Repair')])),
        outbox: real.map((r) => ({
            idempotencyKey: `e2e-${RUN}-${r.id}`, op: 'inspection.update', payload: { id: r.id, propertyAddress: r.after },
        })),
        manifest: { exportedAt: new Date().toISOString() },
    });
    return Buffer.from(zip);
}

async function signIn(page: Page): Promise<void> {
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
    await page.fill('input[name=email]', MANAGER_EMAIL);
    await page.fill('input[name=password]', MANAGER_PASSWORD);
    await page.click('button[type=submit]');
    await page.waitForURL('**/inspections', { timeout: 15000 });
}

async function chooseAndImport(page: Page, name: string, file: Buffer): Promise<void> {
    await page.locator('input[type=file]').setInputFiles({ name, mimeType: 'application/zip', buffer: file });
    await expect(page.getByTestId('offline-package-preview')).toBeVisible();
    await expect(page.getByText('This package was exported for this company.')).toBeVisible();
    await page.getByRole('button', { name: 'Review and import' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Import package' }).click();
    await expect(page.getByTestId('offline-package-result')).toBeVisible({ timeout: 60000 });
}

const stat = (page: Page, label: string) => page.getByTestId('offline-package-result').locator('xpath=.//*[normalize-space(text())="' + label + '"]/..');

test('a manager imports a package, the missing inspection is left behind with its reason, and a repeat changes nothing', async ({ page, request }) => {
    test.setTimeout(180000);
    const adminToken = await login(request, ADMIN_EMAIL, ADMIN_PASSWORD);
    const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` };
    const tenantId = tenantOf(adminToken);

    const template = await request.post(`${BASE_URL}/api/inspections/templates`, {
        data: {
            name: `Offline import template ${RUN}`,
            schema: { schemaVersion: 2, sections: [{ id: 'roof', title: 'Roof', items: [{ id: 'roof', label: 'Roof', type: 'rich', ratingOptions: ['Inspected', 'Repair'], tabs: { information: [], limitations: [], defects: [] } }] }] },
        },
        headers: auth,
    });
    expect(template.status(), 'template creation').toBe(201);
    const templateId = (await template.json()).data?.template?.id as string;

    const first = await seedInspection(request, auth, templateId, 'First');
    const second = await seedInspection(request, auth, templateId, 'Second');
    const missingId = `no-such-inspection-${RUN}`;
    await addManager(request, adminToken);

    const file = buildExport(tenantId, 'device-owner', [first, second], missingId);

    await signIn(page);
    await page.goto(`${BASE_URL}/settings/offline-packages`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'Choose a package' })).toBeVisible();

    // ---- first upload: the two real inspections arrive, the missing one is left behind ----
    await chooseAndImport(page, 'rescue.zip', file);
    await expect(stat(page, 'Imported')).toContainText('2');
    await expect(stat(page, 'Not imported')).toContainText('1');
    const held = page.getByTestId('offline-package-held-back');
    await expect(held.getByTestId('held-back-row')).toHaveCount(1);
    await expect(held.getByTestId('held-back-row')).toContainText(missingId);
    await expect(held.getByText('Not found', { exact: true })).toBeVisible();
    await expect(held.getByText('This inspection does not exist in this company.')).toBeVisible();
    await expect(held.getByTestId('held-back-row')).toContainText('Server answer: 404');

    // What the server holds now: the queued change and the device's rating, for both real inspections.
    for (const real of [first, second]) {
        const read = await request.get(`${BASE_URL}/api/inspections/${real.id}`, { headers: auth });
        expect((await read.json()).data?.inspection?.propertyAddress, 'the queued change was applied').toBe(real.after);
        await expect.poll(async () => {
            const results = await request.get(`${BASE_URL}/api/inspections/${real.id}/results`, { headers: auth });
            return JSON.stringify((await results.json()).data?.results);
        }, { message: 'the device rating reaches the stored results', timeout: 15000 }).toContain('Repair');
    }

    // ---- the same file again: the changes are skipped, nothing is applied twice ----
    await page.getByRole('button', { name: 'Import another package' }).click();
    await chooseAndImport(page, 'rescue-again.zip', file);
    await expect(stat(page, 'Skipped')).toContainText('2');
    await expect(stat(page, 'Imported')).toContainText('2');
    await expect(stat(page, 'Not imported')).toContainText('1');
    await expect(page.getByTestId('offline-package-held-back').getByTestId('held-back-row')).toContainText(missingId);
    for (const real of [first, second]) {
        const read = await request.get(`${BASE_URL}/api/inspections/${real.id}`, { headers: auth });
        expect((await read.json()).data?.inspection?.propertyAddress).toBe(real.after);
    }
});
