/**
 * MigrationBundleV1 — the format contract between an adapter and the staging
 * step, and the three rules that make its counts trustworthy.
 *
 * The rules exist because the shape they replace was observed to fail
 * silently: a payload of entirely unusable entries could report success with
 * every count at zero, because only the entries that survived were counted.
 * An equation the validator checks means a dropped entry has to be written
 * down before the bundle is accepted at all.
 */
import { describe, it, expect } from 'vitest';
import { parseMigrationBundle } from '../../../server/lib/validations/migration-bundle.schema';

function emptyCounts() {
    return { readFromSource: 0, emitted: 0, dropped: [] as { at: string; reason: string }[] };
}

function bundleWith(overrides: Record<string, unknown> = {}) {
    return {
        formatVersion: 1,
        manifest: {
            source: { vendor: 'csv_generic' },
            adapter: { name: 'csv-generic', version: '1' },
            counts: { template: emptyCounts(), contact: emptyCounts(), member: emptyCounts() },
            warnings: [],
        },
        templates: [],
        contacts: [],
        members: [],
        ...overrides,
    };
}

describe('parseMigrationBundle', () => {
    it('accepts a well-formed empty bundle', () => {
        const result = parseMigrationBundle(bundleWith());
        expect(result.ok).toBe(true);
    });

    it('rejects a bundle whose formatVersion is not 1', () => {
        const result = parseMigrationBundle(bundleWith({ formatVersion: 2 }));
        expect(result.ok).toBe(false);
    });

    it('rejects readFromSource that does not equal emitted plus dropped', () => {
        const result = parseMigrationBundle(bundleWith({
            manifest: {
                source: { vendor: 'csv_generic' },
                adapter: { name: 'csv-generic', version: '1' },
                counts: {
                    template: emptyCounts(),
                    contact: { readFromSource: 5, emitted: 3, dropped: [{ at: 'contacts[4]', reason: 'no name' }] },
                    member: emptyCounts(),
                },
                warnings: [],
            },
            contacts: [
                { name: 'A', type: 'client' },
                { name: 'B', type: 'client' },
                { name: 'C', type: 'client' },
            ],
        }));
        expect(result.ok).toBe(false);
        expect(result.ok === false && result.issues.join(' ')).toMatch(/contact/);
    });

    it('accepts the same counts once every dropped entry is named', () => {
        const result = parseMigrationBundle(bundleWith({
            manifest: {
                source: { vendor: 'csv_generic' },
                adapter: { name: 'csv-generic', version: '1' },
                counts: {
                    template: emptyCounts(),
                    contact: {
                        readFromSource: 5,
                        emitted: 3,
                        dropped: [
                            { at: 'contacts[3]', reason: 'row has no name' },
                            { at: 'contacts[4]', reason: 'row has no name' },
                        ],
                    },
                    member: emptyCounts(),
                },
                warnings: [],
            },
            contacts: [
                { name: 'A', type: 'client' },
                { name: 'B', type: 'client' },
                { name: 'C', type: 'client' },
            ],
        }));
        expect(result.ok).toBe(true);
    });

    it('rejects emitted that disagrees with the array it counts', () => {
        const result = parseMigrationBundle(bundleWith({
            manifest: {
                source: { vendor: 'csv_generic' },
                adapter: { name: 'csv-generic', version: '1' },
                counts: {
                    template: emptyCounts(),
                    contact: { readFromSource: 12, emitted: 12, dropped: [] },
                    member: emptyCounts(),
                },
                warnings: [],
            },
            contacts: [
                { name: 'A', type: 'client' },
                { name: 'B', type: 'client' },
                { name: 'C', type: 'client' },
            ],
        }));
        expect(result.ok).toBe(false);
        expect(result.ok === false && result.issues.join(' ')).toMatch(/emitted/);
    });

    it('requires a contact type — the mapping step has to ask for it', () => {
        const result = parseMigrationBundle(bundleWith({
            manifest: {
                source: { vendor: 'csv_generic' },
                adapter: { name: 'csv-generic', version: '1' },
                counts: {
                    template: emptyCounts(),
                    contact: { readFromSource: 1, emitted: 1, dropped: [] },
                    member: emptyCounts(),
                },
                warnings: [],
            },
            contacts: [{ name: 'A' }],
        }));
        expect(result.ok).toBe(false);
    });

    it('refuses a member row with the agent role', () => {
        const result = parseMigrationBundle(bundleWith({
            manifest: {
                source: { vendor: 'csv_generic' },
                adapter: { name: 'csv-generic', version: '1' },
                counts: {
                    template: emptyCounts(),
                    contact: emptyCounts(),
                    member: { readFromSource: 1, emitted: 1, dropped: [] },
                },
                warnings: [],
            },
            members: [{ email: 'a@example.test', role: 'agent' }],
        }));
        expect(result.ok).toBe(false);
    });

    it('rejects a bundle carrying an id for a row it has not created yet', () => {
        const result = parseMigrationBundle(bundleWith({
            manifest: {
                source: { vendor: 'csv_generic' },
                adapter: { name: 'csv-generic', version: '1' },
                counts: {
                    template: emptyCounts(),
                    contact: { readFromSource: 1, emitted: 1, dropped: [] },
                    member: emptyCounts(),
                },
                warnings: [],
            },
            contacts: [{ id: 'vendor-42', name: 'A', type: 'client' }],
        }));
        expect(result.ok).toBe(false);
    });
});
