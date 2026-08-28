import { test, shotsFor, expect } from './_harness';

// Desktop only. The mobile project exists for the guides that document a phone
// flow; running these there would overwrite every capture with a narrow one
// under the same id, and the prose that describes a three-pane editor would be
// illustrated by a single column.
import { loginAsSeedUser } from '../e2e/helpers/seed-login';
import { SEED_EMAILS, SEED_TENANT_SLUG } from '../seed-fixtures';
import { ensureDocsTemplate, ensureDocsService, ensureDocsAvailability } from './_docs-fixtures';

// Desktop only. The mobile project exists for the guides that document a phone
// flow; running these there would overwrite every capture with a narrow one
// under the same id — the prose that describes a three-pane editor would be
// illustrated by a single column.
test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'desktop captures');
});


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
 *
 * ⚠️ IT HAS TO FILL THE FORM, not just click Next. The wizard's step gate
 * refuses to advance off Property without an address of at least five
 * characters AND a template, and off Services without a service ticked — so a
 * script that only clicked would photograph the same first step four times, or
 * (as the first version of this file did) time out on a control it never
 * unblocked. What is typed here is fixture data on a fixture tenant; the
 * pictures are of the wizard, so the address only has to be plausible.
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

test('the staff path: list, then the wizard steps', async ({ page }) => {
    await loginAsSeedUser(page, ADMIN);
    // The shared seed creates no templates on purpose, and the wizard cannot
    // leave its first step without one — see _docs-fixtures.ts.
    const templateId = await ensureDocsTemplate(page);
    // Without a service catalogue the wizard is three steps and there is no
    // Services screen to photograph — see _docs-fixtures.ts.
    await ensureDocsService(page, templateId);
    // The public booking page renders "Online booking isn't open yet" until an
    // inspector has hours — and the closed page is NOT what guide 1 documents.
    await ensureDocsAvailability(page);

    await page.waitForURL('**/inspections');
    await shot(page, 'inspections-list');

    // A Button, not a link: the page-level action navigates programmatically.
    // The first version of this file looked for a link and timed out.
    await page.getByRole('button', { name: 'New Inspection' }).first().click();
    await page.waitForURL('**/inspections/new');
    await shot(page, 'wizard-property');

    // Unblock the step gate, then photograph the NEXT step — the picture of
    // Property above is deliberately taken empty, which is what a reader sees
    // when they arrive.
    await page.locator('#property-address').fill('1240 Alder Street, Springfield');
    // BY ID, not by role: the address field's Places autocomplete is also a
    // `role="combobox"` and it comes first in the DOM, so `.first()` focused a
    // control that has no options and waited for one until the timeout.
    await page.locator('#newinsp-template').click();
    await page.getByRole('option').first().click();

    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByRole('button', { name: 'Next' })).toBeVisible();
    await shot(page, 'wizard-people');

    await page.getByRole('button', { name: 'Next' }).click();
    await shot(page, 'wizard-services');

    // Services refuses to advance with nothing ticked. The row is a BUTTON
    // carrying its own tick glyph, not an <input type=checkbox>, so
    // `getByRole('checkbox')` matched nothing and the gate stayed shut with
    // Playwright waiting on a permanently disabled Next.
    await page.getByRole('button', { name: 'Full Home Inspection' }).first().click();

    await page.getByRole('button', { name: 'Next' }).click();
    await shot(page, 'wizard-confirm');
});

test('the client path: the public booking page', async ({ page }) => {
    // Runs after the staff test in file order, which is what puts the
    // availability fixture in place — `bookingOpen` is derived from it.
    // Signed out on purpose — this is the page a client reaches from a link,
    // and photographing it from a staff session would show chrome they never
    // see.
    await page.context().clearCookies();
    await page.goto(`/book/${COMPANY_SLUG}`);
    await shot(page, 'public-booking', { fullPage: true });
});
