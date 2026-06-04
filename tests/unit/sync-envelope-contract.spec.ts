import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    toCloudEvent,
    DATA_SCHEMAS,
    SCHEMAS,
    type SyncEnvelope,
    type SyncEventType,
} from '../../server/lib/sync-events/envelope';

const FIXTURE_DIR = join(__dirname, '..', 'fixtures', 'sync-events');

function loadFixture(name: string): SyncEnvelope {
    return JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf8')) as SyncEnvelope;
}

// Each fixture file + the canonical event type it represents.
const CASES: { file: string; eventType: SyncEventType }[] = [
    { file: 'user-invited.v1.json', eventType: 'user.invited' },
    { file: 'user-password-changed.v1.json', eventType: 'user.password_changed' },
    { file: 'user-deleted.v1.json', eventType: 'user.deleted' },
];

describe('sync envelope contract (golden fixtures)', () => {
    for (const { file, eventType } of CASES) {
        describe(file, () => {
            const fixture = loadFixture(file);

            it('toCloudEvent reproduces the fixture exactly', () => {
                // Reconstruct the raw outbox row that would have produced this
                // envelope: id + time come from the fixture so equality is exact;
                // payload is the JSON-encoded `data`.
                const createdAt = Math.floor(new Date(fixture.time).getTime() / 1000);
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
