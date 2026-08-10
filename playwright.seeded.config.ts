import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/**
 * The multi-user-seed E2E run: `npm run test:e2e:seeded`.
 *
 * WHY THIS IS A SECOND CONFIG AND NOT TWO MORE PROJECTS IN THE FIRST ONE.
 *
 * `tests/seed-fixtures.ts` writes its users into TENANT_A, and TENANT_A *is*
 * the standalone workspace (`SINGLE_TENANT_ID`) — standalone login resolves no
 * other tenant, so the fixtures cannot live anywhere else. But the default
 * run's `api` project opens with API-01 asserting that
 * `POST /api/auth/setup` returns a FRESH 200, and setup 409s
 * (`already_initialized`) the moment any user has a tenant. The seed and that
 * assertion are mutually exclusive by construction, in one shared D1.
 *
 * So they are two runs, not two projects: the default suite stays unseeded and
 * `api` still proves a cold install works, and this config seeds and runs the
 * subsystem specs that need the seeded workspace. Both drive the SAME worker
 * (`reuseExistingServer`), so running them back to back costs one boot.
 *
 * The alternative — leaving these specs in the default config and skipping them
 * unless SEED_E2E is set — was rejected: it puts nine tests back in the
 * permanently-skipped column that this split exists to empty.
 */

// Read by tests/global-setup.ts. Set here rather than in an npm script so the
// command is identical on Windows and CI (no `cross-env`, no shell-specific
// `VAR=x cmd` prefix, which PowerShell does not parse).
process.env.SEED_E2E = '1';

export default defineConfig({
    ...base,
    projects: [
        {
            name: 'subsystem-d-flows',
            testMatch: 'subsystem-d-flows.spec.ts',
        },
        {
            name: 'subsystem-e-flows',
            testMatch: 'subsystem-e-flows.spec.ts',
        },
        // The client's repair-request builder. It belongs to THIS config for the
        // same reason the two above do — it is reached with a seeded portal token
        // on the seeded delivered inspection, and those rows cannot coexist with
        // the default run's fresh-setup assertion.
        {
            name: 'repair-builder-client-link',
            testMatch: 'repair-builder-client-link.spec.ts',
        },
    ],
});
