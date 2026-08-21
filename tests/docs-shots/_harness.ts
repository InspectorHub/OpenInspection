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
export function shotsFor(guideSlug: string) {
    return async function shot(page: Page, id: string, options: ShotOptions = {}): Promise<void> {
        const dir = path.join(SHOT_ROOT, guideSlug);
        mkdirSync(dir, { recursive: true });
        await page.screenshot({
            path: path.join(dir, `${id}.png`),
            mask: [...standingMasks(page), ...(options.mask ?? [])],
            fullPage: options.fullPage ?? false,
            // Both of these are pure noise in a still image, and both differ
            // between runs: a caret blinks, and a transition caught mid-flight
            // photographs a control halfway to somewhere.
            animations: 'disabled',
            caret: 'hide',
        });
    };
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
