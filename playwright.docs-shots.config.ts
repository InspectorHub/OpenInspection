import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

/**
 * The documentation capture run: `npm run docs:shots`.
 *
 * These are not tests and they are not in the E2E suite — they walk the real
 * product and photograph it, so that every screenshot in the user guide is
 * produced by software that actually clicked the button. That is the whole
 * mechanism: a guide's pictures cannot be regenerated without the flow still
 * working, so a UI change that breaks a documented step breaks the docs build
 * instead of quietly leaving a lie on the website.
 *
 * WHY A THIRD CONFIG rather than more projects in the first one. Same reason
 * `playwright.seeded.config.ts` exists: the default run's `api` project asserts
 * `POST /api/auth/setup` returns a FRESH 200, and setup 409s the moment any
 * user has a tenant. These captures need the seeded workspace
 * (`tests/seed-fixtures.ts`), which is mutually exclusive with that assertion in
 * one shared D1. Both drive the SAME worker (`reuseExistingServer`), so running
 * them back to back costs one boot.
 *
 * Files are `*.shots.ts`, not `*.spec.ts`, so no other config can collect them
 * and `npm run test:e2e` stays exactly what it was.
 */

// Read by tests/global-setup.ts. Set here rather than in an npm script so the
// command is identical on Windows and CI (no `cross-env`, no shell-specific
// `VAR=x cmd` prefix, which PowerShell does not parse).
process.env.SEED_E2E = '1';

export default defineConfig({
    ...base,
    // Clears `.docs-shots/` once per run, then delegates to the shared seed.
    // The per-guide `beforeAll` reset it replaces ran a second time whenever a
    // failure restarted the worker, deleting the screenshots already taken.
    globalSetup: './tests/docs-shots/_global-setup.ts',
    testDir: './tests/docs-shots',
    testMatch: '**/*.shots.ts',
    // A capture run is a documentation build, not a test run: a retry would
    // silently publish the second attempt's screenshots, and a flaky step is
    // something to fix before it becomes a picture in the manual.
    retries: 0,
    // A capture walk is not a unit test: one file logs in, creates what the
    // pictures need, then walks several screens taking a shot at each. The
    // inherited 30s budget is a TEST timeout, and it expired mid-wizard rather
    // than reporting a broken step — a timeout that fires on a working flow
    // teaches the author nothing.
    timeout: 180_000,
    // One at a time. The captures share one worker and one D1 like everything
    // else here, but they also share something the specs do not: a sequence a
    // reader is going to follow. Two guides interleaving their writes can leave
    // a screenshot showing state from the other one's step.
    workers: 1,
    projects: [
        {
            name: 'desktop',
            use: {
                ...devices['Desktop Chrome'],
                // 960 CSS px, and the number is derived, not chosen.
                //
                // WHAT WENT WRONG AT 1440. The published guide renders its
                // prose — and therefore its images — inside a fixed column:
                // `.ihp-prose` is `max-w-2xl` (42rem = 672px) and its images
                // are `max-width: 100%`. A 1440px-wide capture is displayed at
                // 672px, i.e. 0.47x, so the app's 14px UI text reached the
                // reader at about 6.5px. Every screenshot in the manual was
                // technically correct and practically unreadable.
                //
                // WHY 960 AND NOT MORE. Display scale is 672/width: 1440 gives
                // 0.47, 1040 gives 0.65, 960 gives 0.70. True 1:1 would need a
                // 672px viewport, which is a phone — the `mobile` project
                // already documents that layout where a guide wants it.
                //
                // WHAT 960 COSTS, AND WHY IT IS NOW AFFORDABLE. Two hard edges
                // sit just above it:
                //   * the workspace sidebar is `hidden lg:flex`
                //     (app/components/Sidebar.tsx) and Tailwind's `lg` is
                //     1024px — this repo overrides no breakpoint. Below that
                //     the shell swaps to MobileHeader + drawer.
                //   * the report editor's shell is `min-w-[1024px]`
                //     (app/routes/inspection-edit.tsx) — narrower than that and
                //     the three-pane guide is photographed mid-horizontal-
                //     scroll.
                // Both used to force every capture wide, because the guides
                // said "in the left-hand nav" and no page had ever shown the
                // reader what that was. One guide now owns that explanation
                // (`finding-your-way-around`), so the rest are free to be
                // photographed at a width where their own content is legible.
                //
                // The two files that still NEED the wider shell say so
                // themselves, with a `test.use({ viewport })` naming the reason
                // — workspace-shell.shots.ts, which photographs the sidebar,
                // and the editor block in staff-lifecycle.shots.ts. A project
                // default cannot express "this guide, for this reason", and a
                // second project would silently re-shoot every id under a
                // different width.
                viewport: { width: 960, height: 900 },
                // 2x, and this is a consequence of the line above rather than
                // an independent taste. The previous comment here argued that
                // 1x costs nothing "in a doc that is displayed at ~800px wide",
                // which held only while the capture was much wider than its
                // display box. It no longer is: 1040 CSS px shown in a 672px
                // column is 1344 DEVICE px on a 2x screen, so a 1x capture is
                // UPSCALED 1.29x for most laptop readers and the text goes
                // soft. At 2x the file is 2080 device px and downsamples
                // cleanly on 1x and 2x alike.
                //
                // ⚠️ Full-page captures are now 2x tall in pixels as well.
                // Chromium refuses a screenshot past ~16384px on either axis,
                // so a page over ~8000 CSS px cannot be shot full-page at all —
                // one more reason a long page should be captured as sections.
                deviceScaleFactor: 2,
            },
        },
        {
            // Only the guides that document a phone flow declare mobile steps;
            // the rest simply take no shots in this project.
            name: 'mobile',
            use: { ...devices['iPhone 14'] },
        },
    ],
});
