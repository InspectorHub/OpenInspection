/**
 * Setup project — seeds one editable inspection (with items) for the editor
 * subsystem E2E specs, then writes the handoff read by {@link readEditorSeed}.
 *
 * Runs AFTER `api` (declared as its dependency), so the standalone workspace +
 * admin (`admin@autotest.com`) already exist and this never re-runs /setup —
 * it just logs in as that admin, creates a template + an inspection from it, and
 * records the fresh inspection id. The admin can edit the inspection, so the
 * specs log in as the same user (no separate inspector seat needed).
 */
import { test, expect } from '@playwright/test';
import { makeCsrfToken } from './helpers/csrf';
import { writeEditorSeed } from './helpers/editor-seed';

const BASE_URL = 'http://127.0.0.1:8789';
const ADMIN_EMAIL = 'admin@autotest.com';
const ADMIN_PASSWORD = 'Password123!';

test('editor-seed: create an editable inspection with items', async ({ request }) => {
    // ── Log in as the api-seeded admin (form-login parity: standalone accepts it).
    const csrf = makeCsrfToken();
    const login = await request.post(`${BASE_URL}/api/auth/login`, {
        data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrf,
            Cookie: `__Host-csrf_token=${csrf}`,
        },
    });
    expect(login.status(), 'admin login must succeed (api project seeds it)').toBe(200);
    const token = (login.headers()['set-cookie'] ?? '').match(/__Host-inspector_token=([^;]+)/)?.[1] ?? '';
    expect(token, 'login must return an auth cookie').toBeTruthy();
    const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

    // ── Template with three rich items → the inspection inherits an item list
    //    (SpeedMode/rating specs need at least one unrated item).
    const richItem = (id: string, label: string) => ({
        id, label, type: 'rich' as const,
        ratingOptions: ['Inspected', 'Repair'],
        tabs: { information: [], limitations: [], defects: [] },
    });
    const tpl = await request.post(`${BASE_URL}/api/inspections/templates`, {
        data: {
            name: 'Editor E2E Seed Template',
            schema: {
                schemaVersion: 2,
                sections: [{
                    id: 's_general',
                    title: 'General',
                    items: [richItem('roof', 'Roof'), richItem('plumbing', 'Plumbing'), richItem('electrical', 'Electrical')],
                }],
            },
        },
        headers: auth,
    });
    expect(tpl.status(), 'template creation must return 201').toBe(201);
    const templateId = (await tpl.json()).data?.template?.id as string | undefined;
    expect(templateId, 'template id must be returned').toBeTruthy();

    // ── Inspection from that template (mints a fresh UUID with the item list).
    const insp = await request.post(`${BASE_URL}/api/inspections`, {
        data: {
            propertyAddress: '1 Editor Seed Street, Testville',
            clientName: 'Editor Seed Client',
            clientEmail: 'editor-seed@example.com',
            templateId,
        },
        headers: auth,
    });
    expect(insp.status(), 'inspection creation must return 201').toBe(201);
    const inspectionId = (await insp.json()).data?.inspection?.id as string | undefined;
    expect(inspectionId, 'inspection id must be returned').toBeTruthy();

    writeEditorSeed({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, inspectionId: inspectionId! });
});
