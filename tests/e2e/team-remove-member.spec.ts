/**
 * Team page - removing a member.
 *
 * An owner opens /team, presses Remove on a member, reads the warning about
 * data that may still be on that member's devices, confirms, and the member is
 * gone - and stays gone after a reload (the list is read from the server, so a
 * row that only vanished client-side would come back).
 *
 * Uses a throwaway member invited off the shared admin, never the admin or the
 * seeded inspector that other projects log in with.
 */
import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { csrfHeaders } from './helpers/csrf';

const BASE_URL = 'http://127.0.0.1:8789';
const ADMIN_EMAIL = 'admin@autotest.com';
const ADMIN_PASSWORD = 'Password123!';
const MEMBER_EMAIL = 'remove-me-e2e@autotest.com';

const WARNING =
    'Their devices may still hold inspection data that has not been uploaded. Once removed, that data can no longer be uploaded. Ask them to connect and sync first. If that is not possible, they can export the data from the app and give it to another team member to import.';

async function adminToken(request: APIRequestContext): Promise<string> {
    const { headers } = csrfHeaders();
    const res = await request.post(`${BASE_URL}/api/auth/login`, {
        data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
        headers: { 'Content-Type': 'application/json', ...headers },
    });
    expect(res.status(), 'admin login').toBe(200);
    return (res.headers()['set-cookie'] ?? '').match(/__Host-inspector_token=([^;]+)/)?.[1] ?? '';
}

async function addMember(request: APIRequestContext, token: string): Promise<void> {
    const invite = await request.post(`${BASE_URL}/api/team/invite`, {
        data: { email: MEMBER_EMAIL, role: 'inspector' },
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    });
    expect(invite.status(), 'invite').toBe(201);
    const body = await invite.json();
    const joinToken = new URL(body.data?.inviteLink ?? '').searchParams.get('token') ?? '';
    expect(joinToken, 'invite link carries a token').toBeTruthy();
    const join = await request.post(`${BASE_URL}/api/auth/join`, {
        data: { token: joinToken, password: 'RemoveMe123!', name: 'Remove Me' },
        headers: { 'Content-Type': 'application/json' },
    });
    expect(join.status(), 'join').toBe(200);
}

test('an owner removes a member after reading the unsynced-data warning', async ({ page, request }) => {
    await addMember(request, await adminToken(request));

    await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
    await page.fill('input[name=email]', ADMIN_EMAIL);
    await page.fill('input[name=password]', ADMIN_PASSWORD);
    await page.click('button[type=submit]');
    await page.waitForURL('**/inspections', { timeout: 15000 });

    await page.goto(`${BASE_URL}/team`, { waitUntil: 'networkidle' });
    const row = page.getByRole('row').filter({ hasText: MEMBER_EMAIL });
    await expect(row).toBeVisible();

    // The signed-in owner's own row offers no Remove.
    await expect(page.getByRole('row').filter({ hasText: ADMIN_EMAIL }).getByRole('button', { name: 'Remove' })).toHaveCount(0);

    await row.getByRole('button', { name: 'Remove' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Remove Remove Me?')).toBeVisible();
    await expect(dialog.getByText(WARNING)).toBeVisible();

    await dialog.getByRole('button', { name: 'Remove member' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(MEMBER_EMAIL)).toHaveCount(0);

    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByText(MEMBER_EMAIL)).toHaveCount(0);
    await expect(page.getByText(ADMIN_EMAIL)).toBeVisible();
});
