import { test, shotsFor, expect } from './_harness';

// Desktop only. The mobile project exists for the guides that document a phone
// flow; running these there would overwrite every capture with a narrow one
// under the same id — the prose that describes a three-pane editor would be
// illustrated by a single column.
test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'desktop captures');
});


/**
 * Captures for the two real-estate-agent guides, published as agent-account and
 * agent-portal.
 *
 * NO COPY LIVES HERE — every id has its `<!-- shot: … -->` in the prose.
 *
 * The sign-up page is photographed SIGNED OUT because that is the only state it
 * has for its reader. The dashboard needs an account, and this file makes one
 * through the real sign-up form rather than seeding a row: the agent track's
 * terms gate is part of what the guide documents, and a row inserted behind it
 * would produce a screenshot of a state no agent can actually be in.
 */

const AGENT_EMAIL = 'docs-agent@seed.test';
const AGENT_PASSWORD = 'DocsAgentPassw0rd!';

test('the sign-up form, with the terms shown in full', async ({ page }) => {
    const shot = shotsFor('agent-account');
    await page.context().clearCookies();
    await page.goto('/agent-signup');
    await expect(page.getByRole('button', { name: /Sign up|Create/i }).first()).toBeVisible();
    await shot(page, 'agent-signup', { fullPage: true });
});

test('the dashboard, grouped by property', async ({ page }) => {
    const shot = shotsFor('agent-portal');
    await page.context().clearCookies();

    // Sign up through the form. Turnstile is unset on this stack, so the widget
    // renders the always-pass test key and the submit goes through — the
    // challenge is never skipped, only permissive. If a future stack configures
    // a real key this walk stops working, which is the correct failure: it
    // would mean the page a reader meets is no longer the page photographed.
    await page.goto('/agent-signup');
    await page.locator('input[name=email]').fill(AGENT_EMAIL);
    await page.locator('input[name=password]').fill(AGENT_PASSWORD);
    const name = page.locator('input[name=name]');
    if (await name.count()) await name.fill('Dana Okafor');
    const accept = page.locator('input[type=checkbox]').first();
    if (await accept.count()) await accept.check();
    await page.getByRole('button', { name: /Sign up|Create/i }).first().click();

    await page.waitForURL('**/agent-dashboard', { timeout: 30_000 });
    await expect(page.locator('main')).toBeVisible();
    await shot(page, 'agent-dashboard', { fullPage: true });
});
