/**
 * Design System 0520 subsystem C P11 T11.2 — guest claim happy path.
 *
 * Skipped pending the multi-user seed harness. Covered indirectly by:
 *
 *   tests/unit/guest-invite-service.spec.ts  (7 tests, GREEN)
 *   tests/unit/seat-guard.spec.ts            (6 tests, GREEN)
 *
 * The Alpine factories in public/js/invite-seat-modal.js + guest-join.js
 * are static-source-only smoke-tested at lint time.
 */
import { test, expect } from '@playwright/test';

test.skip('admin mints guest invite → anonymous claim succeeds', async ({ browser }) => {
    const adminCtx = await browser.newContext();
    const guestCtx = await browser.newContext();
    const adminP   = await adminCtx.newPage();
    const guestP   = await guestCtx.newPage();

    await adminP.goto('/login');
    await adminP.fill('input[name=email]',    'admin@seed.test');
    await adminP.fill('input[name=password]', 'seedpassword');
    await adminP.click('button[type=submit]');
    await adminP.goto('/team');

    await adminP.click('text=Invite');
    await adminP.click('text=Guest');
    await adminP.click('text=24h');
    await adminP.click('text=Generate link');
    const url = await adminP.locator('input[readonly]').inputValue();
    expect(url).toMatch(/\/guest-join\?token=/);

    await guestP.goto(url);
    await guestP.fill('input[name=name]',     'Test Guest');
    await guestP.fill('input[name=email]',    'guest-e2e@test');
    await guestP.fill('input[name=password]', 'guestpass1234');
    await guestP.click('button[type=submit]');
    await expect(guestP).toHaveURL(/\/login/);
});

test.skip('admin tries to invite when tenant at quota → 402 surfaced', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name=email]',    'admin-full@seed.test');
    await page.fill('input[name=password]', 'seedpassword');
    await page.click('button[type=submit]');

    page.on('dialog', d => d.dismiss());

    await page.goto('/team');
    await page.click('text=Invite');
    await page.fill('input[type=email]', 'newbie@test');
    await page.click('text=Send invite');
    const r = await page.waitForResponse(r => r.url().includes('/api/team/invite'));
    expect(r.status()).toBe(402);
});
