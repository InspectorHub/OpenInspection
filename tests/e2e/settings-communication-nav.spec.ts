/**
 * Settings → Communication sticky section-nav (issue #250).
 *
 * Verifies the SectionNav: it renders (>=3 sections visible in standalone),
 * clicking a tab jumps to its section AND scroll-spy highlights it, and the bar
 * stays pinned to the viewport while scrolling. Uses the shared editor-seed
 * admin for login. Reduced-motion is emulated so the tab-jump scroll is instant
 * (deterministic) rather than a smooth animation.
 */
import { test, expect } from '@playwright/test';
import { readEditorSeed } from './helpers/editor-seed';

let adminEmail = '';
let adminPassword = '';

test.describe.serial('Settings → Communication sticky section-nav (#250)', () => {
  test.beforeAll(() => {
    const seed = readEditorSeed();
    test.skip(!seed, 'editor-seed handoff missing — run with the editor-seed setup project.');
    adminEmail = seed!.email;
    adminPassword = seed!.password;
  });

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/login');
    await page.fill('input[name=email]', adminEmail);
    await page.fill('input[name=password]', adminPassword);
    await page.click('button[type=submit]');
    await page.waitForURL('**/inspections');
    await page.goto('/settings/communication');
  });

  test('renders a labeled nav with a tab per visible section', async ({ page }) => {
    const nav = page.getByRole('navigation', { name: 'Section navigation' });
    await expect(nav).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Email delivery', exact: true })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'SMS delivery', exact: true })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Google Calendar', exact: true })).toBeVisible();
  });

  test('clicking a tab jumps to its section and scroll-spy highlights it', async ({ page }) => {
    const smsTab = page.getByRole('navigation', { name: 'Section navigation' })
      .getByRole('button', { name: 'SMS delivery', exact: true });

    // On load the first section's tab is the active one.
    await expect(
      page.getByRole('navigation', { name: 'Section navigation' })
        .getByRole('button', { name: 'Email delivery', exact: true }),
    ).toHaveClass(/text-ih-primary/);

    // Click SMS delivery: its section jumps under the bar and its tab activates.
    await smsTab.click();
    await expect(page.locator('#sms-delivery')).toBeInViewport({ ratio: 0.2 });
    await expect(smsTab).toHaveClass(/text-ih-primary/);
  });

  test('sticky bar stays pinned to the viewport while scrolling', async ({ page }) => {
    await page.evaluate(() => window.scrollTo(0, 1200));
    const navTop = await page
      .getByRole('navigation', { name: 'Section navigation' })
      .evaluate((el) => Math.round(el.getBoundingClientRect().top));
    // The sticky bar must remain within the top band of the viewport.
    expect(navTop).toBeGreaterThanOrEqual(0);
    expect(navTop).toBeLessThan(60);
  });
});
