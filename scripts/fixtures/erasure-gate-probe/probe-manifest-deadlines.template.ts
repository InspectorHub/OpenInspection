/**
 * FIXTURE TEMPLATE — the two ends of the enforcement-deadline window, in one
 * manifest, so a single gate run proves both.
 *
 * This is a TEMPLATE, not a runnable probe: the two deadlines are the tokens
 * `__DEADLINE_NEAR__` and `__DEADLINE_FAR__`, and
 * `tests/unit/tooling/manifest-gate-parsing.spec.ts` substitutes real dates
 * computed from the clock at run time. A hard-coded near date would sit inside
 * the lead-time window on the day it was written and drift out of it — first
 * into the past, where the gate's past-due FAIL fires instead and the test
 * starts asserting a different branch than the one it names. A fixture whose
 * meaning depends on when you read it is not a fixture.
 *
 * Both pending keys are REAL entries from the gate's PENDING_ENFORCEMENT list.
 * That list is checked in one direction on every run — a rule marked pending
 * that is not on it FAILS — so a probe cannot invent its own pending key
 * without also editing the gate. Reusing two of the address-family keys is the
 * honest way in: the fixture models exactly the population the deadline is
 * about, with the dates moved.
 *
 * Both arms are here on purpose. `__DEADLINE_NEAR__` must produce a warning
 * naming its rule; `__DEADLINE_FAR__` must produce none. Without the far arm a
 * warning path that fires on every pending rule — or one that prints a warning
 * header with no rules under it — would satisfy the near assertion and read as
 * working.
 *
 * The two non-pending rules below are not decoration: `probe-schema.ts`
 * declares `probe_contacts.email` and `probe_contacts.client_name`, and the
 * coverage check FAILS on any uncovered PII column, so without them this probe
 * would exit 1 for a reason that has nothing to do with deadlines.
 */
export const ERASURE_MANIFEST: ErasureRule[] = [
    {
        table: 'probe_contacts',
        column: 'email',
        category: 'contact',
        action: 'null',
    },
    {
        table: 'probe_contacts',
        column: 'client_name',
        category: 'contact',
        action: 'erase_in_place',
        legalBasis: 'art_17_3_e',
    },
    // Inside the lead-time window: must WARN, must not fail.
    { table: 'inspections', column: 'property_address', category: 'user.address', action: 'retain', legalBasis: 'art_17_3_e', retention: 'P6Y', enforcementStatus: 'pending', enforcementDeadline: '__DEADLINE_NEAR__' },
    // Far outside it: must stay silent, so "warns" is a claim about the date
    // rather than about being pending at all.
    { table: 'inspections', column: 'address_city', category: 'user.address', action: 'retain', legalBasis: 'art_17_3_e', retention: 'P6Y', enforcementStatus: 'pending', enforcementDeadline: '__DEADLINE_FAR__' },
];
