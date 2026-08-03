/**
 * Wait until the editor's CLIENT handlers are live — not merely until its
 * markup is on screen.
 *
 * The editor route is server-rendered, so `<main>` and the whole item list are
 * visible well before React hydrates. Four specs waited on
 * `getByRole('main')` under a comment claiming that proved hydration; it proves
 * only that the SSR shell arrived. The difference was invisible while
 * `workers: 1` left the machine idle enough that hydration always won the race.
 * At three workers it stopped winning: SpeedMode's `z` went nowhere and collab's
 * click on "Roof" opened no pane — both failing as "element(s) not found", a
 * message that states the consequence and says nothing about the cause.
 *
 * Selecting an item is IDEMPOTENT (choosing the same row twice leaves the same
 * state), so retrying it until the editor pane opens is a gate rather than a
 * sleep: it ends the instant the handler exists, and it cannot paper over a real
 * break, because an editor that is genuinely broken never opens the pane at all.
 */
import { expect, type Page } from '@playwright/test';

/** Editor pane that only mounts once an item has actually been selected. */
const EDITOR_PANE = '#notes-textarea';

/**
 * Resolve when clicking an item really selects it.
 *
 * `itemLabel` must name an item the seeded template provides (the editor-seed
 * template gives every inspection Roof / Plumbing / Electrical).
 */
export async function awaitEditorInteractive(page: Page, itemLabel = 'Roof'): Promise<void> {
    await expect(async () => {
        await page.getByText(itemLabel, { exact: false }).first().click();
        await expect(page.locator(EDITOR_PANE)).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
}

/**
 * The same gate for specs that drive SHORTCUTS, plus a blur.
 *
 * `useKeyboard` ignores every shortcut while focus sits in a field (its
 * `!inField` guard), and the gate above leaves focus in the notes textarea — so
 * without this a spec would press `z` INTO the notes body and then wait for an
 * overlay that was never asked to open.
 */
export async function awaitEditorShortcutsReady(page: Page, itemLabel = 'Roof'): Promise<void> {
    await awaitEditorInteractive(page, itemLabel);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}
