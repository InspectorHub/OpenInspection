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

test('the dashboard, grouped by property', async ({ page, browser, baseURL, viewport }) => {
    const shot = shotsFor('agent-portal');

    // Sign up through the form. Turnstile is unset on this stack, so the widget
    // renders the always-pass test key and the submit goes through — the
    // challenge is never skipped, only permissive. If a future stack configures
    // a real key this walk stops working, which is the correct failure: it
    // would mean the page a reader meets is no longer the page photographed.
    //
    // THE SIGN-UP RUNS IN A CONTEXT WITHOUT THE FROZEN CLOCK. The harness pins
    // Date to 2026-06-11 for the whole browser context (page.clock cannot be
    // scoped to one page), and Cloudflare's widget runs inside that context in
    // its own iframe, where the pinned date is months away from the real time
    // the server stamps on the challenge: the widget answered with its expiry
    // callback ("Please complete the verification") and never a token. A real
    // visitor has a real clock, so the form is filled with one; only the
    // dashboard picture is taken under the frozen one, so its dates still
    // match every other capture.
    const real = await browser.newContext({ baseURL, viewport });
    try {
        const form = await real.newPage();
        await form.goto('/agent-signup');
        await form.locator('input[name=email]').fill(AGENT_EMAIL);
        await form.locator('input[name=password]').fill(AGENT_PASSWORD);
        const name = form.locator('input[name=name]');
        if (await name.count()) await name.fill('Dana Okafor');
        const accept = form.locator('input[type=checkbox]').first();
        if (await accept.count()) await accept.check();
        // Wait for the challenge's token before submitting: a click before it only shows "verify" and sends nothing. The
        // widget adds an input of its own inside its host; the form's is the direct child.
        await expect(form.getByTestId('agent-signup-turnstile')).toBeVisible({ timeout: 10_000 });
        await expect(form.getByTestId('agent-signup-turnstile').locator(':scope > input[name="cf-turnstile-response"]')).not.toHaveValue('', { timeout: 20_000 });
        await form.getByRole('button', { name: /Sign up|Create/i }).first().click();
        await form.waitForURL('**/agent-dashboard', { timeout: 30_000 });

        // Hand the session this sign-up produced to the framed page.
        await page.context().clearCookies();
        await page.context().addCookies((await real.storageState()).cookies);
    } finally {
        await real.close();
    }

    await page.goto('/agent-dashboard');
    await expect(page.locator('main')).toBeVisible();
    await shot(page, 'agent-dashboard', { fullPage: true });
});
