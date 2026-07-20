/**
 * Google Places address autocomplete + property auto-fill (#198 / #200).
 *
 * Verifies the real-browser wiring and graceful degradation. The local/CI worker
 * has no GOOGLE_PLACES_API_KEY / GOOGLE_MAPS_JS_API_KEY / ESTATED_API_KEY, so the
 * feature runs its self-hoster default path: the address field is a usable
 * free-text combobox (no suggestion dropdown, no map), and the editor's "Fetch
 * property details" button surfaces a clear "not configured" notice. The
 * happy-path lookup logic is covered by the co-located unit tests
 * (resources/places, AddressAutocomplete, PropertyInfoForm, inspection-create).
 *
 * Uses the shared editor-seed admin + its editable inspection.
 */
import { test, expect } from '@playwright/test';
import { readEditorSeed } from './helpers/editor-seed';

let email = '';
let password = '';
let inspectionId = '';

test.describe.serial('Address autocomplete + property auto-fill (#198/#200)', () => {
  test.beforeAll(() => {
    const seed = readEditorSeed();
    test.skip(!seed, 'editor-seed handoff missing — run with the editor-seed setup project.');
    email = seed!.email;
    password = seed!.password;
    inspectionId = seed!.inspectionId;
  });

  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name=email]', email);
    await page.fill('input[name=password]', password);
    await page.click('button[type=submit]');
    await page.waitForURL('**/inspections');
  });

  test('wizard renders the address autocomplete combobox and accepts free text (no Places key -> no dropdown)', async ({ page }) => {
    await page.goto('/inspections/new');

    const address = page.locator('#property-address');
    await expect(address).toBeVisible();
    await expect(address).toHaveAttribute('role', 'combobox');

    await address.fill('123 Free Form Ranch Rd, Nowhere');
    await expect(address).toHaveValue('123 Free Form Ranch Rd, Nowhere');

    // Without a Places key the BFF returns no suggestions, so no listbox opens.
    await expect(page.getByRole('listbox')).toHaveCount(0);
  });

  test('editor "Fetch property details" degrades to a not-configured notice (no Estated key)', async ({ page }) => {
    await page.goto(`/inspections/${inspectionId}/edit`);

    // Switch the editor to the Property Info view.
    await page.getByTestId('inspection-details-entry').click();
    await expect(page.getByTestId('property-info-form')).toBeVisible();

    const btn = page.getByRole('button', { name: /fetch property details/i });
    await expect(btn).toBeVisible();
    await expect(btn).toBeEnabled();
    await btn.click();

    await expect(page.getByText(/isn.t configured/i)).toBeVisible();
  });
});
