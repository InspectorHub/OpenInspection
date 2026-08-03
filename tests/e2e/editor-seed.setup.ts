/**
 * Setup project — seeds the editable inspections for the editor subsystem E2E
 * specs, then writes the handoff read by {@link readEditorSeed}.
 *
 * Runs AFTER `api` (declared as its dependency), so the standalone workspace +
 * admin (`admin@autotest.com`) already exist and this never re-runs /setup —
 * it just logs in as that admin, creates ONE template, and then one inspection
 * per project that edits one. The admin can edit every inspection, so the specs
 * log in as the same user (no separate inspector seat needed).
 *
 * The template is shared on purpose: no spec edits the template, only the
 * inspections made from it. See `helpers/editor-seed.ts` for why the
 * inspections are not.
 */
import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { makeCsrfToken } from './helpers/csrf';
import {
    writeEditorSeed,
    EXCLUSIVE_SEED_PROJECTS,
    SHARED_SEED_KEY,
    type EditorSeedFile,
} from './helpers/editor-seed';

const BASE_URL = 'http://127.0.0.1:8789';
const ADMIN_EMAIL = 'admin@autotest.com';
const ADMIN_PASSWORD = 'Password123!';

/** One inspection from `templateId`, labelled so a failure names its owner. */
async function createInspection(
    request: APIRequestContext,
    auth: Record<string, string>,
    templateId: string,
    owner: string,
): Promise<string> {
    const insp = await request.post(`${BASE_URL}/api/inspections`, {
        data: {
            // The address carries the owning project so a row seen in the DB (or
            // in a screenshot of a failure) says which spec it belongs to.
            propertyAddress: `1 Editor Seed Street, Testville (${owner})`,
            clientName: 'Editor Seed Client',
            clientEmail: 'editor-seed@example.com',
            templateId,
        },
        headers: auth,
    });
    expect(insp.status(), `inspection creation for "${owner}" must return 201`).toBe(201);
    const id = (await insp.json()).data?.inspection?.id as string | undefined;
    expect(id, `inspection id for "${owner}" must be returned`).toBeTruthy();
    return id!;
}

test('editor-seed: create one editable inspection per editing project', async ({ request }) => {
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

    // ── Template with three rich items → each inspection inherits an item list
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

    // ── One inspection per editing project, plus one for the credentials-only
    //    projects to share. Serial by design: the API mints ids per request and
    //    the whole loop is a handful of calls against a warm worker.
    const seeds: EditorSeedFile = {};
    for (const owner of [SHARED_SEED_KEY, ...EXCLUSIVE_SEED_PROJECTS]) {
        seeds[owner] = {
            email: ADMIN_EMAIL,
            password: ADMIN_PASSWORD,
            inspectionId: await createInspection(request, auth, templateId!, owner),
        };
    }

    writeEditorSeed(seeds);
});
