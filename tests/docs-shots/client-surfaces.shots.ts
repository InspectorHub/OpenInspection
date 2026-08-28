import { test, shotsFor, expect } from './_harness';
import { SEED_CLIENT_ACCESS, SEED_EMAILS, SEED_TENANT_SLUG } from '../seed-fixtures';
import { loginAsSeedUser } from '../e2e/helpers/seed-login';
import {
    ensureDocsAvailability,
    ensureDocsInspection,
    ensureDocsService,
    ensureDocsSignerLink,
    ensureDocsTemplate,
} from './_docs-fixtures';

/**
 * Captures for the three guides written for the HOMEBUYER, published under
 * <https://inspectorhub.io/docs/> as booking-an-inspection, your-client-portal
 * and signing-paying-and-repairs.
 *
 * NO COPY LIVES HERE — every id has its `<!-- shot: … -->` in the prose.
 *
 * EVERY PAGE HERE IS PHOTOGRAPHED SIGNED OUT, and that is the subject rather
 * than a detail of the setup: the client path has no account, so a capture
 * taken from a staff session would show chrome the reader will never see and
 * would quietly document a product they are not using. The portal session these
 * shots do establish is the one a real client gets — exchanged from the
 * per-inspection token in the link they were emailed.
 */

const COMPANY = SEED_TENANT_SLUG;

/**
 * The booking page needs a template, something to sell, and hours — otherwise
 * it renders its closed state, which is a real screen and the wrong one. Laid
 * down from a staff session, then every capture below runs signed out.
 */
test.beforeEach(async ({ page }, testInfo) => {
    // Desktop project only, and not for the reason it looks like. The fixtures
    // below need a STAFF session, and WebKit (which the mobile project uses)
    // refuses the `__Host-` session cookie over http://127.0.0.1 — so the login
    // never completes there and every capture fails on a navigation timeout
    // that says nothing about cookies. The phone-sized picture is taken in this
    // project instead, by resizing the viewport where it is needed.
    test.skip(testInfo.project.name === 'mobile', 'staff fixtures need a Secure cookie');
    await loginAsSeedUser(page, SEED_EMAILS.admin);
    const templateId = await ensureDocsTemplate(page);
    await ensureDocsService(page, templateId);
    await ensureDocsAvailability(page);
});

test('booking: the public page a client is sent to', async ({ page }) => {
    const shot = shotsFor('booking-an-inspection');
    await page.context().clearCookies();
    await page.goto(`/book/${COMPANY}`);
    // A locator only this page has. `getByRole('heading').first()` matched the
    // heading of whatever was still on screen — including, once, a login page
    // left over from the fixture session, which would have been photographed
    // and shipped as "your inspector's booking page".
    await expect(page.getByText('Property', { exact: true }).first()).toBeVisible();
    await shot(page, 'client-booking-page', { fullPage: true });
});

test('booking: what the client sees after submitting', async ({ page }) => {
    const shot = shotsFor('booking-an-inspection');
    await page.context().clearCookies();
    await page.goto(`/book/${COMPANY}`);
    // The confirmation screen is the LAST step of the same four-step wizard, so
    // the walk has to fill the form — there is no URL that renders it directly.
    // The first draft clicked Next once and captured the SERVICES step under
    // this name: a picture of the wrong screen, which a reader cannot detect.
    await page.getByText('Property', { exact: true }).first().waitFor();
    await page.locator('input').first().fill('88 Juniper Lane, Springfield');
    await page.getByRole('button', { name: /Next|Continue/i }).first().click();

    // Services — tick the one the fixture sells, then move on.
    await page.getByText('Full Home Inspection').first().click();
    await page.getByRole('button', { name: /Next|Continue/i }).first().click();

    // Schedule — the step that also collects who the client is. Continue stays
    // disabled until the date AND the name are set; the fields carry no `name`
    // attribute, so they are addressed by their placeholders (which is what a
    // reader sees too).
    await page.locator('input[type=date]').first().fill('2026-06-18');
    await page.getByPlaceholder('Jane Doe').fill('Dana Buyer');
    await page.getByPlaceholder('jane@example.com').fill('dana.buyer@example.com');
    await page.getByRole('button', { name: /Next|Continue/i }).first().click();

    await expect(page.getByText('Confirm details')).toBeVisible();
    await shot(page, 'client-booking-confirmation', { fullPage: true });
});

test('portal: the signed-out door', async ({ page }) => {
    const shot = shotsFor('your-client-portal');
    await page.context().clearCookies();
    await page.goto(`/portal/${COMPANY}`);
    await expect(page.getByRole('textbox').first()).toBeVisible();
    await shot(page, 'client-portal-signin');
});

test('portal: My Inspections, and one inspection', async ({ page }) => {
    const portal = shotsFor('your-client-portal');
    const delivering = shotsFor('delivering-the-report');
    await page.context().clearCookies();

    // The token in the emailed link is exchanged for a portal session on
    // arrival — which is exactly how a client reaches this page, so the capture
    // walks the real entry rather than injecting a cookie.
    await page.goto(
        `/portal/${COMPANY}/i/${SEED_CLIENT_ACCESS.inspectionId}?token=${SEED_CLIENT_ACCESS.token}`,
    );
    await expect(page.getByRole('link', { name: 'Report' }).first()).toBeVisible();
    await delivering(page, 'client-portal-hub', { fullPage: true });

    await page.goto(`/portal/${COMPANY}`);
    await expect(page.getByRole('link', { name: /Inspection|Report/i }).first()).toBeVisible();
    await portal(page, 'client-portal-list');
});

test('repairs: the builder a client works from', async ({ page }) => {
    const shot = shotsFor('signing-paying-and-repairs');
    await page.context().clearCookies();
    await page.goto(SEED_CLIENT_ACCESS.builderPath);
    await expect(page.getByRole('heading', { name: 'Select items to include' })).toBeVisible();
    await shot(page, 'client-repair-builder', { fullPage: true });
});

test('signing: the agreement page a client meets', async ({ page }, testInfo) => {
    const shot = shotsFor('signing-paying-and-repairs');
    const agree = shotsFor('agreements-and-signatures');

    // The signer link is issued by sending a real agreement — each signer holds
    // their own token and the page refuses anything else, so there is no URL to
    // hand-write here.
    const templateId = await ensureDocsTemplate(page);
    await ensureDocsService(page, templateId);
    const inspectionId = await ensureDocsInspection(page, templateId);
    const signPath = await ensureDocsSignerLink(page, inspectionId);

    await page.context().clearCookies();
    await page.goto(signPath);
    await expect(page.getByRole('button', { name: /Sign|Decline/i }).first()).toBeVisible();

    // Two guides want this screen and they want it at different sizes: the
    // staff-facing guide shows the page, the client guide says "on a phone".
    // Capturing both from one viewport would put a desktop screenshot under a
    // caption that promises a phone — so each project takes only its own.
    await agree(page, 'agreement-sign-page', { fullPage: true });

    // The client guide's caption says "on a phone", so the picture has to be
    // one. Same page, phone viewport — the layout a reader meets, without
    // needing the WebKit project the fixtures cannot log into.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('button', { name: /Sign|Decline/i }).first()).toBeVisible();
    await shot(page, 'client-sign-mobile', { fullPage: true });
});
