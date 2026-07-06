/**
 * Password reset — standalone auth pages.
 *
 * Exercises the forgot/reset flow end-to-end against the seeded standalone
 * worker. Anti-enumeration is the load-bearing assertion: an existing and an
 * unknown email MUST land on the identical confirmation. Base URL + seeded
 * admin mirror standalone-browser.spec.ts.
 *
 * The valid-token happy path reads the reset link back from the E2E email sink
 * (E2E_EMAIL_SINK, wired on the Playwright worker) via /api/__test__/last-email.
 */
import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { csrfHeaders } from './helpers/csrf';

const BASE_URL = 'http://127.0.0.1:8789';
const NAV_TIMEOUT = 15000;
const KNOWN_EMAIL = 'admin@autotest.com';
const ADMIN_PASSWORD = 'Password123!';
const INVALID_TOKEN = '00000000-0000-0000-0000-000000000000';

/** Log in via the API and return the session JWT (from the Set-Cookie). */
async function loginApi(request: APIRequestContext, email: string, password: string): Promise<string> {
  const { headers } = csrfHeaders();
  const res = await request.post(`${BASE_URL}/api/auth/login`, {
    data: { email, password },
    headers: { 'Content-Type': 'application/json', ...headers },
  });
  expect(res.status(), `login ${email}`).toBe(200);
  const cookie = res.headers()['set-cookie'] ?? '';
  return cookie.match(/__Host-inspector_token=([^;]+)/)?.[1] ?? '';
}

/** Admin-invite a member and return the join token from the invite link. */
async function inviteMember(request: APIRequestContext, adminToken: string, email: string): Promise<string> {
  const res = await request.post(`${BASE_URL}/api/team/invite`, {
    data: { email, role: 'inspector' },
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
  });
  expect(res.status(), 'invite must return 201').toBe(201);
  const body = await res.json();
  const link = body.data?.inviteLink ?? body.inviteLink ?? '';
  const token = new URL(link).searchParams.get('token') ?? '';
  expect(token, 'invite link must carry a token').toBeTruthy();
  return token;
}

/** Accept an invite (sets the member's initial password). */
async function acceptInvite(request: APIRequestContext, token: string, password: string): Promise<void> {
  const res = await request.post(`${BASE_URL}/api/auth/join`, {
    data: { token, password, name: 'Reset E2E User' },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.status(), 'join must return 200').toBe(200);
}

test.describe('Forgot password', () => {
  test('an existing email lands on the check-inbox confirmation', async ({ page }) => {
    await page.goto(`${BASE_URL}/forgot-password`, { timeout: NAV_TIMEOUT, waitUntil: 'networkidle' });
    await page.locator('input[type="email"]').fill(KNOWN_EMAIL);
    await page.getByRole('button', { name: /send reset link/i }).click();
    await expect(page.getByRole('heading', { name: /check your inbox/i })).toBeVisible();
    await expect(page.getByText(KNOWN_EMAIL)).toBeVisible();
  });

  test('an unknown email lands on the SAME confirmation (anti-enumeration)', async ({ page }) => {
    await page.goto(`${BASE_URL}/forgot-password`, { timeout: NAV_TIMEOUT, waitUntil: 'networkidle' });
    await page.locator('input[type="email"]').fill('definitely-not-a-user@example.com');
    await page.getByRole('button', { name: /send reset link/i }).click();
    await expect(page.getByRole('heading', { name: /check your inbox/i })).toBeVisible();
  });

  test('an invalid email shows a validation error and does not submit', async ({ page }) => {
    await page.goto(`${BASE_URL}/forgot-password`, { timeout: NAV_TIMEOUT, waitUntil: 'networkidle' });
    await page.locator('input[type="email"]').fill('nope');
    await page.getByRole('button', { name: /send reset link/i }).click();
    await expect(page.getByText('Invalid email address')).toBeVisible();
    await expect(page.getByRole('heading', { name: /check your inbox/i })).toHaveCount(0);
  });
});

test.describe('Login entry point', () => {
  test('login links to /forgot-password and navigates there', async ({ page }) => {
    await page.goto(`${BASE_URL}/login`, { timeout: NAV_TIMEOUT, waitUntil: 'networkidle' });
    const link = page.getByRole('link', { name: /forgot password/i });
    await expect(link).toHaveAttribute('href', '/forgot-password');
    // Click with the email still autofocused + empty. login.tsx reserves the
    // field-error slots, so the onBlur validation message no longer shifts the
    // link — the click lands. This guards against a return of that layout-shift
    // regression (which would steal the click and strand the user on /login).
    await link.click();
    await expect(page).toHaveURL(/\/forgot-password$/);
    await expect(page.getByRole('heading', { name: /reset your password/i })).toBeVisible();
  });
});

test.describe('Reset password', () => {
  test('a missing token shows the invalid state', async ({ page }) => {
    await page.goto(`${BASE_URL}/reset-password`, { timeout: NAV_TIMEOUT, waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: /reset link invalid/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /request a new link/i })).toBeVisible();
  });

  test('a weak password is rejected before hitting the API', async ({ page }) => {
    await page.goto(`${BASE_URL}/reset-password?token=${INVALID_TOKEN}`, {
      timeout: NAV_TIMEOUT,
      waitUntil: 'networkidle',
    });
    await page.locator('input[type="password"]').fill('weak');
    await page.getByRole('button', { name: /update password/i }).click();
    await expect(page.getByText('Password must be at least 8 characters')).toBeVisible();
  });

  test('a valid token updates the password, and the new password logs in', async ({ page, request }) => {
    // Use a throwaway member so we never mutate the shared admin/inspector creds
    // that other projects log in with.
    const email = 'pwreset-e2e@autotest.com';
    const initialPassword = 'InitialPass1!';
    const newPassword = 'BrandNewPass9!';

    // 1. Create the member (invite + accept) off the seeded admin.
    const adminToken = await loginApi(request, KNOWN_EMAIL, ADMIN_PASSWORD);
    expect(adminToken, 'admin must authenticate').toBeTruthy();
    const joinToken = await inviteMember(request, adminToken, email);
    await acceptInvite(request, joinToken, initialPassword);

    // 2. Request a reset through the real UI; the email sink captures the link.
    await page.goto(`${BASE_URL}/forgot-password`, { timeout: NAV_TIMEOUT, waitUntil: 'networkidle' });
    await page.locator('input[type="email"]').fill(email);
    await page.getByRole('button', { name: /send reset link/i }).click();
    await expect(page.getByRole('heading', { name: /check your inbox/i })).toBeVisible();

    // 3. Read the reset link back out of the sink and extract the token.
    const sink = await request.get(`${BASE_URL}/api/__test__/last-email?to=${encodeURIComponent(email)}`);
    expect(sink.status(), 'sink must have captured the reset email').toBe(200);
    const { data } = await sink.json();
    const match = String(data.html).match(/reset-password\?token=([A-Za-z0-9-]+)/);
    expect(match, 'reset email must contain a reset-password link').toBeTruthy();
    const token = match![1];

    // 4. Set a NEW password (different from the initial one) via the reset UI.
    await page.goto(`${BASE_URL}/reset-password?token=${token}`, { timeout: NAV_TIMEOUT, waitUntil: 'networkidle' });
    await page.locator('input[type="password"]').fill(newPassword);
    await page.getByRole('button', { name: /update password/i }).click();
    await expect(page.getByRole('heading', { name: /password updated/i })).toBeVisible();

    // 5. The new password authenticates.
    const newToken = await loginApi(request, email, newPassword);
    expect(newToken, 'new password should authenticate').toBeTruthy();

    // 6. The old password no longer works.
    const stale = await request.post(`${BASE_URL}/api/auth/login`, {
      data: { email, password: initialPassword },
      headers: { 'Content-Type': 'application/json', ...csrfHeaders().headers },
    });
    expect(stale.status(), 'old password must be rejected after reset').toBe(401);
  });
});
