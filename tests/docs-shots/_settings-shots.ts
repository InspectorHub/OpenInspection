/**
 * Shared walk for the one-screenshot settings guides.
 *
 * Eleven configuration pages each want ONE picture of themselves, and writing
 * eleven near-identical files would mean eleven logins and eleven copies of the
 * same wait. The guide→directory ownership the harness describes is preserved:
 * `shotsFor(guide)` is still called per guide and `resetGuide(guide)` still
 * clears that guide's own directory, so a capture still lands under the slug
 * whose prose asked for it.
 *
 * What is NOT shared is the decision of WHICH element to wait for. A settings
 * page that renders its shell before its data would otherwise be photographed
 * empty, and "the page is at this URL" is not the same claim as "the page has
 * something on it" — so each entry names a locator that only exists once the
 * page's own content has arrived.
 */
import { expect, type Page } from '@playwright/test';
import { shotsFor, resetGuide } from './_harness';

export interface SettingsShot {
    /** The guide slug — also the capture directory. */
    guide: string;
    /** The marker id in that guide's prose. */
    id: string;
    path: string;
    /** Text that appears only once this page's own content has loaded. */
    ready: RegExp;
}

/**
 * Clear each guide's directory ONCE, before anything is captured.
 *
 * Not inside `captureSettings`: a guide with two pictures (connected-apps has
 * two) would have its first capture deleted by the reset at the start of its
 * second, and the loss is invisible — the run passes and the validator later
 * reports a marker whose capture "was never taken".
 */
export function resetSettingsGuides(entries: readonly SettingsShot[]): void {
    for (const guide of new Set(entries.map((e) => e.guide))) resetGuide(guide);
}

export async function captureSettings(page: Page, entry: SettingsShot): Promise<void> {
    const shot = shotsFor(entry.guide);
    await page.goto(entry.path);
    // Assert, don't sleep: a settings page whose fetch failed still renders its
    // crumb and its heading, so waiting on "the URL changed" photographs the
    // empty state and calls it documentation.
    await expect(page.getByText(entry.ready).first()).toBeVisible({ timeout: 20_000 });
    await shot(page, entry.id, { fullPage: true });
}
