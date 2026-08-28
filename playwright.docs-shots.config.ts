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
                // Wide enough for the three-pane editor without a horizontal
                // scrollbar, short enough that a full-page capture is readable
                // at the width the portal renders it.
                viewport: { width: 1440, height: 900 },
                // Physical pixels stay 1:1 so an image is the size it says it
                // is; a 2x capture doubles every file for no gain in a doc that
                // is displayed at ~800px wide.
                deviceScaleFactor: 1,
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
