/**
 * R7-06 — /book Inspection Date input is a native date picker.
 *
 * DE-STALE STATUS (2026-07 tests-reorg): the assertions below targeted the
 * Alpine booking page — `input[name="inspectionDate"]`, `#date-error`, and an
 * `x-model`/x-show validator — all of which were removed in the RR v7 migration.
 *
 * The live equivalent is the React BookingWizard: the native date input now
 * lives on step 2 (ScheduleStep) as `<input type="date">` inside a
 * `<label>Inspection date …</label>` (app/components/booking/BookingSteps.tsx:
 * 147-155). Reaching it requires driving the wizard: step 0 (address) →
 * Continue → step 1 (Services, gated by `canNext`, needs ≥1 seeded booking
 * service) → Continue → step 2. The default globalSetup wipes D1 and seeds no
 * booking services, so step 2 is not reliably reachable here.
 *
 * TODO(tests-reorg): rewrite onto the RR wizard once the seeded suite provisions
 * a bookable service. Target: goto `/book/:tenant`, advance to step 2, then
 * `page.getByLabel('Inspection date')` (or `input[type="date"]`) — assert
 * type=date and the ISO round-trip. The past-date error is now enforced by the
 * React validator, not `#date-error`.
 */
import { test } from '@playwright/test';

test.describe.skip('R7-06 — /book inspection date input (needs RR wizard rebind)', () => {
    test('uses native date picker (type=date)', async () => {});
    test('accepts an ISO YYYY-MM-DD value and round-trips it', async () => {});
    test('shows an error when a past date is selected', async () => {});
});
