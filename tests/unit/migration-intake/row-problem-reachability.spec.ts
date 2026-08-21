/**
 * Which of `describeRowProblem`'s branches a REAL UPLOAD can actually reach.
 *
 * Every case here drives the whole read path a file takes before anybody sees
 * it — `matchAdapter` → `defaultMappingFor` → `buildBundle` →
 * `parseMigrationBundle` → `plannedEntries` → `describeRowProblem` — because
 * the reachability question cannot be answered by reading any one of them. A
 * branch is reachable only if a file can be carried all the way to it, and two
 * separate things used to stop that: the bundle validator refused the whole
 * FILE over one malformed address, and the spreadsheet adapter DROPPED the rows
 * the describer had sentences for.
 *
 * The ruling this spec encodes: a bad row fails the ROW, not the UPLOAD.
 *
 * Every case carries a good row beside the bad one on purpose. "A problem row
 * exists" is equally true of a run where every row is a problem, so each case
 * asserts the good rows stayed good and that the buckets add up to the total.
 */
import { describe, it, expect } from 'vitest';
import {
    buildBundle,
    defaultMappingFor,
    matchAdapter,
    type IntakeMapping,
} from '../../../server/lib/migration-intake/adapters/registry';
import { parseMigrationBundle } from '../../../server/lib/validations/migration-bundle.schema';
import { plannedEntries } from '../../../server/lib/migration-intake/staging-rows';
import { describeRowProblem, type RowProblem } from '../../../server/lib/migration-intake/row-problems';
import type { EntityKind, MigrationBundleV1 } from '../../../server/lib/migration-intake/bundle';
import type { MigrationIntent } from '../../../server/lib/db/schema';

/** What one file produced once it had been read the whole way through. */
interface PipelineResult {
    /** The refusal that stopped the file, or null when it was read. */
    refusedWith: string | null;
    /** Entries the adapter would not carry at all, with the reason each was lost. */
    dropped: { at: string; reason: string }[];
    /** How many entries the source held, as the adapter counted them. */
    readFromSource: number;
    /** One entry per staged row: what it is, and what is wrong with it. */
    staged: { entity: EntityKind; position: number; problem: RowProblem | null }[];
}

const ENTITY_FOR: Record<'contacts.import' | 'members.invite', EntityKind> = {
    'contacts.import': 'contact',
    'members.invite': 'member',
};

/**
 * One upload, read exactly as the product reads it.
 *
 * `remap` stands in for the operator changing an answer in the mapping step —
 * the type column in particular, which `defaultMappingFor` never picks because
 * the type vocabulary is ours rather than the exporting product's.
 */
function runPipeline(
    intent: 'contacts.import' | 'members.invite',
    csv: string,
    remap?: (m: IntakeMapping) => IntakeMapping,
): PipelineResult {
    const source = { fileName: 'export.csv', text: csv };
    const match = matchAdapter(intent as MigrationIntent, source);
    if (!match) return { refusedWith: 'no adapter matched', dropped: [], readFromSource: 0, staged: [] };

    const base = defaultMappingFor(intent, match.inspection, source);
    const mapping = remap ? remap(base) : base;

    const built = buildBundle(match.vendor, source, mapping);
    if (!built.ok) {
        return { refusedWith: built.error.message, dropped: [], readFromSource: 0, staged: [] };
    }

    const parsed = parseMigrationBundle(built.bundle);
    if (!parsed.ok) {
        const kind = ENTITY_FOR[intent];
        const counts = built.bundle.manifest.counts[kind];
        return {
            refusedWith: `That file is not a valid migration bundle. ${parsed.issues.join(' | ')}`,
            dropped: counts.dropped,
            readFromSource: counts.readFromSource,
            staged: [],
        };
    }

    const kind = ENTITY_FOR[intent];
    const bundle: MigrationBundleV1 = parsed.bundle;
    return {
        refusedWith: null,
        dropped: bundle.manifest.counts[kind].dropped,
        readFromSource: bundle.manifest.counts[kind].readFromSource,
        staged: plannedEntries(bundle, kind).map((e) => ({
            entity: e.entity,
            position: e.position,
            problem: describeRowProblem(e.entity, e.payload),
        })),
    };
}

/** The mapping edit that points a contact's type at a column of the file. */
function typeFromColumn(column: string) {
    return (m: IntakeMapping): IntakeMapping => {
        if (m.kind !== 'contacts') throw new Error('expected a contacts mapping');
        return { kind: 'contacts', mapping: { ...m.mapping, type: { column } } };
    };
}

/**
 * The invariant every case shares: nothing is lost silently, and the buckets
 * are mutually exclusive and complete.
 *
 * Asserted per case rather than once, because a run that staged NOTHING would
 * satisfy "some row is a problem" vacuously — and did, for every case below,
 * before the schema stopped voiding whole files.
 */
function expectAccounting(result: PipelineResult, readFromSource: number, problems: number): void {
    expect(result.refusedWith).toBeNull();
    expect(result.readFromSource).toBe(readFromSource);
    expect(result.staged.length + result.dropped.length).toBe(readFromSource);
    const bad = result.staged.filter((r) => r.problem !== null);
    const good = result.staged.filter((r) => r.problem === null);
    expect(bad.length).toBe(problems);
    expect(good.length).toBe(result.staged.length - problems);
}

describe('a bad row fails the row, not the upload', () => {
    it('stages a contact whose address is malformed, and keeps the good one good', () => {
        const result = runPipeline(
            'contacts.import',
            'Full Name,Email\nAlice Ng,alice@example.test\nBob Ray,not-an-address\n',
        );
        expectAccounting(result, 2, 1);
        expect(result.dropped).toEqual([]);
        expect(result.staged[0].problem).toBeNull();
        expect(result.staged[1].problem).toMatchObject({
            field: 'email',
            value: 'not-an-address',
        });
        expect(result.staged[1].problem?.reason).toMatch(/does not look like an email address/);
    });

    it('stages a contact with no name rather than dropping it', () => {
        const result = runPipeline(
            'contacts.import',
            'Full Name,Email\nAlice Ng,alice@example.test\n,bob@example.test\n',
        );
        expectAccounting(result, 2, 1);
        expect(result.dropped).toEqual([]);
        expect(result.staged[1].problem).toMatchObject({ field: 'name' });
    });

    it('stages a contact whose type is not one of ours, and offers a suggestion', () => {
        const result = runPipeline(
            'contacts.import',
            'Full Name,Email,Kind\nAlice Ng,alice@example.test,client\nBob Ray,bob@example.test,Buyer\n',
            typeFromColumn('Kind'),
        );
        expectAccounting(result, 2, 1);
        expect(result.dropped).toEqual([]);
        expect(result.staged[1].problem).toMatchObject({
            field: 'type',
            value: 'Buyer',
            suggestion: 'client',
        });
    });

    it('stages a member whose address is malformed', () => {
        const result = runPipeline(
            'members.invite',
            'Email,Role\nalice@example.test,inspector\nnope,inspector\n',
        );
        expectAccounting(result, 2, 1);
        expect(result.dropped).toEqual([]);
        expect(result.staged[1].problem).toMatchObject({ field: 'email', value: 'nope' });
    });

    it('stages a member row with no address at all', () => {
        const result = runPipeline(
            'members.invite',
            'Email,Role\nalice@example.test,inspector\n,manager\n',
        );
        expectAccounting(result, 2, 1);
        expect(result.dropped).toEqual([]);
        expect(result.staged[1].problem?.reason).toMatch(/no email address/);
    });

    it('stages a member row asking for the agent role, with its own sentence', () => {
        const result = runPipeline(
            'members.invite',
            'Email,Role\nalice@example.test,inspector\nbob@example.test,agent\n',
        );
        expectAccounting(result, 2, 1);
        expect(result.dropped).toEqual([]);
        expect(result.staged[1].problem).toMatchObject({
            field: 'role',
            value: 'agent',
            suggestion: 'inspector',
        });
        expect(result.staged[1].problem?.reason).toMatch(/per inspection/);
    });

    it('stages a member row whose role is not one we grant', () => {
        const result = runPipeline(
            'members.invite',
            'Email,Role\nalice@example.test,inspector\nbob@example.test,supervisor\n',
        );
        expectAccounting(result, 2, 1);
        expect(result.dropped).toEqual([]);
        expect(result.staged[1].problem).toMatchObject({ field: 'role', value: 'supervisor' });
    });

    it('leaves a clean file entirely clean — the positive control for all seven', () => {
        const result = runPipeline(
            'contacts.import',
            'Full Name,Email\nAlice Ng,alice@example.test\nBob Ray,bob@example.test\n',
        );
        expectAccounting(result, 2, 0);
        expect(result.dropped).toEqual([]);
    });

    it('still DROPS a row with nothing in any mapped column, and says so', () => {
        const result = runPipeline(
            'contacts.import',
            'Full Name,Email\nAlice Ng,alice@example.test\n,\n',
        );
        expectAccounting(result, 2, 0);
        expect(result.dropped).toHaveLength(1);
        expect(result.dropped[0].reason).toMatch(/empty/);
        expect(result.staged).toHaveLength(1);
    });
});
