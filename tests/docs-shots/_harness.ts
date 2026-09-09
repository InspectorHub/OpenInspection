import { test as base, type Locator, type Page } from '@playwright/test';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

/**
 * Shared machinery for the user-guide captures.
 *
 * A `*.shots.ts` file contains ACTIONS AND NOTHING ELSE. Every word a reader
 * sees lives in the guide's markdown, joined to these captures by a marker:
 *
 *   <!-- shot: pick-template | The template picker with Residential selected -->
 *
 * THE PROSE IS NOT IN THIS REPOSITORY. It is published from the hosted docs
 * site (<https://inspectorhub.io/docs>), and so is the code that matches the two
 * id-for-id; a disagreement in either direction fails the docs build there. This
 * side is deliberately one-way: it writes `<SHOT_ROOT>/<slug>/<id>.png` and
 * knows nothing about markers, so it stays useful to anyone driving this app
 * with Playwright.
 *
 * Keeping copy out of this file is what makes that check meaningful: if captions
 * lived beside the clicks, the prose would be reviewed as code and read by
 * nobody.
 */

/** Where captures land. Gitignored — the published copies live in the CMS. */
export const SHOT_ROOT = '.docs-shots';

/**
 * Every capture is stamped with this instant.
 *
 * A screenshot is a promise that the page looks like this. "3 minutes ago" and
 * a date that moves every run break that promise in the least visible way
 * possible — the picture stays plausible while ceasing to be reproducible. Any
 * date in a capture is THIS date, so a reader comparing two guides sees one
 * timeline. Chosen mid-morning on a weekday so scheduling screens do not show a
 * weekend or an out-of-hours slot.
 */
export const FROZEN_TIME = new Date('2026-06-11T10:30:00.000Z');

/**
 * Regions that change on their own and must be covered.
 *
 * Deliberately keyed on an OPT-IN attribute rather than on a list of selectors
 * copied out of the app: a selector list here rots silently the first time a
 * component is renamed, and a mask that stops matching does not fail — it just
 * stops covering, and the next capture quietly carries a live timestamp.
 *
 * Per-shot masks are the normal way to cover something. Reach for this
 * attribute only when a region is volatile everywhere it appears.
 */
function standingMasks(page: Page): Locator[] {
    return [page.locator('[data-shot-mask]')];
}

export interface ShotOptions {
    /** Extra regions to cover for this capture only. */
    mask?: Locator[];
    /** Capture the whole scrollable page rather than the viewport. */
    fullPage?: boolean;
    /**
     * Photograph ONE ELEMENT instead of the window.
     *
     * Playwright scrolls the element into view and captures all of it, even the
     * part below the fold, so this is not "a viewport shot that happens to be
     * pointed at something" — a 1200px-tall card comes back whole.
     *
     * Takes precedence over `fullPage`, which has no meaning once the frame is
     * the element's own box.
     */
    element?: Locator;
}

/** One picture in a multi-picture capture. See `shot.sections`. */
export interface ShotSection {
    /**
     * This part's OWN marker id.
     *
     * ⚠️ There is no such thing as "part 2 of shot X". The publisher joins
     * `<id>.png` to `<!-- shot: <id> | … -->` by exact set equality
     * (apps/portal/scripts/lib/docs-shots.mjs), so splitting one picture into
     * three means the prose gains three markers and loses one. That is a change
     * in BOTH repositories or it is a failed docs build — a capture the prose
     * does not ask for is reported as "capture with no marker".
     */
    id: string;
    /** The container to photograph. Must be a stable element, not a text node. */
    element: Locator;
    /** Extra regions to cover for this part only. */
    mask?: Locator[];
}

export interface GuideShot {
    (page: Page, id: string, options?: ShotOptions): Promise<void>;
    sections(page: Page, sections: readonly ShotSection[]): Promise<void>;
}

/**
 * Bind a capture function to one guide.
 *
 *   const shot = shotsFor('create-an-inspection');
 *   await shot(page, 'open-inspections', { mask: [page.getByTestId('clock')] });
 *
 * The id is the join key with the prose. It must be url-safe kebab-case; the
 * validator rejects anything else rather than guessing.
 */
export function shotsFor(guideSlug: string): GuideShot {
    const shot = async (page: Page, id: string, options: ShotOptions = {}): Promise<void> => {
        const dir = path.join(SHOT_ROOT, guideSlug);
        mkdirSync(dir, { recursive: true });
        const common = {
            path: path.join(dir, `${id}.png`),
            mask: [...standingMasks(page), ...(options.mask ?? [])],
            // Both of these are pure noise in a still image, and both differ
            // between runs: a caret blinks, and a transition caught mid-flight
            // photographs a control halfway to somewhere.
            animations: 'disabled' as const,
            caret: 'hide' as const,
        };
        if (options.element) {
            await options.element.screenshot(common);
            return;
        }
        await page.screenshot({ ...common, fullPage: options.fullPage ?? false });
    };

    /**
     * Capture one long screen as SEVERAL pictures, one per container.
     *
     * THE PROBLEM THIS SOLVES. A settings page is often 3000+ CSS px tall. Shot
     * full-page it becomes a strip that the guide displays 0.65x wide and
     * scrolled past in one flick — a picture of everything, which points at
     * nothing. Worse now than before: a narrower capture viewport reflows a long
     * page TALLER, and at deviceScaleFactor 2 a page over ~8000 CSS px cannot be
     * captured full-page at all (Chromium's ~16384px limit).
     *
     * WHY ELEMENT-SCOPED RATHER THAN SLICING BY VIEWPORT HEIGHT. A height slice
     * is arithmetic, not meaning: it cuts wherever the number lands, so a
     * heading arrives at the bottom of one picture and its form at the top of
     * the next, and the cut moves every time the page's content changes length.
     * A container is what the reader is being shown, and the pages that need
     * splitting already have stable ones — `/settings/communication` carries
     * `#email-delivery`, `#sms-delivery`, `#email-templates`, `#google-calendar`
     * as scroll-spy anchors, guarded by settings-communication-nav.spec.ts. When
     * a screen genuinely has no container to name, the honest fix is to give it
     * one in the app, not to guess an offset here.
     *
     * WHAT IT COSTS. Each part is a separate marker id in the prose — see
     * ShotSection.id. This is a two-repository change; there is no way to emit
     * more files under one id without failing the publisher's exact-set check.
     */
    const sections = async (page: Page, entries: readonly ShotSection[]): Promise<void> => {
        for (const entry of entries) {
            // Fail here rather than photograph the wrong thing. `count()` is
            // deliberately not consulted: a section that has silently stopped
            // rendering must break the capture run, because the alternative is
            // a guide that quietly loses a picture and a validator that then
            // blames the prose.
            await entry.element.first().scrollIntoViewIfNeeded();
            await shot(page, entry.id, { element: entry.element.first(), mask: entry.mask });
        }
    };

    return Object.assign(shot, { sections });
}

/**
 * The panel a heading sits in — the frame for an element-scoped capture.
 *
 * A workspace screen is a column of panels, and they are NOT one component: most
 * are `<Card>` from packages/shared-ui (`bg-ih-bg-card border border-ih-border
 * rounded-ih-card shadow-ih-card`), while a few hand-roll the same surface —
 * DocumentsSection is a `<section className="rounded-xl border border-ih-border
 * bg-ih-bg-card p-5">`. The one class both spellings share is the BACKGROUND,
 * so that is the anchor. `rounded-ih-card` would have matched two of the hub's
 * three panels and thrown on the third.
 *
 * Nearest-ancestor, not first-in-document: `bg-ih-bg-card` also lands on inputs
 * and selects, but a heading is never inside one, so the first ancestor carrying
 * it is the panel.
 *
 * ⚠️ Anchoring on a utility class is a compromise, not a pattern. It beats the
 * alternatives on offer — a text locator returns the `<h2>` itself, which
 * photographs as one line of type — but if a panel needs framing precisely, give
 * it a real id in the app and locate on that. This helper is for panels that
 * have none.
 */
export function panelAround(heading: Locator): Locator {
    return heading.locator('xpath=ancestor::*[contains(@class,"bg-ih-bg-card")][1]');
}

/**
 * Discard a guide's previous captures before it re-runs.
 *
 * Without this a step that was renamed or deleted leaves its old PNG behind,
 * the validator reports it as a capture with no marker, and the author goes
 * looking for a bug in the prose. Cleaning here rather than in the runner keeps
 * the two facts together: whoever declares a guide also owns its directory.
 */
export function resetGuide(guideSlug: string): void {
    rmSync(path.join(SHOT_ROOT, guideSlug), { recursive: true, force: true });
}

/**
 * `test` with the clock already frozen.
 *
 * Freezing in a fixture rather than in each file means a new guide cannot
 * forget — and forgetting is invisible until someone notices the manual has
 * three different dates in it.
 */
export const test = base.extend({
    page: async ({ page }, use) => {
        await page.clock.setFixedTime(FROZEN_TIME);
        await use(page);
    },
});

export { expect } from '@playwright/test';
