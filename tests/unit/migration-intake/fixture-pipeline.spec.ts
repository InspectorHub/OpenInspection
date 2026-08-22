/**
 * The fixture pipeline, and the rule that makes it lawful.
 *
 * A public fixture is GENERATED from a schema we authored. Nothing derived
 * from a real file may enter this repository, and a checked-in sample export is
 * derived from one whatever is redacted out of it. So the schema declares shape
 * and surprises, the generator invents the content, and the manifest records
 * that each surprise was actually seen in a real file — which is what separates
 * this from a hand-written fixture that only ever tests the answers its author
 * already believed.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spectoraAdapter } from '../../../server/lib/migration-intake/adapters/spectora';
import { homeInspectorProAdapter } from '../../../server/lib/migration-intake/adapters/home-inspector-pro';

const FIXTURE_DIR = resolve(__dirname, '../../fixtures/intake');
const GENERATOR = resolve(__dirname, '../../../scripts/generate-intake-fixture.mjs');

interface Quirk { id: string; kind: string; statement: string }
interface Schema { vendor: string; container: string; quirks: Quirk[] }
interface Observation { quirk: string; vendor: string; observedOn: string; fileSha256: string | null }
interface Generator {
    readSchema(vendor: string): Schema;
    readManifest(): { observations: Observation[] };
    generateCases(vendor: string): { quirk: string; bytes: Uint8Array }[];
    generateFixture(vendor: string): Uint8Array;
}

/** The vendors that have a schema. Read off the directory, so a new one joins by existing. */
function schemaVendors(): string[] {
    return readdirSync(FIXTURE_DIR)
        .filter((f) => f.endsWith('.schema.json'))
        .map((f) => f.replace('.schema.json', ''));
}

let gen: Generator;

beforeAll(async () => {
    // A runtime import of the .mjs, which this config marks external — the same
    // way every other gate script is exercised from a spec.
    gen = await import(pathToFileURL(GENERATOR).href) as unknown as Generator;
});

describe('the schemas', () => {
    it('scans a non-empty set of schemas (an empty scan is a failure, not a pass)', () => {
        const vendors = schemaVendors();
        // eslint-disable-next-line no-console
        console.info(`fixture-pipeline: ${vendors.length} schema(s): ${vendors.join(', ')}`);
        expect(vendors.length).toBeGreaterThanOrEqual(2);
    });

    it('declares no vendor vocabulary', () => {
        // The assertion that keeps this lawful. A schema naming a real section
        // or a real rating word has become the derived artefact that may not be
        // in a public repository — and it would look exactly like a schema.
        const forbidden = /satisfactory|marginal|acceptable|deficien|not inspected by|roof|exterior|crawlspace|attic/i;
        const offenders: string[] = [];
        for (const vendor of schemaVendors()) {
            const raw = readFileSync(join(FIXTURE_DIR, `${vendor}.schema.json`), 'utf8');
            const hit = raw.match(forbidden);
            if (hit) offenders.push(`${vendor}.schema.json holds "${hit[0]}"`);
        }
        expect(offenders).toEqual([]);
    });

    it('POSITIVE CONTROL — that rule fires on text that breaks it', () => {
        // Without this, the rule above passes for a pattern that matches
        // nothing, and a schema full of somebody's vocabulary would sail past.
        const forbidden = /satisfactory|marginal|acceptable|deficien|not inspected by|roof|exterior|crawlspace|attic/i;
        expect(forbidden.test('{ "ratings": ["Satisfactory", "Marginal"] }')).toBe(true);
    });

    it('names a quirk-id at most once per vendor', () => {
        for (const vendor of schemaVendors()) {
            const ids = gen.readSchema(vendor).quirks.map((q) => q.id);
            expect(ids).toEqual([...new Set(ids)]);
        }
    });
});

describe('the generator', () => {
    it('exercises EVERY quirk each schema declares', async () => {
        // Otherwise a quirk is documentation. The count is the assertion: a
        // schema with five quirks must produce five cases, and the generator
        // throws by name on one it cannot produce.
        for (const vendor of schemaVendors()) {
            const declared = gen.readSchema(vendor).quirks.length;
            expect(gen.generateCases(vendor).length).toBe(declared);
        }
    });

    it('produces a file the adapter it targets can actually read', async () => {
        const spectora = await spectoraAdapter.inspect?.(gen.generateFixture('spectora'));
        expect(spectora?.kind).toBe('template');
        const hip = await homeInspectorProAdapter.inspect?.(gen.generateFixture('home_inspector_pro'));
        expect(hip?.kind).toBe('template');
    });

    it('produces a READABLE file for every quirk, not just the first', async () => {
        // The case this is really about: a generated file that exercises a
        // quirk and that the adapter chokes on proves nothing about the reader,
        // and a suite that only ever generated case one would not notice.
        const unreadable: string[] = [];
        for (const { quirk, bytes } of gen.generateCases('spectora')) {
            if (await spectoraAdapter.inspect?.(bytes) === null) unreadable.push(`spectora/${quirk}`);
        }
        for (const { quirk, bytes } of gen.generateCases('home_inspector_pro')) {
            if (await homeInspectorProAdapter.inspect?.(bytes) === null) {
                unreadable.push(`home_inspector_pro/${quirk}`);
            }
        }
        expect(unreadable).toEqual([]);
    });

    it('is deterministic — the same schema generates the same bytes', () => {
        const first = gen.generateFixture('spectora');
        const second = gen.generateFixture('spectora');
        expect(Array.from(second)).toEqual(Array.from(first));
    });
});

describe('the manifest', () => {
    it('cites an observation for EVERY quirk of every schema', () => {
        // "Observed in a real file, on this date" is the whole difference
        // between this and a hand-written fixture.
        const observations = gen.readManifest().observations;
        const missing: string[] = [];
        for (const vendor of schemaVendors()) {
            const schema = gen.readSchema(vendor);
            for (const quirk of schema.quirks) {
                const cited = observations.some(
                    (o) => o.quirk === quirk.id && o.vendor === schema.vendor,
                );
                if (!cited) missing.push(`${schema.vendor}/${quirk.id}`);
            }
        }
        expect(missing).toEqual([]);
    });

    it('names no path and no filename', () => {
        // A filename is metadata about somebody's file. A hash is a fact that
        // lets a later reader confirm the same file was seen.
        const raw = readFileSync(join(FIXTURE_DIR, 'manifest.json'), 'utf8');
        expect(raw).not.toMatch(/\.(xlsx|xls|tpz|tpx|hgf|pdf|zip|csv|json)"/i);
        expect(raw).not.toMatch(/[A-Za-z]:\\|\/Users\/|\/home\//);
    });

    it('observes nothing a schema does not declare', () => {
        // The other direction. An observation for a quirk no schema carries is
        // a record of something nothing tests, and it would go stale unnoticed.
        const declared = new Set(
            schemaVendors().flatMap((vendor) => {
                const schema = gen.readSchema(vendor);
                return schema.quirks.map((q) => `${schema.vendor}/${q.id}`);
            }),
        );
        const orphans = gen.readManifest().observations
            .map((o) => `${o.vendor}/${o.quirk}`)
            .filter((key) => !declared.has(key));
        expect(orphans).toEqual([]);
    });
});
