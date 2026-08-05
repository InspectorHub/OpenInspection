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
    // 768 was promoted out of UNCOVERED_NARROW_WIDTHS once the Table wrapper
    // stopped leaking its `sr-only` label into the document's scroll width —
    // measured, all six pages fit here now.
    { name: 'ipad-portrait', w: 768, h: 1024 },
    { name: 'small-laptop', w: 1024, h: 768 },
    { name: 'tablet-mid', w: 1100, h: 768 },
    { name: 'desktop', w: 1440, h: 900 },
];

// Phone (375) is NOT covered yet, and that is a statement of fact rather than
// an oversight — at that width several workspace pages genuinely scroll
// sideways today. (768 WAS in this list; see the note at the end.) The cause is not the tables
// (shared-ui Table scrolls within its own container, verified: at 375px its
// wrapper measures 301px wide around a 789px table). It is `PageHeader`, whose
// action row is `flex-shrink-0`: a 130px filter plus two buttons cannot shrink
// or wrap, so it pushes the page out on every screen narrower than the actions.
//
// Fixing that is a design decision about what header actions should DO on a
// phone — wrap, scroll, or collapse behind a menu — not a CSS tweak, and it
// belongs to whoever owns that call. Adding the widths here before then would
// just add a permanently red test.
//
// That diagnosis was INCOMPLETE, and the ratchet below is what said so. A
// second, unrelated cause was hiding behind it: shared-ui's Table wrapper had
// `overflow-x-auto` without `relative`, so the `sr-only` label on the actions
// column — `position: absolute` — resolved against the initial containing
// block and kept contributing to the DOCUMENT's scroll width. The table was
// clipped correctly the whole time; a 1px screen-reader label was pushing the
// page out. With that fixed, contacts@768 fits, which is precisely the
// improvement this ratchet exists to notice. 768 has been promoted into
// VIEWPORTS above on measured evidence: with the ratchet widened to check all
// six pages, none of them scrolls at that width any more. 375 still does, and
// there the original PageHeader diagnosis stands.
const UNCOVERED_NARROW_WIDTHS = [375];

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

/**
 * Which elements actually stick out, ignoring ones an ancestor already clips.
 *
 * A bare "the page scrolls sideways" failure sends the next person hunting
 * with devtools; naming the element turns a 20-minute bisect into a glance.
 * Elements inside a scroll container are skipped on purpose — a wide table in
 * an `overflow-x-auto` wrapper still reports a bounding box past the viewport
 * but costs the PAGE nothing, and reporting it would be a false lead.
 */
async function overflowCulprits(page: Page): Promise<string[]> {
    return page.evaluate(() => {
        const limit = document.documentElement.clientWidth;
        const clipped = (el: Element) => {
            for (let n = el.parentElement; n; n = n.parentElement) {
                const ox = getComputedStyle(n).overflowX;
                if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') return true;
            }
            return false;
        };
        const out: string[] = [];
        for (const el of document.querySelectorAll('body *')) {
            const r = el.getBoundingClientRect();
            if (r.width > 0 && r.right > limit + 1) {
                out.push(
                    `${clipped(el) ? '[clipped] ' : '[LOOSE]   '}` +
                    `<${el.tagName.toLowerCase()} class="${String((el as HTMLElement).className).slice(0, 60)}"> ` +
                    `right=${Math.round(r.right)} w=${Math.round(r.width)}`,
                );
            }
        }
        // LOOSE entries first — those are the ones actually costing the page
        // width. Clipped ones are listed too, because "everything is clipped"
        // is itself a diagnosis (it means an ancestor is over-wide, not the
        // element).
        return out.sort((a, b) => (a.startsWith('[LOOSE') ? -1 : 1) - (b.startsWith('[LOOSE') ? -1 : 1)).slice(0, 8);
    });
}

/**
 * ⚠️ OPEN, UNDIAGNOSED — `contacts @ ipad-portrait` fails deterministically when
 * this project runs on its own (`--workers=1`), and passes in the full suite at
 * `workers: 3`. Verified 2026-08-05 across eight runs.
 *
 * The failure is always the FIRST test in the matrix, never any of the other 49
 * that issue the identical `beforeEach` navigation: `page.goto('/login')` never
 * completes, the test timeout expires, and Playwright tears the page down —
 * reported as `net::ERR_ABORTED; maybe frame was detached`, which looks like a
 * navigation bug and is really the teardown.
 *
 * Ruled out by experiment, each with its own run — none of these is the cause:
 *   - slowness / cold start: a 90s budget times out the same way
 *   - `waitUntil: 'load'` hanging on a subresource: `domcontentloaded` identical
 *   - the worker not being up: /status answers before the hook runs
 *   - retrying the goto: the test timeout kills the hook, so the catch is dead
 *   - warming the API in beforeAll (`request.get`), and warming the browser in
 *     beforeAll with a separate page — neither changes the outcome
 *
 * It is a harness fault, not a product one: the page it cannot reach is served
 * to the 49 navigations that follow it. NOT quarantined with `fixme`, because
 * skipping it only promotes the next test into the same position — which would
 * hide the fault rather than remove it.
 */
test.describe('Workspace pages — responsive smoke', () => {
    // Seed enough contacts to force a VERTICAL scrollbar. That matters: a
    // vertical scrollbar takes ~15px off clientWidth, and a layout with no
    // margin to spare tips into horizontal overflow the moment it appears.
    // Without this the spec passes in isolation and fails in the full suite —
    // which is not flake, it is the suite happening to have more data. Seeding
    // our own makes the result depend on this file alone.
    test.beforeAll(async ({ request }) => {
        const seed = readEditorSeed();
        if (!seed) return;
        const login = await request.post(`${BASE_URL}/api/auth/login`, {
            data: { email: seed.email, password: seed.password },
        });
        const token = (login.headers()['set-cookie'] ?? '').match(/__Host-inspector_token=([^;]+)/)?.[1] ?? '';
        if (!token) return;
        const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
        // Long, unbreakable names and emails on purpose. Other suites seed
        // rows like `rae.listing.1785234284269@example.com`, and it was those —
        // not the row COUNT — that pushed the page out. A fixture with tidy
        // short strings would let the regression back in.
        for (let i = 0; i < 25; i++) {
            await request.post(`${BASE_URL}/api/contacts`, {
                data: {
                    type: 'client',
                    name: `Responsive LongNameFixture ${1785234284269 + i}`,
                    email: `responsive.longfixture.${1785234284269 + i}@example.com`,
                },
                headers: auth,
            });
        }

        // Readiness, asked rather than waited out: /status is a plain JSON
        // handler with no SSR and no assets, so a 200 means the worker is
        // serving. Poll it instead of sleeping a fixed interval — a fixed wait
        // is either too short on a cold machine or wasted on a warm one.
        const deadline = Date.now() + 60_000;
        for (;;) {
            const res = await request.get(`${BASE_URL}/status`).catch(() => null);
            if (res?.ok()) break;
            if (Date.now() > deadline) throw new Error('worker never became ready at /status');
        }

    });

    test.beforeEach(async ({ page }) => {
        const seed = readEditorSeed();
        test.skip(!seed, 'editor-seed fixture unavailable');
        // `domcontentloaded` to match every navigation in the test bodies below,
        // which all pass it explicitly. This hook used the default `load`, which
        // was inconsistent — though it is NOT the cause of the open failure
        // recorded above the describe.
        await page.goto('/login', { waitUntil: 'domcontentloaded' });
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

                const scrolls = await hasHorizontalScroll(page);
                const culprits = scrolls ? await overflowCulprits(page) : [];
                const delta = await page.evaluate(() => {
                    const de = document.documentElement;
                    return { over: de.scrollWidth - de.clientWidth, sw: de.scrollWidth, cw: de.clientWidth };
                });
                expect(
                    scrolls,
                    `${p.key} scrolls horizontally at ${vp.w}px by ${delta.over}px ` +
                    `(scrollWidth ${delta.sw} vs clientWidth ${delta.cw}).\n` +
                    `Sticking out:\n  ${culprits.join('\n  ') || '(nothing unclipped — a vertical scrollbar is tipping a zero-margin layout)'}`,
                ).toBe(false);
            });
        }
    }

    // Kept as a live reminder rather than a comment that rots: if someone makes
    // the header actions responsive, this starts failing and tells them to move
    // the widths into VIEWPORTS above.
    test('narrow widths are still unsupported (remove this when they are not)', async ({ page }) => {
        // Measures EVERY page, because that is what promoting a width into
        // VIEWPORTS would enforce. It used to check /contacts alone, so a fix
        // that helped only that page read as "768 is supported now" and would
        // have licensed six pages on the evidence of one.
        const stillBroken: number[] = [];
        for (const w of UNCOVERED_NARROW_WIDTHS) {
            let anyBroken = false;
            for (const p of PAGES) {
                await page.setViewportSize({ width: w, height: 800 });
                const res = await page.goto(`${BASE_URL}${p.url}`, { waitUntil: 'domcontentloaded' });
                if (!res || res.status() >= 500) continue;
                await page.waitForTimeout(150);
                if (await hasHorizontalScroll(page)) { anyBroken = true; break; }
            }
            if (anyBroken) stillBroken.push(w);
        }
        expect(
            stillBroken,
            'Workspace pages now fit at these widths — add them to VIEWPORTS and delete this test',
        ).toEqual(UNCOVERED_NARROW_WIDTHS);
    });
});
