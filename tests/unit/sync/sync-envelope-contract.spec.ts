import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    toCloudEvent,
    DATA_SCHEMAS,
    SCHEMAS,
    type SyncEnvelope,
    type SyncEventType,
} from '../../../server/lib/sync-events/envelope';

const FIXTURE_DIR = join(__dirname, '..', '..', 'fixtures', 'sync-events');

function loadFixture(name: string): SyncEnvelope {
    return JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf8')) as SyncEnvelope;
}

// Each fixture file + the canonical event type it represents.
const CASES: { file: string; eventType: SyncEventType }[] = [
    { file: 'user-invited.v1.json', eventType: 'user.invited' },
    { file: 'user-password-changed.v1.json', eventType: 'user.password_changed' },
    { file: 'user-deleted.v1.json', eventType: 'user.deleted' },
    // A-21 batch 2 — command reply riding the sync queue.
    { file: 'reply-tenant-updated.v1.json', eventType: 'reply.tenant.updated' },
    // A-21 batch 3 — offboarding replies.
    { file: 'reply-tenant-export-completed.v1.json', eventType: 'reply.tenant.export_completed' },
    { file: 'reply-tenant-purged.v1.json', eventType: 'reply.tenant.purged' },
    // Privacy P3 — DSAR replies, correlated by `data.replyto` = `dsar:<id>`.
    //
    // The COUNTS inside `reply-subject-erased`'s coverage block are illustrative
    // and are deliberately not asserted against the live catalogue anywhere: the
    // manifest gains rules most months, and a fixture pinned to today's totals
    // would be a red build with no defect behind it. What the fixture pins is
    // the SHAPE — which fields exist, and that `pendingRules.length` equals
    // `pendingEnforcementCount`, the one invariant portal refuses a reply over.
    { file: 'reply-subject-exported.v1.json', eventType: 'reply.subject.exported' },
    { file: 'reply-subject-erased.v1.json', eventType: 'reply.subject.erased' },
    // Two fixtures for ONE event type, which is the only entry here that has
    // them. `reply.subject.erased` is a union with two endings, and the second
    // one — the erasure a preservation order stopped — carries no coverage
    // block and is the branch that reaches a person who asked for their data to
    // be deleted and did not get that. A single fixture pinned only the ending
    // that already worked, which is how the held branch shipped against a
    // contract that had no room for it.
    { file: 'reply-subject-erased-held.v1.json', eventType: 'reply.subject.erased' },
    // CA-03 — the correction answer, both endings. Added because the coverage
    // control at the bottom of this file went red the moment it was written: the
    // type was registered, had a two-branch Zod union, and had a spec asserting
    // that union directly (cmd-report-correct-contract.spec.ts) — but no golden
    // envelope. A shape assertion against the schema and a round-trip against a
    // pinned envelope are not the same instrument; only the second one would
    // have noticed a `dataschema` or `type` that portal cannot key on, which is
    // the failure this whole file exists to catch.
    { file: 'reply-report-corrected.v1.json', eventType: 'reply.report.corrected' },
    { file: 'reply-report-corrected-refused.v1.json', eventType: 'reply.report.corrected' },
    // Core-managed 10DLC/TFV compliance state. This fixture is a byte-for-byte
    // copy of portal's `tenant-compliance-status-updated.v1.json`, and portal
    // had it FIRST — alone, for this event's entire life. That asymmetry was the
    // visible end of the defect: the consumer had written down the envelope it
    // expected, the producer had never written down the one it sent, and the one
    // it sent was `io.inspectorhub.io.inspectorhub.tenant.…`, which portal
    // parked. Nothing here reached across to notice, because a list below
    // decided what got tested and this type was not on it.
    { file: 'tenant-compliance-status-updated.v1.json', eventType: 'tenant.compliance_status_updated' },
];

describe('sync envelope contract (golden fixtures)', () => {
    for (const { file, eventType } of CASES) {
        describe(file, () => {
            const fixture = loadFixture(file);

            it('toCloudEvent reproduces the fixture exactly', () => {
                // Reconstruct the raw outbox row that would have produced this
                // envelope: id + time come from the fixture so equality is exact;
                // payload is the JSON-encoded `data`.
                const createdAt = new Date(fixture.time);
                const row = {
                    id: fixture.id,
                    eventType,
                    payload: JSON.stringify(fixture.data),
                    createdAt,
                };
                expect(toCloudEvent(row)).toEqual(fixture);
            });

            it('envelope shape matches the contract', () => {
                expect(fixture.specversion).toBe('1.0');
                expect(fixture.source).toBe('core');
                expect(fixture.type).toBe(`io.inspectorhub.${eventType}`);
            });

            it('dataschema version is in the supported registry', () => {
                const version = fixture.dataschema.split('/')[1];
                expect(SCHEMAS[eventType]).toContain(version);
            });

            it('data validates against its Zod schema', () => {
                const result = DATA_SCHEMAS[eventType].safeParse(fixture.data);
                expect(result.success).toBe(true);
            });
        });
    }
});

/**
 * The control on the suite above.
 *
 * Every assertion in `sync envelope contract` is driven by `CASES`, a list
 * maintained by hand, so the suite can only ever be as complete as somebody
 * remembered to make it — and for `tenant.compliance_status_updated` nobody did.
 * That event was registered nowhere, fixtured nowhere, and emitted with a name
 * that could not survive `toCloudEvent`; the suite stayed green throughout,
 * because a type absent from `CASES` is a type it never looks at.
 *
 * A green suite over an unknown fraction of the registry is not a measurement.
 * These two tests print the other number: the registry's size, against the set
 * `CASES` actually covers. Adding an event type to `SCHEMAS` without a golden
 * fixture is now a red build, and the failure NAMES the type rather than
 * reporting a count.
 */
describe('every registered event type is covered by a golden fixture', () => {
    const registered = Object.keys(SCHEMAS) as SyncEventType[];
    const covered = new Set(CASES.map((c) => c.eventType));

    it('the registry is non-empty — an empty one would make the next test vacuously green', () => {
        expect(registered.length).toBeGreaterThan(0);
    });

    it('no registered type is missing a fixture', () => {
        const missing = registered.filter((t) => !covered.has(t));
        expect(missing, `registered in SCHEMAS but never fixtured: ${missing.join(', ') || '(none)'}`)
            .toEqual([]);
    });

    it('no fixture claims a type the registry does not have', () => {
        const stray = [...covered].filter((t) => !Object.prototype.hasOwnProperty.call(SCHEMAS, t));
        expect(stray, `fixtured but absent from SCHEMAS: ${stray.join(', ') || '(none)'}`).toEqual([]);
    });
});

describe('toCloudEvent refuses an event type the registry does not know', () => {
    // The row shape D1 really hands back: `event_type` is a TEXT column, so the
    // producer-side compile fence cannot reach it. This is the runtime half.
    const rowWith = (eventType: string) => ({
        id: '00000000-0000-4000-8000-0000000000ff',
        eventType,
        payload: '{}',
        createdAt: new Date('2026-06-27T00:00:00.000Z'),
    });

    it('throws rather than emitting a junk wire type', () => {
        expect(() => toCloudEvent(rowWith('tenant.not_a_real_event')))
            .toThrow(/unregistered event type "tenant\.not_a_real_event"/);
    });

    it('throws on the ALREADY-PREFIXED spelling — the exact bug this replaced', () => {
        // Before the fix this returned an envelope typed
        // `io.inspectorhub.io.inspectorhub.tenant.compliance_status_updated`
        // with dataschema `io-inspectorhub-tenant-compliance-status-updated/v1`.
        // Portal knows neither, so it parked every one and the engine never
        // heard about it. Serializing must not be able to reach that state
        // again, whatever a legacy `sync_outbox` row happens to hold.
        expect(() => toCloudEvent(rowWith('io.inspectorhub.tenant.compliance_status_updated')))
            .toThrow(/unregistered event type/);
    });

    it('positive control: a registered type still serializes to the single-prefixed wire name', () => {
        expect(toCloudEvent(rowWith('tenant.compliance_status_updated')).type)
            .toBe('io.inspectorhub.tenant.compliance_status_updated');
    });
});
