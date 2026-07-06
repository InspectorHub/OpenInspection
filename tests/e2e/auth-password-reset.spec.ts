/**
 * Password reset — standalone auth pages.
 *
 * Exercises the forgot/reset flow end-to-end against the seeded standalone
 * worker. Anti-enumeration is the load-bearing assertion: an existing and an
 * unknown email MUST land on the identical confirmation. Base URL + seeded
 * admin mirror standalone-browser.spec.ts.
 */
import { test, expect } from '@playwright/test';

const BASE_URL = 'http://127.0.0.1:8789';
const NAV_TIMEOUT = 15000;
const KNOWN_EMAIL = 'admin@autotest.com';
const INVALID_TOKEN = '00000000-0000-0000-0000-000000000000';

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

  // TODO(reset-happy-path): a *valid* reset token is minted by
  // createPasswordResetToken and emailed — no API returns it, so the browser
  // can't obtain one. Blocked on a test-only token capture (email sink or a
  // seeded token fixture). Service-level reset success is covered in
  // tests/unit/auth/auth.service.spec.ts.
  test.skip('a valid token updates the password and allows login', async () => {});
});
