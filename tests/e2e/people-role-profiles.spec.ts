/**
 * People / Role Profiles E2E (Plan 1B Task 8).
 *
 * Covers steps 1-4 of the plan brief. Step 5 ("`/settings/automations`
 * recipient dropdown lists the new custom role") is OUT OF SCOPE on this
 * branch: it depends on Plan 1B Task 6 (recipient picker -> role profiles),
 * which was deferred to Spec 2 because the backing `recipient_kind` /
 * `recipient_role_profile_id` columns don't exist yet. The automations
 * recipient dropdown is still the fixed client/buying_agent/selling_agent/
 * inspector/all list.
 *
 *   1. Admin login -> /contacts -> the admin-only "Roles" tab is visible.
 *   2. Create a custom `kind=other` role profile "Buyer's Attorney" -> it
 *      appears in the Roles list.
 *   3. Open an inspection detail -> People section -> "Add person" ->
 *      search/select an existing contact -> assign "Buyer's Attorney" -> the
 *      row appears grouped under "Other".
 *   4. Attempt to add a SECOND person under the "Client" role -> blocked with
 *      the primary-client 409 conflict message surfaced in the modal. (The
 *      editor-seed fixture inspection already carries its creation-time
 *      client — "Editor Seed Client" — as the primary `client`-kind person,
 *      confirmed by the DOM at /inspections/:id before this step runs; so
 *      adding any OTHER contact under "Client" is already the second one.)
 *
 * Fixtures: depends on the `editor-seed` Playwright project (see
 * playwright.config.ts) for the shared admin (admin@autotest.com) and a real
 * inspection id (editor-seed's own POST /api/inspections call already seeds
 * that inspection's primary client into inspection_people). The `api`
 * project's POST /api/auth/setup separately seeds the 8 default role
 * profiles (server/lib/people/default-role-profiles.ts) via
 * seedStarterContent -> seedRoleProfiles. `beforeAll` creates two contacts via
 * the API (search fixtures for the Other-role add and the blocked Client-role
 * add below); the modal's "create new contact inline" path is deliberately
 * NOT exercised here — see the code comment above `SEARCH_*` for why.
 *
 * Run: npm run test:e2e -- people-role-profiles
 */
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readEditorSeed } from './helpers/editor-seed';
import { makeCsrfToken } from './helpers/csrf';

const BASE_URL = process.env.FRONTEND_URL || 'http://127.0.0.1:8789';
const ROLE_LABEL = "Buyer's Attorney";

// Contacts seeded via the API in beforeAll for the two "Add person" search
// flows below (Other-role add, blocked Client-role add).
const SEARCH_CONTACT_OTHER = { name: 'Priya OtherSearchFixture', email: 'priya.other.e2e@example.com' };
const SEARCH_CONTACT_CLIENT = { name: 'Marcus ClientSearchFixture', email: 'marcus.client1.e2e@example.com' };

let inspectionId = '';
let adminEmail = '';
let adminPassword = '';

async function selectContactInAddPersonModal(page: Page, searchTerm: string, roleLabel: string) {
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const searchInput = dialog.getByPlaceholder(/Search contacts/);
  await searchInput.fill(searchTerm);
  const option = dialog.getByRole('button', { name: new RegExp(searchTerm) });
  await expect(option.first()).toBeVisible({ timeout: 10000 });
  await option.first().click();
  await dialog.getByLabel('Role').selectOption({ label: roleLabel });
}

test.describe.serial('People / Role Profiles (Plan 1B)', () => {
  test.beforeAll(async ({ request }) => {
    const seed = readEditorSeed();
    test.skip(!seed, 'editor-seed handoff missing — run with the editor-seed setup project.');
    inspectionId = seed!.inspectionId;
    adminEmail = seed!.email;
    adminPassword = seed!.password;

    // Log in via the API (mirrors editor-seed.setup.ts) so beforeAll can seed
    // the two search-fixture contacts ahead of the browser flows below.
    const csrf = makeCsrfToken();
    const login = await request.post(`${BASE_URL}/api/auth/login`, {
      data: { email: adminEmail, password: adminPassword },
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrf,
        Cookie: `__Host-csrf_token=${csrf}`,
      },
    });
    expect(login.status(), 'admin login must succeed (editor-seed depends on api)').toBe(200);
    const token = (login.headers()['set-cookie'] ?? '').match(/__Host-inspector_token=([^;]+)/)?.[1] ?? '';
    expect(token, 'login must return an auth cookie').toBeTruthy();
    const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

    for (const fixture of [SEARCH_CONTACT_OTHER, SEARCH_CONTACT_CLIENT]) {
      const res = await request.post(`${BASE_URL}/api/contacts`, {
        data: { type: 'client', name: fixture.name, email: fixture.email },
        headers: auth,
      });
      expect(res.status(), `contact fixture "${fixture.name}" must be created`).toBe(201);
    }
  });

  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name=email]', adminEmail);
    await page.fill('input[name=password]', adminPassword);
    await page.click('button[type=submit]');
    await page.waitForURL('**/inspections');
  });

  test('Step 1-2: admin-only Roles tab; create a custom "other" role profile', async ({ page }) => {
    await page.goto('/contacts');

    const rolesTab = page.getByRole('button', { name: 'Roles', exact: true });
    await expect(rolesTab).toBeVisible();
    await rolesTab.click();

    await page.getByRole('button', { name: 'Add Role', exact: true }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.locator('input[name="label"]').fill(ROLE_LABEL);
    await dialog.locator('select[name="kind"]').selectOption('other');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();

    // The modal auto-closes ~200ms after a successful save; the RolesTable
    // revalidates via the shared fetcher/loader and lists the new profile.
    await expect(dialog).toBeHidden({ timeout: 10000 });
    await expect(page.getByRole('row', { name: new RegExp(ROLE_LABEL) })).toBeVisible({ timeout: 10000 });
  });

  test('Step 3: Add person via search -> "Buyer\'s Attorney" -> groups under Other', async ({ page }) => {
    await page.goto(`/inspections/${inspectionId}`);
    await expect(page.getByRole('heading', { name: 'People', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Add person', exact: true }).click();
    await selectContactInAddPersonModal(page, SEARCH_CONTACT_OTHER.name, ROLE_LABEL);
    await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click();

    await expect(page.getByRole('dialog')).toBeHidden({ timeout: 10000 });
    // data-testid (PeopleEditor's group heading) — plain text "Other" also
    // matches an unrelated <option> in the page's document-category select.
    await expect(page.getByTestId('people-group-other')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('people-group-other')).toHaveText('Other');
    await expect(page.getByText(SEARCH_CONTACT_OTHER.name)).toBeVisible();
  });

  test('Step 4: a second Client-role add is blocked by the primary-client conflict', async ({ page }) => {
    await page.goto(`/inspections/${inspectionId}`);
    await expect(page.getByRole('heading', { name: 'People', exact: true })).toBeVisible();

    // The editor-seed inspection was created with a client name/email, which
    // the inspection-create path already resolves into a primary `client`-kind
    // inspection_people row — "Editor Seed Client" is already listed as
    // Primary before this test ever opens the modal.
    await expect(page.getByTestId('people-group-client')).toBeVisible();
    await expect(page.getByText('Editor Seed Client')).toBeVisible();
    await expect(page.getByText('Primary', { exact: true })).toBeVisible();

    // Adding ANOTHER contact under "Client" is therefore already the SECOND
    // primary-client add — the server's single-primary-client guard
    // (PeopleService.addPerson) 409s; the modal surfaces the message and
    // stays open (no silent success).
    await page.getByRole('button', { name: 'Add person', exact: true }).click();
    await selectContactInAddPersonModal(page, SEARCH_CONTACT_CLIENT.name, 'Client');
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Add', exact: true }).click();

    await expect(
      dialog.getByText('An inspection already has a primary client; use co_client for a second buyer.'),
    ).toBeVisible({ timeout: 10000 });
    // Blocked, not silently accepted: the modal is still open (its own
    // "selected contact" chip is plain text, not a link) and the rejected
    // contact never joins the people list — PeopleEditor only renders an
    // ADDED person's name as a link to /contacts/:id.
    await expect(dialog).toBeVisible();
    await expect(page.getByRole('link', { name: SEARCH_CONTACT_CLIENT.name })).toHaveCount(0);
  });
});
