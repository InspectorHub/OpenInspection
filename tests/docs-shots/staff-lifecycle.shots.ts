import { test, shotsFor, panelAround, expect } from './_harness';

// Desktop only. The mobile project exists for the guides that document a phone
// flow; running these there would overwrite every capture with a narrow one
// under the same id, and the prose that describes a three-pane editor would be
// illustrated by a single column.
import { loginAsSeedUser } from '../e2e/helpers/seed-login';
import { SEED_EMAILS } from '../seed-fixtures';
import { ensureDocsInspection, ensureDocsService, ensureDocsTemplate } from './_docs-fixtures';

// Desktop only. The mobile project exists for the guides that document a phone
// flow; running these there would overwrite every capture with a narrow one
// under the same id — the prose that describes a three-pane editor would be
// illustrated by a single column.
test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'desktop captures');
});


/**
 * Captures for the staff half of the workflow: the inspection page, the editor,
 * the publish check, the invoice, and what gets sent.
 *
 * NO COPY LIVES HERE — every id has its `<!-- shot: … -->` in the prose.
 *
 * ONE TEST PER PICTURE (or per pair that shares a screen), deliberately. An
 * earlier draft walked the whole lifecycle in a single test, and a selector
 * that broke halfway through cost every picture after it — including ones on
 * screens the breakage had nothing to do with. Playwright reports and continues
 * per test, so this arrangement loses exactly the picture that broke.
 *
 * The setup is shared and idempotent: a template, a service that references it,
 * and one inspection created from it. Guides 2/4/5 are all about a job that has
 * a report to work on, which the shared seed deliberately does not provide.
 */

const HUB = shotsFor('managing-an-inspection');
const EDITOR = shotsFor('writing-an-inspection-report');
const PUBLISH = shotsFor('publishing-a-report');
const INVOICE = shotsFor('invoicing-and-payments');
const DELIVER = shotsFor('delivering-the-report');
const AGREE = shotsFor('agreements-and-signatures');

async function setup(page: import('@playwright/test').Page): Promise<string> {
    await loginAsSeedUser(page, SEED_EMAILS.admin);
    const templateId = await ensureDocsTemplate(page);
    await ensureDocsService(page, templateId);
    return ensureDocsInspection(page, templateId);
}

test('the inspection page: overview, people, files, communication', async ({ page }) => {
    const id = await setup(page);
    await page.goto(`/inspections/${id}`);
    await expect(page.getByRole('link', { name: /Open editor/i }).first()).toBeVisible();
    await HUB(page, 'hub-overview');

    // The remaining three are regions of the SAME page, and each is photographed
    // as ITS OWN PANEL rather than as the viewport that happens to contain it.
    //
    // The previous version scrolled the heading into view and shot the window.
    // That was already better than a full-page strip, but the frame was decided
    // by scroll position: `scrollIntoViewIfNeeded` does nothing when the element
    // is already visible, so a panel could arrive anywhere in the picture, with
    // however many neighbours happened to be beside it — and near the foot of
    // the page it could not be centred at all. Every id below is unchanged, so
    // this changes the pictures and not the join with the prose.
    //
    // Located by ROLE, not by text: the old `getByText(/People/i)` matched any
    // element whose text merely contained the word, which on this page includes
    // the nav. Each panel's title is a real `<h2>` (BlockHeading), and the
    // strings come from messages/en (`inspections_hub_block_people`,
    // `comm_block_title`, `documents_heading`).
    await HUB.sections(page, [
        { id: 'hub-people', element: panelAround(page.getByRole('heading', { name: /^People$/i })) },
        { id: 'hub-communication', element: panelAround(page.getByRole('heading', { name: /^Communication$/i })) },
        { id: 'hub-documents', element: panelAround(page.getByRole('heading', { name: /^Documents$/i })) },
    ]);
});

/**
 * Wider than the project default of 960, and the app decides that, not taste.
 *
 * The editor shell is `min-w-[1024px]` (app/routes/inspection-edit.tsx), so at
 * the default width the three-pane picture is taken mid-horizontal-scroll and
 * the guide's own subject is cut off. 1040 is that minimum plus room for
 * Chromium's classic scrollbar.
 *
 * Scoped to this one test: every other picture in this file is a panel that
 * reads better at 960.
 */
test.describe('the editor', () => {
    test.use({ viewport: { width: 1040, height: 900 } });

    test('the editor: three panes, and an item being rated', async ({ page }) => {
        const id = await setup(page);
        await page.goto(`/inspections/${id}/edit`);
        // The section list is the editor's leftmost pane and only exists once the
        // template snapshot has loaded — "the URL changed" would photograph a shell.
        await expect(page.getByText('Exterior').first()).toBeVisible({ timeout: 30_000 });
        await EDITOR(page, 'editor-three-panes');

        await page.getByText('Roof covering').first().click();
        await expect(page.getByText(/Satisfactory/i).first()).toBeVisible();
        await page.getByText(/Satisfactory/i).first().click();
        await EDITOR(page, 'editor-rating-an-item');
    });
});

test('the publish check', async ({ page }) => {
    const id = await setup(page);
    await page.goto(`/inspections/${id}`);
    const publish = page.getByRole('button', { name: /Publish/i }).first();
    await expect(publish).toBeVisible();
    await publish.click();
    // The dialog is the picture; it lists what is blocking, or says the report
    // is ready. Both are the real screen for this guide.
    await expect(page.getByRole('dialog')).toBeVisible();
    await PUBLISH(page, 'publish-readiness');

    // Then actually publish. The delivery captures below need a report that has
    // shipped — "Send report" does not exist before that — and publishing here
    // keeps the walk in the order the guides describe rather than reaching into
    // the database to fake the state.
    const confirm = page.getByRole('dialog').getByRole('button', { name: /^Publish report$/i });
    if (await confirm.count()) await confirm.click();
    await expect(page.getByRole('dialog')).toBeHidden({ timeout: 30_000 });
});

test('raising an invoice, and marking it paid', async ({ page }) => {
    const id = await setup(page);
    await page.goto(`/inspections/${id}`);

    const request = page.getByRole('button', { name: /Request payment|Create invoice|Invoice/i }).first();
    await expect(request).toBeVisible();
    await request.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await INVOICE(page, 'invoice-create');

    await page.keyboard.press('Escape');
    await page.goto('/invoices');
    const paid = page.getByRole('button', { name: /Mark paid|Record payment/i }).first();
    if (await paid.count()) {
        await paid.click();
        await expect(page.getByRole('dialog')).toBeVisible();
    }
    await INVOICE(page, 'invoice-mark-paid');
});

test('sending the agreement', async ({ page }) => {
    const id = await setup(page);
    await page.goto(`/inspections/${id}`);
    const send = page.getByRole('button', { name: /Send agreement/i }).first();
    await expect(send).toBeVisible();
    await send.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await AGREE(page, 'agreement-send');
});

test('sending the report, and the delivery record', async ({ page }) => {
    const id = await setup(page);
    await page.goto(`/inspections/${id}`);

    const send = page.getByRole('button', { name: /Send report/i }).first();
    await expect(send).toBeVisible();
    await send.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await DELIVER(page, 'send-report');

    await page.keyboard.press('Escape');
    // The delivery record lives in the Communication panel, so photograph the
    // panel — same reasoning as the hub regions above, same unchanged id.
    await DELIVER.sections(page, [
        {
            id: 'delivery-record',
            element: panelAround(page.getByRole('heading', { name: /^Communication$/i })),
        },
    ]);
});
