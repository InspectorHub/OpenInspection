/**
 * The field editor at phone, tablet and desktop widths (Plan B Task 9).
 *
 * What it pins, per viewport:
 *   (a) the page never scrolls sideways;
 *   (b) the tree matches the band: 375 and 414 one column (phone), 768 and 834 the item list and the editor side by
 *       side (tablet), 1024, 1100 and 1440 the desktop layout;
 *   (c) the working path: rate an item, write notes, add a photo from the library, tap its thumbnail, the viewer
 *       opens, annotate it and save;
 *   (d) offline: pick a photo with no connection, go back online, and the thumbnail goes from pending to stored.
 *
 * Needs the `editor-seed` handoff (see helpers/editor-seed.ts); this project has its own inspection, so the
 * writes here cannot disturb another spec. The tests inside a viewport run in order for the same reason.
 */
import { test, expect } from '@playwright/test';
import {
    expectNoHorizontalScroll,
    layoutForWidth,
    openItem,
    openSeededEditor,
    ratingRadios,
    awaitCollabSynced,
    readStoredResults,
    seededInspectionId,
    type EditorLayout,
} from './helpers/editor-layout';
import { validPngFile } from './helpers/valid-png';

// Not tests/assets/test-logo.png: its PNG chunks fail their CRC, the browser cannot decode it and the annotator
// then has no canvas to draw on.
const PHOTO = validPngFile();

interface Viewport {
    name: string;
    width: number;
    height: number;
}

const VIEWPORTS: Viewport[] = [
    { name: '375x812', width: 375, height: 812 },
    { name: '414x896', width: 414, height: 896 },
    { name: '768x1024', width: 768, height: 1024 },
    { name: '834x1194', width: 834, height: 1194 },
    { name: '1024x768', width: 1024, height: 768 },
];
/** Two more widths, only for (b): the desktop layout must still be the desktop layout. */
const DESKTOP_WIDTHS: Viewport[] = [
    { name: '1100x800', width: 1100, height: 800 },
    { name: '1440x900', width: 1440, height: 900 },
];

for (const vp of [...VIEWPORTS, ...DESKTOP_WIDTHS]) {
    const expected: EditorLayout = layoutForWidth(vp.width);

    test.describe(`editor at ${vp.name} (${expected})`, () => {
        test.describe.configure({ mode: 'serial' });
        test.use({ viewport: { width: vp.width, height: vp.height } });

        test.beforeEach(async ({ page }) => {
            await openSeededEditor(page, vp.width);
        });

        test('(a) no horizontal scroll, before and after an item is open', async ({ page }) => {
            await expectNoHorizontalScroll(page);
            await openItem(page, 'Roof', expected);
            await expectNoHorizontalScroll(page);
        });

        test('(b) the tree matches the band', async ({ page }) => {
            await expect(page.locator('[data-layout]')).toHaveCount(1);
            await expect(page.locator('[data-layout]')).toHaveAttribute('data-layout', expected);
            await openItem(page, 'Roof', expected);
            const list = page.getByTestId('tablet-list-pane');
            const editor = page.getByTestId('tablet-editor-pane');
            const bottomTabs = page.getByRole('button', { name: /Items$/ });
            if (expected === 'tablet') {
                // The list and the editor are on screen at the same time, side by side.
                await expect(list).toBeVisible();
                await expect(editor.locator('#notes-textarea')).toBeVisible();
                const a = await list.boundingBox();
                const b = await editor.boundingBox();
                expect(a && b && a.x + a.width <= b.x + 1, 'list pane sits left of the editor pane').toBe(true);
                await expect(bottomTabs).toHaveCount(0);
            } else if (expected === 'phone') {
                // One column: no pane, the bottom tabs are the navigation.
                await expect(list).toHaveCount(0);
                await expect(bottomTabs).toBeVisible();
                await expect(page.locator('#notes-textarea')).toBeVisible();
            } else {
                await expect(list).toHaveCount(0);
                await expect(bottomTabs).toHaveCount(0);
                await expect(page.getByText('Roof', { exact: false }).first()).toBeVisible();
                await expect(page.locator('#notes-textarea')).toBeVisible();
            }
        });
    });
}

/**
 * The rating the previous viewport stored on the shared Roof item. All five viewports edit the same item (one
 * seeded inspection per project), so a viewport that picked the level already stored, or wrote the note already
 * there, would pass without changing anything. Each viewport therefore picks its own level and writes its own note,
 * and reads the change back from the API. The tests run in file order in one worker, which is what makes this
 * chain meaningful; it is not read when it is unset (a retry in a fresh worker).
 */
let previousStoredRating: string | null = null;

for (const [viewportIndex, vp] of VIEWPORTS.entries()) {
    const expected: EditorLayout = layoutForWidth(vp.width);

    test.describe(`working path at ${vp.name} (${expected})`, () => {
        test.describe.configure({ mode: 'serial' });
        test.use({ viewport: { width: vp.width, height: vp.height } });

        test.beforeEach(async ({ page }) => {
            await openSeededEditor(page, vp.width);
        });

        test('(c) rate, write notes, add a photo from the library, open it, annotate and save', async ({ page }) => {
            test.setTimeout(90_000);
            await openItem(page, 'Roof', expected);

            // Rate: this viewport's own level of the rating system (the one before it chose another).
            const radios = ratingRadios(page);
            await expect(radios.first()).toBeVisible();
            const levels = await radios.count();
            expect(levels, 'the rating system has at least two levels').toBeGreaterThanOrEqual(2);
            const level = viewportIndex % levels;
            await radios.nth(level).click();
            await expect(radios.nth(level)).toHaveAttribute('aria-checked', 'true');

            // Notes: typed into the field and committed by leaving it. The text is unique to this viewport.
            const notes = page.locator('#notes-textarea');
            const text = `Responsive path ${vp.name}`;
            await notes.fill(text);
            await notes.blur();
            await expect(notes).toHaveValue(text);

            // Read it back from what the server stored, not from what the field echoes: the finding that carries
            // this viewport's note must exist, carry a rating, and not be the level the previous viewport stored.
            let storedRating: string | null = null;
            await expect
                .poll(async () => {
                    const results = await readStoredResults(page, seededInspectionId());
                    const entry = Object.values(results).find((r) => r.notes === text);
                    storedRating = typeof entry?.rating === 'string' ? entry.rating : null;
                    return storedRating;
                }, { timeout: 30_000, message: `the stored results hold "${text}" with a rating` })
                .not.toBeNull();
            if (previousStoredRating !== null) expect(storedRating, 'this viewport stored a different level than the last').not.toBe(previousStoredRating);
            previousStoredRating = storedRating;

            // And a reload shows the same thing (the editor reads it back from the server too).
            await page.reload();
            await expect(page.locator('[data-layout]')).toHaveAttribute('data-layout', expected, { timeout: 30_000 });
            await awaitCollabSynced(page);
            await openItem(page, 'Roof', expected);
            await expect(page.locator('#notes-textarea')).toHaveValue(text);
            await expect(ratingRadios(page).nth(level)).toHaveAttribute('aria-checked', 'true');

            // Photo from the library, through the Add media chooser (the hidden input takes the file).
            const before = await page.locator('[data-testid^="thumb-"]').count();
            await page.getByTestId('photo-add').click();
            const chooser = page.waitForEvent('filechooser');
            await page.getByRole('button', { name: 'Add from library' }).click();
            await (await chooser).setFiles(PHOTO);
            const thumb = page.getByTestId(`thumb-${before}`);
            await expect(thumb).toBeVisible({ timeout: 20_000 });

            // Tap the thumbnail: the viewer opens with its toolbar.
            await thumb.click();
            const annotate = page.getByRole('button', { name: 'Annotate' });
            await expect(annotate).toBeVisible();
            // Every toolbar target is a real touch target on a narrow screen.
            if (vp.width <= 480) {
                for (const name of ['Annotate', 'Rotate', 'Set cover', 'Caption', 'Delete']) {
                    const box = await page.locator('.yarl__toolbar').getByRole('button', { name, exact: true }).first().boundingBox();
                    expect(box, `${name} is on screen`).not.toBeNull();
                    expect(box!.height, `${name} height`).toBeGreaterThanOrEqual(43.5);
                    expect(box!.width, `${name} width`).toBeGreaterThanOrEqual(43.5);
                }
            }
            await expectNoHorizontalScroll(page);

            // Annotate: draw one shape on the canvas, then save. The annotator closes on save.
            await annotate.click();
            // The annotator is the last overlay in the DOM, so its Save is the last one.
            const save = page.getByRole('button', { name: 'Save', exact: true }).last();
            await expect(save).toBeVisible();
            // react-konva draws into a canvas inside `.konvajs-content`; it exists once the photo has loaded.
            const canvas = page.locator('.konvajs-content canvas').first();
            await expect(canvas).toBeVisible({ timeout: 20_000 });
            const box = await canvas.boundingBox();
            expect(box, 'the annotation canvas has a size').not.toBeNull();
            await page.mouse.move(box!.x + box!.width * 0.3, box!.y + box!.height * 0.3);
            await page.mouse.down();
            await page.mouse.move(box!.x + box!.width * 0.6, box!.y + box!.height * 0.6, { steps: 6 });
            await page.mouse.up();
            await save.click();
            // Saved: the annotator closes (its own close button goes with it).
            await expect(page.getByRole('button', { name: 'Close photo studio' })).toBeHidden({ timeout: 20_000 });
            await expect(page.getByTestId(`thumb-${before}`)).toBeVisible();
        });

        test('(d) offline: a photo picked with no connection is pending, and is stored once the connection is back', async ({ page, context }) => {
            test.setTimeout(120_000);
            await openItem(page, 'Plumbing', expected);
            await expect(page.locator('#notes-textarea')).toBeVisible();

            const before = await page.locator('[data-testid^="thumb-"]').count();
            await context.setOffline(true);
            await page.getByTestId('photo-add').click();
            const chooser = page.waitForEvent('filechooser');
            await page.getByRole('button', { name: 'Add from library' }).click();
            await (await chooser).setFiles(PHOTO);

            // Pending: the thumbnail exists and says it is uploading.
            const index = before;
            await expect(page.getByTestId(`thumb-${index}`)).toBeVisible({ timeout: 20_000 });
            await expect(page.getByTestId(`pending-badge-${index}`)).toBeVisible();

            // Back online: the queue drains and the badge goes, the thumbnail stays.
            await context.setOffline(false);
            await expect(page.getByTestId(`pending-badge-${index}`)).toHaveCount(0, { timeout: 60_000 });
            await expect(page.getByTestId(`thumb-${index}`)).toBeVisible();
            await expectNoHorizontalScroll(page);
        });
    });
}
