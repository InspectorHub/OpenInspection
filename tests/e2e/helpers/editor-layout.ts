/**
 * Shared steps for the specs that drive the editor at a given viewport (phone, tablet, desktop).
 *
 * Each editor tree marks its root with `data-layout`. The SERVER always renders the desktop tree (the layout hook
 * has a fixed server snapshot), so on a phone or tablet the attribute reads `desktop` until hydration and then
 * moves to the real layout. A spec therefore waits for the attribute with a retrying assertion before it clicks
 * anything: a click before that lands on a tree that is about to be replaced.
 */
import { expect, test, type Page } from '@playwright/test';
import { readEditorSeed } from './editor-seed';
import { apiGet } from './seed-login';

export type EditorLayout = 'phone' | 'tablet' | 'desktop';

/** The layout band for a viewport width: phone under 768, tablet 768-1023, desktop from 1024. */
export function layoutForWidth(width: number): EditorLayout {
    if (width < 768) return 'phone';
    if (width < 1024) return 'tablet';
    return 'desktop';
}

/** Logs in as the seed admin and opens THIS project's seeded inspection in the editor. */
export async function openSeededEditor(page: Page, width: number): Promise<EditorLayout> {
    // Read at runtime: the editor-seed dependency writes the handoff during the run.
    const seed = readEditorSeed();
    test.skip(!seed, 'editor-seed handoff missing — run with the editor-seed setup project.');
    await page.goto('/login');
    await page.fill('input[name=email]', seed!.email);
    await page.fill('input[name=password]', seed!.password);
    await page.click('button[type=submit]');
    await page.waitForURL('**/inspections');
    await page.goto(`/inspections/${seed!.inspectionId}/edit`);
    const layout = layoutForWidth(width);
    await expect(page.locator('[data-layout]')).toHaveAttribute('data-layout', layout, { timeout: 30_000 });
    await awaitCollabSynced(page);
    return layout;
}

/**
 * Waits until the results document has synced with the server (the tree root says so in `data-collab-synced`).
 *
 * Before that first sync the client document is nearly empty and its edits are not yet merged with the server's
 * copy: a rating or note made in that window can be lost when the server's copy of the same finding arrives, and
 * going offline in it leaves a half-open socket that does not reconnect. A spec that edits must start after it.
 */
export async function awaitCollabSynced(page: Page): Promise<void> {
    await expect(page.locator('[data-layout]')).toHaveAttribute('data-collab-synced', 'true', { timeout: 30_000 });
}

/** The id of the inspection this project edits. */
export function seededInspectionId(): string {
    const seed = readEditorSeed();
    if (!seed) throw new Error('editor-seed handoff missing');
    return seed.inspectionId;
}

/** True when the page scrolls sideways: the one thing a responsive layout must never do. */
export async function horizontalOverflow(page: Page): Promise<{ scrollWidth: number; clientWidth: number }> {
    return page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
    }));
}

export async function expectNoHorizontalScroll(page: Page): Promise<void> {
    await expect
        .poll(async () => {
            const { scrollWidth, clientWidth } = await horizontalOverflow(page);
            return scrollWidth <= clientWidth;
        }, { message: 'document.documentElement.scrollWidth must not exceed clientWidth' })
        .toBe(true);
}

/** Opens the Items drawer on a phone (the list lives in a bottom sheet there); a no-op elsewhere. */
export async function showItemList(page: Page, layout: EditorLayout): Promise<void> {
    if (layout !== 'phone') return;
    await page.getByRole('button', { name: /Items$/ }).click();
}

/**
 * Opens an item by its label and waits until the editor pane is live (the notes field exists). Retried as a whole:
 * selecting an item is idempotent, so retrying is a gate on hydration and not a sleep.
 */
export async function openItem(page: Page, label: string, layout: EditorLayout): Promise<void> {
    await expect(async () => {
        await showItemList(page, layout);
        const scope = layout === 'tablet' ? page.getByTestId('tablet-list-pane') : page;
        await scope.getByText(label, { exact: false }).first().click();
        await expect(page.locator('#notes-textarea')).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
}

/** The rating radios of the open item, in the rating system's order. */
export function ratingRadios(page: Page) {
    return page.getByRole('radiogroup', { name: 'Rating' }).getByRole('radio');
}

/** Marks the one-time Speed mode coach as seen, so its overlay does not cover the rating tiles. */
export async function skipSpeedCoach(page: Page): Promise<void> {
    await page.addInitScript(() => {
        try {
            localStorage.setItem('oi:speedmode-coached', '1');
        } catch {
            /* private mode: the coach shows, the spec taps through it */
        }
    });
}

/** Finding entries of the seeded inspection as the API stores them, keyed `unit:section:item`. */
export async function readStoredResults(page: Page, inspectionId: string): Promise<Record<string, Record<string, unknown>>> {
    const res = await apiGet(page, `/api/inspections/${inspectionId}/results`);
    expect(res.ok(), 'GET /api/inspections/:id/results').toBe(true);
    const body = (await res.json()) as { data?: { results?: Record<string, Record<string, unknown>> } };
    return body.data?.results ?? {};
}
