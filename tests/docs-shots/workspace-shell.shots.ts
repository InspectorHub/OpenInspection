import { test, shotsFor, expect } from './_harness';
import { loginAsSeedUser } from '../e2e/helpers/seed-login';
import { SEED_EMAILS } from '../seed-fixtures';

/**
 * Captures for the guide that introduces the workspace frame itself.
 *
 * NO COPY LIVES HERE — every id has its `<!-- shot: … -->` in the prose, which
 * lives with the hosted docs.
 *
 * WHY THIS GUIDE EXISTS, AND WHY IT CHANGES THE OTHER FILES. Every other guide
 * used to have to be photographed wide enough to keep the left-hand navigation
 * in frame, because its prose said things like "in the left-hand nav" and the
 * reader had been shown that nav nowhere else. One page now owns that
 * explanation, so the rest are free to photograph the panel they are actually
 * about. That is what let the capture viewport come down to a width where the
 * app's own text is legible in a 672px column.
 *
 * DESKTOP ONLY, INCLUDING THE NARROW PICTURE. `shell-narrow` is taken by
 * resizing the page rather than by running in the `mobile` project, and that is
 * a deliberate retreat: this file was the FIRST test this suite had ever run in
 * that project, and it failed at the login step. The shared helper clicks the
 * submit button, the click landed before hydration, and the login form has no
 * server action — so nothing happened at all and the page simply sat at /login
 * while `waitForURL` timed out. That is a real gap in the mobile project, and
 * it is not this guide's to fix.
 *
 * A resize gives the same answer for what this picture is of. The subject is a
 * LAYOUT — which breakpoint the shell is on — and that is decided by width, not
 * by touch emulation or a phone user-agent.
 */
const SHELL = shotsFor('finding-your-way-around');

// NO per-guide reset. `_global-setup.ts` clears `.docs-shots/` once per run,
// which is all this needs — and a `beforeEach` reset actively breaks a guide
// with more than one picture. It did: the desktop project still ENTERS the
// mobile-only test below before `test.skip` fires, so the reset ran again and
// deleted the two shots the previous test had just written. The run reported
// green with an empty directory. `_settings-shots.ts` records the same trap
// from the other direction.

/**
 * Photographed as the ADMIN.
 *
 * The navigation is capability-filtered — Dispatch appears only for someone who
 * may schedule other people — and the guide's own section on that says so. An
 * inspector's sidebar would illustrate the exception rather than the rule, and
 * the reader has no way to tell from a picture which one they are looking at.
 */
async function signIn(page: import('@playwright/test').Page): Promise<void> {
    await loginAsSeedUser(page, SEED_EMAILS.admin);
    await page.goto('/inspections');
}

/**
 * Wider than the project default of 960, and this is the one guide entitled to
 * be.
 *
 * The sidebar is `hidden lg:flex` and Tailwind's `lg` is 1024px, so at the
 * default width there is no sidebar to photograph — the pictures below would
 * show the narrow shell twice and the guide would illustrate none of what it
 * describes. 1040 is 1024 plus room for Chromium's classic scrollbar, so the
 * LAID-OUT width stays at or above the breakpoint on a page tall enough to
 * scroll.
 *
 * Scoped to this block rather than the file: a file-level `test.use` would also
 * override the `mobile` project's own viewport, and `shell-narrow` below is
 * precisely a picture of the narrow shell. Every other guide stays at 960
 * because this page exists to explain the navigation once.
 */
test.describe('the wide shell', () => {
    test.use({ viewport: { width: 1040, height: 900 } });

    test('expanded and collapsed', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'the sidebar does not exist below lg');
    await signIn(page);

    const sidebar = page.locator('aside.ih-sidebar');
    await expect(sidebar).toBeVisible();
    // The shell renders before the nav's capability filter has an answer, and a
    // sidebar photographed in that moment is missing entries for a reason the
    // picture cannot show. Team is the last item in the Workspace group, so its
    // arrival means the whole group has one.
    await expect(page.getByRole('link', { name: /^Team$/ })).toBeVisible();
    await SHELL(page, 'shell-expanded');

    // The collapse handle is `opacity-0` until the sidebar is hovered or the
    // button is focused, which is exactly what the guide tells the reader. A
    // click alone would work, but hovering first is what a person does and it
    // keeps the handle visible in anything captured afterwards.
    await sidebar.hover();
    const collapse = page.getByRole('button', { name: /Collapse sidebar/i });
    await collapse.click();

    // The SEARCH BUTTON is the signal, not a nav label. Collapsing hides the
    // labels but keeps `title={item.label()}` on each link
    // (app/components/sidebar/SidebarNavItem.tsx), so the accessible name of
    // "Inspections" is unchanged and an assertion on it passes in both states.
    // The search button is rendered only while expanded and has no such
    // fallback. A width or class assertion would pass mid-transition.
    const search = page.getByRole('button', { name: /Open command palette/i });
    await expect(search).toBeHidden();
    await SHELL(page, 'shell-collapsed');

    // Leave the workspace as it was found. The collapsed state is written to a
    // cookie, so a capture run that ended here would hand every later guide a
    // sidebar with no labels in it.
    await sidebar.hover();
    await page.getByRole('button', { name: /Expand sidebar/i }).click();
    await expect(search).toBeVisible();
    });
});

test('the navigation drawer on a narrow window', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'taken by resizing in the desktop project');
    await signIn(page);

    // Resize AFTER signing in, not before: the login is the step the mobile
    // project fell over on, and it is the one part of this walk that has
    // nothing to do with the picture.
    await page.setViewportSize({ width: 390, height: 844 });

    // The menu button is the readiness check AND the proof of the layout: it
    // exists only below `lg`, and it is what the picture is about. An assertion
    // on the sidebar being hidden would also pass at the project's own 960,
    // where the resize has not happened yet.
    const menu = page.getByRole('button', { name: /Open menu/i });
    await expect(menu).toBeVisible();
    await menu.click();
    // The drawer carries the same entries as the sidebar, filtered by the same
    // capabilities — waiting for one of them is what proves the drawer is open
    // AND populated, which an animation-complete wait would not.
    await expect(page.getByRole('link', { name: /^Inspections$/ })).toBeVisible();
    await SHELL(page, 'shell-narrow');
});
