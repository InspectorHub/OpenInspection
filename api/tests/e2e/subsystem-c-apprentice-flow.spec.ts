/**
 * Design System 0520 subsystem C P11 T11.1 — apprentice happy-path E2E.
 *
 * Currently skipped: requires a seeded multi-user tenant (admin +
 * lead/mentor + apprentice + a team-mode inspection) which the global
 * setup does not yet provision. The supporting service + UI pieces are
 * exercised by:
 *
 *   tests/unit/apprentice-service.spec.ts  (7 tests, GREEN)
 *   tests/unit/can-edit.spec.ts            (11 tests, GREEN)
 *   tests/unit/role-alias.spec.ts          (GREEN)
 *
 * Unskip after adding the seed harness in tests/global-setup.ts.
 */
import { test, expect } from '@playwright/test';

test.skip('apprentice rates → mentor approves → value lands in inspection', async ({ browser }) => {
    const apprenticeCtx = await browser.newContext();
    const mentorCtx     = await browser.newContext();
    const appPage = await apprenticeCtx.newPage();
    const menPage = await mentorCtx.newPage();

    // Apprentice login + rate item
    await appPage.goto('/login');
    await appPage.fill('input[name=email]',    'apprentice-1@seed.test');
    await appPage.fill('input[name=password]', 'seedpassword');
    await appPage.click('button[type=submit]');
    await appPage.goto('/inspections/seed-team-inspection/edit');
    await appPage.click('[data-item-id=item-1] [data-rating=defect]');

    // Mentor sees the badge → click → review page → approve
    await menPage.goto('/login');
    await menPage.fill('input[name=email]',    'mentor-1@seed.test');
    await menPage.fill('input[name=password]', 'seedpassword');
    await menPage.click('button[type=submit]');
    await menPage.goto('/dashboard');
    await expect(menPage.locator('text=apprentice review(s) awaiting')).toBeVisible();
    await menPage.click('text=apprentice review(s) awaiting');
    await menPage.click('text=Approve');

    // Apprentice's rating now landed on the canonical inspection state
    await menPage.goto('/inspections/seed-team-inspection/edit');
    await expect(menPage.locator('[data-item-id=item-1] [data-rating-current=defect]')).toBeVisible();
});
