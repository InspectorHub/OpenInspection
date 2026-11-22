import { test, shotsFor, expect } from './_harness';
import { apiGet, authedWriteHeaders, loginAsSeedUser } from '../e2e/helpers/seed-login';
import { SEED_EMAILS } from '../seed-fixtures';
import { ensureDocsTemplate } from './_docs-fixtures';

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

/**
 * Give the dashboard a real referral to photograph.
 *
 * `listReferrals` (server/services/agent/referral.ts) associates an agent with
 * an inspection ONLY through a `buyer_agent` inspection-people contact whose
 * email matches the agent account. The sign-up form creates the account but no
 * inspection, so without this the capture is an empty dashboard ("No referrals
 * yet") — a seed gap, not the product the agent-portal guide documents.
 *
 * Runs on an ADMIN page session, BEFORE the agent cookie is handed to `page`.
 * The buyer_agent link is asserted (it is what makes the picture non-empty);
 * complete/publish are best-effort because they only change the "reports ready"
 * count, not whether the referral row renders.
 */
async function seedAgentReferral(adminPage: import('@playwright/test').Page): Promise<void> {
    const rolesRes = await apiGet(adminPage, '/api/role-profiles');
    const roles = ((await rolesRes.json()) as { data?: Array<{ id: string; key: string }> }).data ?? [];
    const buyerAgent = roles.find((r) => r.key === 'buyer_agent');
    if (!buyerAgent) throw new Error('docs agent fixture: buyer_agent role profile missing');

    const post = async (path: string, body: Record<string, unknown>, statuses: number[]) => {
        const res = await adminPage.request.post(path, {
            headers: await authedWriteHeaders(adminPage),
            data: body,
        });
        if (!statuses.includes(res.status())) {
            throw new Error(`docs agent fixture: ${path} -> ${res.status()} ${await res.text()}`);
        }
        return res.json();
    };

    const contact = (await post('/api/contacts', {
        type: 'agent', name: 'Dana Okafor', email: AGENT_EMAIL,
    }, [200, 201])) as { data?: { contact?: { id: string } } };
    const contactId = contact.data?.contact?.id;
    if (!contactId) throw new Error('docs agent fixture: no contact id');

    const templateId = await ensureDocsTemplate(adminPage);
    const inspection = (await post('/api/inspections', {
        // A DISTINCT address from ensureDocsInspection's "1240 Alder Street".
        // Reusing that address made this fixture complete/publish the SAME
        // inspection the staff-lifecycle editor/publish captures photograph,
        // breaking those two pictures (no unrated item, no Publish button).
        propertyAddress: '88 Referral Lane, Springfield',
        clientName: 'Referral Client',
        clientEmail: 'referral.client@example.com',
        templateId,
    }, [200, 201])) as { data?: { inspection?: { id: string } } };
    const inspectionId = inspection.data?.inspection?.id;
    if (!inspectionId) throw new Error('docs agent fixture: no inspection id');

    // This is the association the dashboard reads — must succeed. It alone is
    // enough for the referral row to render; do NOT complete/publish here, so
    // this inspection stays a plain, separate referral and never mutates the
    // shared inspection the editor and publish captures depend on.
    await post(`/api/inspections/${inspectionId}/people`, {
        contactId, roleProfileId: buyerAgent.id,
    }, [200, 201]);
}

test('the sign-up form, with the terms shown in full', async ({ page }) => {
    const shot = shotsFor('agent-account');
    await page.context().clearCookies();
    await page.goto('/agent-signup');
    await expect(page.getByRole('button', { name: /Sign up|Create/i }).first()).toBeVisible();
    await shot(page, 'agent-signup', { fullPage: true });
});

test('the dashboard, grouped by property', async ({ page, browser, baseURL, viewport }) => {
    const shot = shotsFor('agent-portal');

    // Seed the referral FIRST, on a throwaway admin session. This must happen
    // before the agent cookie is handed to `page` below, because the API calls
    // need admin rights. It is idempotent by address (ensureDocsTemplate and
    // the people link tolerate repeats), so a re-run cannot duplicate the row.
    await loginAsSeedUser(page, SEED_EMAILS.admin);
    await seedAgentReferral(page);

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
    // Assert a real referral rendered before photographing. Without this the
    // empty state ("No referrals yet") would pass as a green capture and ship
    // an unusable picture — exactly the gap this fixture closes.
    await expect(page.getByTestId(/^referral-row-/).first()).toBeVisible({ timeout: 30_000 });
    await shot(page, 'agent-dashboard', { fullPage: true });
});
