/**
 * Design System 0520 subsystem B phase 7 task 7.3 — TeamStrip E2E.
 *
 * Two-context test: both inspectors open the dashboard simultaneously and
 * each should see the other appear in TeamStrip's roster within a few
 * seconds (server WS broadcast latency target = sub-second on local).
 *
 * Required env vars:
 *   TEST_INSPECTOR_A_EMAIL   / TEST_INSPECTOR_A_PASSWORD
 *   TEST_INSPECTOR_B_EMAIL   / TEST_INSPECTOR_B_PASSWORD
 *
 * Both users must be in the same tenant. Skipped automatically when any
 * env var is missing.
 */
import { test, expect } from '@playwright/test';

const A_EMAIL    = process.env['TEST_INSPECTOR_A_EMAIL'];
const A_PASSWORD = process.env['TEST_INSPECTOR_A_PASSWORD'];
const B_EMAIL    = process.env['TEST_INSPECTOR_B_EMAIL'];
const B_PASSWORD = process.env['TEST_INSPECTOR_B_PASSWORD'];

test.describe('TeamStrip live presence (subsystem B M3 + M7)', () => {
    test.skip(
        !A_EMAIL || !A_PASSWORD || !B_EMAIL || !B_PASSWORD,
        'Set TEST_INSPECTOR_A_* and TEST_INSPECTOR_B_* (same tenant) to run.',
    );

    test('two contexts on /inspections see each other in TeamStrip roster', async ({ browser }) => {
        const ctxA = await browser.newContext();
        const ctxB = await browser.newContext();
        const pageA = await ctxA.newPage();
        const pageB = await ctxB.newPage();

        for (const [page, email, password] of [
            [pageA, A_EMAIL!, A_PASSWORD!] as const,
            [pageB, B_EMAIL!, B_PASSWORD!] as const,
        ]) {
            await page.goto('/login');
            await page.fill('input[name=email]',    email);
            await page.fill('input[name=password]', password);
            await page.click('button[type=submit]');
            await page.waitForURL('**/inspections');
        }

        // TeamStrip is conditionally rendered when members.length > 1; both
        // pages should show the eyebrow "Team today" once the static roster
        // loads.
        await expect(pageA.locator('text=Team today')).toBeVisible({ timeout: 5_000 });
        await expect(pageB.locator('text=Team today')).toBeVisible({ timeout: 5_000 });

        // After the WS broadcasts the join roster (~2s budget), at least one
        // "Online" tile should be visible on each side. De-stale (2026-07
        // tests-reorg): the RR v7 TeamStrip renders online members as
        // <span class="text-ih-ok-fg">Online</span> (app/components/dashboard/
        // TeamStrip.tsx:59) — was the Alpine [x-data*=teamStrip] root.
        await expect(pageA.getByText('Online', { exact: true }).first()).toBeVisible({ timeout: 10_000 });
        await expect(pageB.getByText('Online', { exact: true }).first()).toBeVisible({ timeout: 10_000 });
    });
});
