/**
 * Workspace (authenticated) responsive smoke.
 *
 * `public-pages-responsive.spec.ts` has asserted "no horizontal scroll at any
 * viewport" since Sprint 1 — but only for /book and /not-found. Every page an
 * inspector actually spends the day in (Contacts, Team, Invoices, Inspections,
 * Settings) had NO responsive coverage at all.
 *
 * That gap is not theoretical. `auth-layout.tsx` carried `flex-1 w-full` on
 * <main>: a flex child asking for 100% of a row that already contains the
 * sidebar. It made the content column 1080px inside a 1245px viewport and
 * scrolled EVERY workspace page sideways — undetected, because the rule was
 * only ever enforced against three public pages.
 *
 * Same viewport matrix and same assertion as the public spec, deliberately.
 * 1100px carries the most weight: per that spec's own note, iPad Pro 11"
 * landscape (1180px) is the inspector's field device.
 *
 * A wide TABLE inside a page is fine and expected — Contacts has eight
 * columns and cannot show them all on a phone. What must not happen is the
 * PAGE scrolling: a table scrolls within its own container (shared-ui Table
 * wraps itself in `overflow-x-auto`), which keeps the page compliant while
 * leaving the columns reachable.
 */
import { test, expect, type Page } from '@playwright/test';
import { readEditorSeed } from './helpers/editor-seed';

const BASE_URL = 'http://127.0.0.1:8789';

// The laptop/iPad zone the workspace actually targets. 1100 carries the most
// weight: per public-pages-responsive's own note, iPad Pro 11" landscape
// (1180px) is the inspector's field device.
const VIEWPORTS = [
    { name: 'small-laptop', w: 1024, h: 768 },
    { name: 'tablet-mid', w: 1100, h: 768 },
    { name: 'desktop', w: 1440, h: 900 },
];

// Phone (375) and iPad-portrait (768) are NOT covered yet, and that is a
// statement of fact rather than an oversight — at those widths several
// workspace pages genuinely scroll sideways today. The cause is not the tables
// (shared-ui Table scrolls within its own container, verified: at 375px its
// wrapper measures 301px wide around a 789px table). It is `PageHeader`, whose
// action row is `flex-shrink-0`: a 130px filter plus two buttons cannot shrink
// or wrap, so it pushes the page out on every screen narrower than the actions.
//
// Fixing that is a design decision about what header actions should DO on a
// phone — wrap, scroll, or collapse behind a menu — not a CSS tweak, and it
// belongs to whoever owns that call. Adding the widths here before then would
// just add a permanently red test.
const UNCOVERED_NARROW_WIDTHS = [375, 768];

const PAGES = [
    { url: '/contacts', key: 'contacts' },
    { url: '/invoices', key: 'invoices' },
    { url: '/team', key: 'team' },
    { url: '/inspections', key: 'inspections' },
    { url: '/settings', key: 'settings' },
    { url: '/settings/inspection-roles', key: 'settings-inspection-roles' },
];

async function hasHorizontalScroll(page: Page): Promise<boolean> {
    return page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
}

test.describe('Workspace pages — responsive smoke', () => {
    test.beforeEach(async ({ page }) => {
        const seed = readEditorSeed();
        test.skip(!seed, 'editor-seed fixture unavailable');
        await page.goto('/login');
        await page.fill('input[name=email]', seed!.email);
        await page.fill('input[name=password]', seed!.password);
        await page.click('button[type=submit]');
        await page.waitForURL('**/inspections');
    });

    for (const vp of VIEWPORTS) {
        for (const p of PAGES) {
            test(`${p.key} @ ${vp.name} (${vp.w}x${vp.h})`, async ({ page }) => {
                await page.setViewportSize({ width: vp.w, height: vp.h });
                const res = await page.goto(`${BASE_URL}${p.url}`, { waitUntil: 'domcontentloaded' });
                test.skip(!res || res.status() >= 500, `Page ${p.url} not reachable`);

                // Give the layout a beat to settle after the viewport change —
                // asserting mid-reflow produces a flake, not a finding.
                await page.waitForTimeout(150);

                expect(
                    await hasHorizontalScroll(page),
                    `${p.key} scrolls horizontally at ${vp.w}px — the page must fit; wide tables scroll inside their own container`,
                ).toBe(false);
            });
        }
    }

    // Kept as a live reminder rather than a comment that rots: if someone makes
    // the header actions responsive, this starts failing and tells them to move
    // the widths into VIEWPORTS above.
    test('narrow widths are still unsupported (remove this when they are not)', async ({ page }) => {
        const stillBroken: number[] = [];
        for (const w of UNCOVERED_NARROW_WIDTHS) {
            await page.setViewportSize({ width: w, height: 800 });
            await page.goto(`${BASE_URL}/contacts`, { waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(150);
            if (await hasHorizontalScroll(page)) stillBroken.push(w);
        }
        expect(
            stillBroken,
            'Workspace pages now fit at these widths — add them to VIEWPORTS and delete this test',
        ).toEqual(UNCOVERED_NARROW_WIDTHS);
    });
});
