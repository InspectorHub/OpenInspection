/**
 * The client's repair-request builder, reached the way a client reaches it: a
 * delivered report plus a per-recipient portal token in the URL.
 *
 * RUN MODE: `npm run test:e2e:seeded` (or
 * `npx playwright test -c playwright.seeded.config.ts --project=repair-builder-client-link`).
 * It needs the multi-user seed, which globalSetup only writes when SEED_E2E=1 —
 * and specifically the delivered-client-link fixture (`SEED_CLIENT_ACCESS`).
 *
 * WHY THIS SPEC EXISTS. Everything below the loader was covered by unit tests
 * that stub the fetcher, so the one thing nobody had ever run was the whole
 * chain: token → gate → published content → the row's controls → form parse →
 * service → column → and back out of the loader on the next request. The page
 * could not even be opened in a browser locally, because the seed supplied
 * none of the three things `runBuilderGate` + `resolveBuilderAccess` require.
 *
 * WHAT EACH TEST IS FOR, since three of them look like UI checks and are not:
 *   1. the list renders  — proves the gate passes AND the report has content
 *   2. the #275 control  — proves the credit field is gated on `fund` alone
 *   3. reload           — the only assertion that touches the WRITE path
 *   4. no token         — proves 1-3 are not passing for some other reason
 *
 * Test 2 and test 3 each drive a DIFFERENT defect, on purpose: the tests share
 * one seeded database, and selecting a row persists it, so a shared row would
 * make the second test's starting state depend on the first one having run.
 * Every locator is scoped by the row's own aria-label for the same reason —
 * a page-wide count would see rows left selected by an earlier test.
 */
import { test, expect, type Page } from '@playwright/test';
import { SEED_CLIENT_ACCESS, SEED_REPAIR_DEFECTS } from '../seed-fixtures';

/** The item each test owns. Both are items with exactly ONE seeded defect. */
const CONTROL_ITEM = 'Receptacles and Switches';
const PERSIST_ITEM = 'Gutters and Downspouts';

/** `Requested action for {label}` — RepairDefectRow's aria-label for the Select. */
const actionSelect = (page: Page, itemLabel: string) =>
    page.getByLabel(`Requested action for ${itemLabel}`);

/** `Credit request for {label}` — MoneyInput's aria-label. Absent unless `fund`. */
const creditInput = (page: Page, itemLabel: string) =>
    page.getByLabel(`Credit request for ${itemLabel}`);

/** The row header button, addressed by the defect title it renders. */
const rowFor = (page: Page, defectTitle: string) =>
    page.getByRole('button', { name: new RegExp(defectTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) });

/**
 * The response to the builder route's next action POST whose body contains
 * `needle` (an intent, or a field value). Await the WRITE, never a timer: the
 * row's local draft updates on the click whether or not the request ever leaves,
 * so a sleep here would let the spec pass on nothing but optimistic UI.
 *
 * Register it BEFORE the interaction that triggers it.
 */
const builderPost = (page: Page, needle: string) =>
    page.waitForResponse(
        (res) =>
            res.request().method() === 'POST'
            && res.url().includes('/repair-builder/')
            && (res.request().postData() ?? '').includes(needle),
    );

const defectFor = (itemLabel: string) => {
    const found = SEED_REPAIR_DEFECTS.find((d) => d.itemLabel === itemLabel);
    if (!found) throw new Error(`seed fixture has no defect on item "${itemLabel}"`);
    return found;
};

test.describe('Repair builder — the client link', () => {

    test('the seeded client token renders the published defect list', async ({ page }) => {
        await page.goto(SEED_CLIENT_ACCESS.builderPath);

        await expect(page.getByRole('heading', { name: 'Select items to include' })).toBeVisible();
        // The empty-state copy is the failure this test is really guarding: a
        // passing gate with no report content renders the page and no rows.
        await expect(page.getByText('No repair-rated defects found in this report.')).toHaveCount(0);

        // Every seeded defect, by its own title — and they span more than one
        // section, which is what makes the page worth looking at.
        for (const defect of SEED_REPAIR_DEFECTS) {
            await expect(rowFor(page, defect.defectTitle)).toBeVisible();
        }
        const sections = [...new Set(SEED_REPAIR_DEFECTS.map((d) => d.sectionTitle))];
        expect(sections.length).toBeGreaterThan(1);
        for (const section of sections) {
            await expect(page.getByText(section, { exact: false }).first()).toBeVisible();
        }
    });

    test('#275 — the credit amount appears for `fund` and for no other action', async ({ page }) => {
        await page.goto(SEED_CLIENT_ACCESS.builderPath);

        const item = CONTROL_ITEM;
        await rowFor(page, defectFor(item).defectTitle).click();

        // Selecting expands the row: the action control appears, the amount does
        // not. "Having no preference" is the initial state, not a blank.
        const action = actionSelect(page, item);
        await expect(action).toBeVisible();
        await expect(action).toHaveValue('');
        await expect(creditInput(page, item)).toHaveCount(0);

        // A repair request is not a money request.
        await action.selectOption('repair');
        await expect(creditInput(page, item)).toHaveCount(0);

        await action.selectOption('fund');
        await expect(creditInput(page, item)).toBeVisible();

        // ...and it goes away again when the buyer changes their mind.
        await action.selectOption('replace');
        await expect(creditInput(page, item)).toHaveCount(0);
    });

    test('the chosen action survives a reload', async ({ page }) => {
        const item = PERSIST_ITEM;

        // STEP 1 — put the item on the list, and wait for the server to say so.
        await page.goto(SEED_CLIENT_ACCESS.builderPath);
        const itemAdded = builderPost(page, 'add-item');
        await rowFor(page, defectFor(item).defectTitle).click();
        const added = await itemAdded;
        expect(added.ok(), await added.text()).toBe(true);

        // STEP 2 — choose the action on a page with NOTHING in flight.
        //
        // ⚠️ The reload is not tidiness, it is a workaround for a defect this
        // spec found: choosing an action while the add-item round-trip is still
        // open loses the choice. `useRepairOpQueue.drainQueue` resolves an
        // update-item's server item id at drain time and SKIPS the op when the
        // id is not known yet — which is exactly the state during the add — so
        // the op is discarded, not retried. The row keeps showing the chosen
        // action and no error appears, while the column stays NULL. It reproduced
        // when the worker was under load from the sibling projects and not when
        // this project ran alone, which is why a spec written the obvious way is
        // green on a quiet machine. Reported, not fixed (#275 walk-through).
        await page.reload();
        const action = actionSelect(page, item);
        await expect(action).toBeVisible();
        await expect(action).toHaveValue('');

        const tagWritten = builderPost(page, 'fund');
        await action.selectOption('fund');
        const written = await tagWritten;
        expect(written.ok(), await written.text()).toBe(true);

        // STEP 3 — the read-back. Reload rebuilds selection + drafts from the
        // loader's `mine[].items`, so all three of these are readings of the
        // stored row: the item is still on the list, its tag came back, and
        // `fund` still shows the amount field.
        await page.reload();
        const reloaded = actionSelect(page, item);
        await expect(reloaded).toBeVisible();
        await expect(reloaded).toHaveValue('fund');
        await expect(creditInput(page, item)).toBeVisible();
    });

    test('the same URL without a token renders no list at all', async ({ page }) => {
        await page.goto(SEED_CLIENT_ACCESS.builderPath.split('?')[0]);

        // 401 → the loader's `no_access` branch → the public notice, not the page.
        await expect(page.getByRole('heading', { name: 'Access required' })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Select items to include' })).toHaveCount(0);
        for (const defect of SEED_REPAIR_DEFECTS) {
            await expect(page.getByText(defect.defectTitle)).toHaveCount(0);
        }
    });
});
