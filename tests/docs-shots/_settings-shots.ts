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

/**
 * ⚠️ THE LONG PAGES HERE STILL SHIP AS ONE STRIP, and cannot stop until the
 * prose moves too.
 *
 * `/settings/communication` and `/settings/workspace` are several thousand CSS
 * px tall, so one `fullPage: true` picture is displayed at ~0.65x in a 672px
 * column and read by nobody. The mechanism to fix that exists — `shot.sections`
 * in `_harness.ts`, element-scoped, and those two pages already carry the stable
 * containers it needs (`#email-delivery`, `#sms-delivery`, `#email-templates`,
 * `#google-calendar`, guarded by settings-communication-nav.spec.ts).
 *
 * What blocks it is the join, not the capture: the publisher matches `<id>.png`
 * to `<!-- shot: <id> -->` by exact set equality, so turning `settings-
 * communication` into four pictures means the guide in
 * `apps/portal/docs/user-guide/` loses that marker and gains four. Emitting the
 * extra PNGs first would fail the docs build with "capture with no marker",
 * which is the check working. Convert a page here and its prose in the same
 * change, never one without the other.
 */
export async function captureSettings(page: Page, entry: SettingsShot): Promise<void> {
    const shot = shotsFor(entry.guide);
    await page.goto(entry.path);
    // Assert, don't sleep: a settings page whose fetch failed still renders its
    // crumb and its heading, so waiting on "the URL changed" photographs the
    // empty state and calls it documentation.
    //
    // SCOPED TO `main`, and that is not tidiness. Unscoped, `/Team/i` matched
    // the SIDEBAR's own "Team" link, which is present on every page — so the
    // wait was satisfied by the navigation rather than by the page, and would
    // have passed on a screen that never loaded. It only surfaced when the
    // capture viewport came down to 960: the sidebar is `hidden lg:flex`, the
    // first match became a display:none node, and the wait failed on a page
    // that had in fact rendered. A readiness check answered by the chrome
    // around the page is not a readiness check.
    const content = page.getByRole('main');
    await expect(content.getByText(entry.ready).first()).toBeVisible({ timeout: 20_000 });
    await shot(page, entry.id, { fullPage: true });
}
