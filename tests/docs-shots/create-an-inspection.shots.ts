import { test, shotsFor, resetGuide } from './_harness';
import { loginAsSeedUser } from '../e2e/helpers/seed-login';
import { SEED_EMAILS, SEED_TENANT_SLUG } from '../seed-fixtures';

/**
 * Captures for the "Creating an inspection" guide, published at
 * <https://inspectorhub.io/docs/create-an-inspection>.
 *
 * NO COPY LIVES HERE. Every id below has a matching
 * `<!-- shot: <id> | … -->` in that guide's markdown, which lives with the
 * hosted docs rather than in this repository, and the docs build there fails if
 * the two sets differ in either direction.
 *
 * Self-sufficient by contract: it seeds nothing of its own beyond the shared
 * `SEED_E2E` fixtures, logs in itself, and never depends on another guide
 * having run. Running one guide alone has to work, or nobody will.
 */

const GUIDE = 'create-an-inspection';
const shot = shotsFor(GUIDE);

/**
 * Identities come from the fixtures module, never retyped.
 *
 * `SEED_EMAILS.admin` sees services and pricing, so the wizard is photographed
 * as an owner or manager actually sees it — an inspector's view of the Services
 * step is a different picture, and picking the account is a documentation
 * decision rather than an incidental one.
 *
 * A literal `'seed-a'` here would keep working right up until the fixtures
 * renamed the tenant, at which point the booking capture would 404 and the only
 * clue would be a screenshot of an error page.
 */
const ADMIN = SEED_EMAILS.admin;
const COMPANY_SLUG = SEED_TENANT_SLUG;

test.beforeAll(() => {
    // Drop last run's PNGs so a renamed or deleted step cannot leave one behind
    // and be reported as a capture nobody asked for.
    resetGuide(GUIDE);
});

test('the staff path: list, then the four wizard steps', async ({ page }) => {
    await loginAsSeedUser(page, ADMIN);

    await page.waitForURL('**/inspections');
    await shot(page, 'inspections-list');

    await page.getByRole('link', { name: 'New Inspection' }).first().click();
    await page.waitForURL('**/inspections/new');
    await shot(page, 'wizard-property');

    await page.getByRole('button', { name: 'Next' }).click();
    await shot(page, 'wizard-people');

    await page.getByRole('button', { name: 'Next' }).click();
    await shot(page, 'wizard-services');

    await page.getByRole('button', { name: 'Next' }).click();
    await shot(page, 'wizard-confirm');
});

test('the client path: the public booking page', async ({ page }) => {
    // Signed out on purpose — this is the page a client reaches from a link,
    // and photographing it from a staff session would show chrome they never
    // see.
    await page.context().clearCookies();
    await page.goto(`/book/${COMPANY_SLUG}`);
    await shot(page, 'public-booking', { fullPage: true });
});
