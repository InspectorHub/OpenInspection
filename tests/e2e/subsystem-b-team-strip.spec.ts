/**
 * Design System 0520 subsystem B phase 7 task 7.3 — TeamStrip E2E.
 *
 * TODO(dead-feature): the dashboard "Team today" TeamStrip live-presence roster
 * was REMOVED in #223 (Design-system consistency & auth-page unification) —
 * app/components/dashboard/TeamStrip.tsx no longer exists and /inspections
 * renders no presence roster. usePresence now lives only in the inspection
 * editor (FooterBar), and its two-context "each side sees the other online"
 * intent is already covered end to end by the collab-editing suite
 * (tests/e2e/collab-editing.spec.ts, the `browser-collab` project), which drives
 * the real WS presence between two clients editing one inspection.
 *
 * This spec is kept as a skip-shell (rather than deleted) so the removed
 * dashboard-roster coverage stays visible until the feature is either dropped
 * from the plan or reintroduced. If it is reintroduced, rewrite against the new
 * roster surface and seed two same-tenant users (the `api` project already
 * seeds admin@autotest.com + inspector@autotest.com).
 */
import { test } from '@playwright/test';

test.describe('TeamStrip live presence (subsystem B M3 + M7)', () => {
    test.skip(true, 'Dashboard TeamStrip removed in #223 — presence is covered by the collab-editing suite.');

    test('two contexts on /inspections see each other in TeamStrip roster', () => {
        // Intentionally empty — see the skip above.
    });
});
