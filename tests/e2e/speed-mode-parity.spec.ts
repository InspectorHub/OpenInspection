/**
 * Data entry parity: a rating entered in Speed mode is the same rating as one entered in the item editor
 * (Plan B Task 9, spec 9.4).
 *
 * In each layout, through that layout's own way into Speed mode (the tools dock on desktop, the "Speed rate"
 * button on tablet and phone):
 *   - rate item A in Speed mode and item B in the item editor, with the same level;
 *   - reload, and read both back from the API: the stored entries have the same shape and the same rating;
 *   - the unrated count is the same before and after the reload and is down by two.
 * A second run does the Speed mode rating with no connection and checks it arrives once the connection is back.
 *
 * One Playwright project per viewport (`speed-mode-parity-390`, `-834`, `-1280`; the viewport is the project's), so
 * each has its own seeded inspection with three unrated items and the runs cannot rate each other's rows.
 */
import { test, expect, type Page } from '@playwright/test';
import {
    awaitCollabSynced,
    expectNoHorizontalScroll,
    layoutForWidth,
    openItem,
    openSeededEditor,
    ratingRadios,
    readStoredResults,
    seededInspectionId,
    showItemList,
    skipSpeedCoach,
    type EditorLayout,
} from './helpers/editor-layout';

const SPEED_DIALOG = 'Speed-rate inspection items';
/** The second level of the rating system: the one every entry below picks. */
const LEVEL_INDEX = 1;

const speedDialog = (page: Page) => page.getByRole('dialog', { name: SPEED_DIALOG });

/** Opens Speed mode through the layout's own entry. */
async function openSpeedMode(page: Page, layout: EditorLayout): Promise<void> {
    await expect(async () => {
        if (layout === 'desktop') {
            await page.getByRole('button', { name: 'Open inspector tools' }).click();
            await page.getByRole('menu', { name: 'Inspector tools' }).getByText('Speed mode').click();
        } else if (layout === 'tablet') {
            await page.getByTestId('tablet-list-pane').getByTestId('speed-entry').click();
        } else {
            // The Items drawer holds the button; a retry must not tap the tab through an already open drawer.
            if ((await page.getByRole('dialog', { name: 'Items' }).count()) === 0) await showItemList(page, layout);
            await page.getByTestId('speed-entry').click();
        }
        await expect(speedDialog(page)).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
}

/** Rates the item on screen in Speed mode: a tile on touch layouts, the number key on desktop. */
async function rateInSpeedMode(page: Page, layout: EditorLayout): Promise<void> {
    if (layout === 'desktop') {
        await page.keyboard.press(String(LEVEL_INDEX + 1));
    } else {
        await page.getByTestId('speedmode-ratings').getByRole('button').nth(LEVEL_INDEX).click();
    }
}

/** How many items are still unrated, read from whatever this layout shows. */
async function unratedCount(page: Page, layout: EditorLayout): Promise<number> {
    if (layout === 'desktop') {
        const text = (await page.getByRole('radiogroup', { name: 'Item filter' }).textContent()) ?? '';
        return Number(/Unrated\s*(\d+)/.exec(text)?.[1] ?? NaN);
    }
    // On a phone the button sits in the Items drawer, which is mounted (closed) all the time: no need to open it to read.
    const entry = page.getByTestId('speed-entry');
    // The entry is left out at zero, which is a count of zero.
    if ((await entry.count()) === 0) return 0;
    const text = (await entry.textContent()) ?? '';
    return Number(/(\d+) unrated/.exec(text)?.[1] ?? NaN);
}

/** The stored entry for an item of the seeded inspection, whatever scope key it sits under. */
async function storedEntry(page: Page, itemId: string): Promise<Record<string, unknown> | undefined> {
    const results = await readStoredResults(page, seededInspectionId());
    const key = Object.keys(results).find((k) => k.endsWith(`:${itemId}`)) ?? (itemId in results ? itemId : undefined);
    return key ? results[key] : undefined;
}

test.describe('speed mode parity', () => {
    test.describe.configure({ mode: 'serial' });
    let layout: EditorLayout = 'desktop';

    test.beforeEach(async ({ page }) => {
        await skipSpeedCoach(page);
        // The project sets the viewport; the layout band follows from its width.
        const width = page.viewportSize()?.width ?? 1280;
        layout = layoutForWidth(width);
        await openSeededEditor(page, width);
    });

    test('Speed mode and the item editor store the same rating, and the counters agree after a reload', async ({ page }) => {
        test.setTimeout(120_000);
        const unratedBefore = await unratedCount(page, layout);
        expect(unratedBefore, 'a fresh seeded inspection has three unrated items').toBe(3);

        // Item A (first in the queue: Roof) rated in Speed mode.
        await openSpeedMode(page, layout);
        await expect(speedDialog(page).getByRole('heading', { level: 2 })).toHaveText('Roof');
        await rateInSpeedMode(page, layout);
        // The tap moved on to the next unrated item, not past it.
        await expect(speedDialog(page).getByRole('heading', { level: 2 })).toHaveText('Plumbing');
        await expectNoHorizontalScroll(page);
        await speedDialog(page).getByRole('button', { name: 'Exit Speed Mode' }).click();
        await expect(speedDialog(page)).toBeHidden();

        // Item B (Plumbing) rated in the item editor, same level.
        await openItem(page, 'Plumbing', layout);
        await ratingRadios(page).nth(LEVEL_INDEX).click();
        await expect(ratingRadios(page).nth(LEVEL_INDEX)).toHaveAttribute('aria-checked', 'true');

        // Both arrive in the store with the same shape.
        await expect
            .poll(async () => {
                const a = await storedEntry(page, 'roof');
                const b = await storedEntry(page, 'plumbing');
                return a?.rating != null && b?.rating != null;
            }, { timeout: 30_000, message: 'both ratings reach the stored results' })
            .toBe(true);
        const a = (await storedEntry(page, 'roof'))!;
        const b = (await storedEntry(page, 'plumbing'))!;
        expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
        expect(a.rating).toBe(b.rating);
        expect(typeof a.rating).toBe(typeof b.rating);

        // The counters are down by two, and a reload shows the same number.
        await expect.poll(() => unratedCount(page, layout)).toBe(unratedBefore - 2);
        await page.reload();
        await expect(page.locator('[data-layout]')).toHaveAttribute('data-layout', layout, { timeout: 30_000 });
        await awaitCollabSynced(page);
        await expect.poll(() => unratedCount(page, layout), { timeout: 30_000 }).toBe(unratedBefore - 2);
        await openItem(page, 'Roof', layout);
        const roofChecked = await ratingRadios(page).nth(LEVEL_INDEX).getAttribute('aria-checked');
        await openItem(page, 'Plumbing', layout);
        const plumbingChecked = await ratingRadios(page).nth(LEVEL_INDEX).getAttribute('aria-checked');
        expect([roofChecked, plumbingChecked]).toEqual(['true', 'true']);
    });

    test('a rating given in Speed mode with no connection arrives once the connection is back, once', async ({ page, context }) => {
        test.setTimeout(120_000);
        // The previous test rated Roof and Plumbing; Electrical is the one left.
        await expect.poll(() => unratedCount(page, layout), { timeout: 30_000 }).toBe(1);
        await context.setOffline(true);
        await openSpeedMode(page, layout);
        await expect(speedDialog(page).getByRole('heading', { level: 2 })).toHaveText('Electrical');
        await rateInSpeedMode(page, layout);
        // Nothing is left to rate: the overlay closes by itself.
        await expect(speedDialog(page)).toBeHidden({ timeout: 10_000 });
        await context.setOffline(false);

        await expect
            .poll(async () => (await storedEntry(page, 'electrical'))?.rating, { timeout: 60_000, message: 'the offline rating is stored after reconnect' })
            .toBeTruthy();
        const roof = (await storedEntry(page, 'roof'))!;
        const electrical = (await storedEntry(page, 'electrical'))!;
        expect(Object.keys(electrical).sort()).toEqual(Object.keys(roof).sort());
        expect(electrical.rating).toBe(roof.rating);
        await expect.poll(() => unratedCount(page, layout), { timeout: 30_000 }).toBe(0);
    });
});
