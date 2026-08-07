/**
 * Drift guard: asserts every ERASURE_MANIFEST rule is referenced in the
 * erasure-orchestrator.ts source, preventing silent manifest↔orchestrator
 * divergence (fix I-1).
 *
 * The anonymize satellite-PII column set lives in the shared `anonymize-pii.ts`
 * module (consumed by BOTH the orchestrator and the retention sweep so they
 * cannot drift), so the anonymize-column scan binds the orchestrator source AND
 * that shared module.
 *
 * Cross-references:
 *   - Manifest:      server/lib/compliance/erasure-manifest.ts
 *   - Orchestrator:  server/lib/compliance/erasure-orchestrator.ts
 *   - Shared SETs:   server/lib/compliance/anonymize-pii.ts
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
    ERASURE_MANIFEST,
    ERASURE_OUT_OF_SCOPE,
} from '../../../server/lib/compliance/erasure-manifest';

/** snake_case -> camelCase (single underscore groups; does not handle acronyms). */
function toCamelCase(snake: string): string {
    return snake.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

const orchestratorPath = path.resolve(
    __dirname,
    '../../../server/lib/compliance/erasure-orchestrator.ts',
);
const sharedAnonymizePath = path.resolve(
    __dirname,
    '../../../server/lib/compliance/anonymize-pii.ts',
);
// A step the orchestrator delegates rather than inlines (it is at its line
// cap). The orchestrator CALLS it, so the rule is genuinely executed; the
// table/column names it acts on live here, so the drift scan has to read it.
const repairRequestStepPath = path.resolve(
    __dirname,
    '../../../server/lib/compliance/erase-repair-requests.ts',
);
const retentionSweepPath = path.resolve(
    __dirname,
    '../../../server/lib/compliance/retention-sweep.ts',
);
// Anonymize columns are defined in the shared SET module and consumed by the
// orchestrator; scan all of them so the binding holds wherever the columns live.
const orchestratorSource =
    fs.readFileSync(orchestratorPath, 'utf8') +
    fs.readFileSync(sharedAnonymizePath, 'utf8') +
    fs.readFileSync(repairRequestStepPath, 'utf8');

/**
 * A delegated step only counts if the orchestrator actually calls it. Reading
 * the module into the drift scan above would otherwise let a rule pass while
 * its executor sits unreferenced — the "rule that exists but never runs"
 * failure, with the drift guard now helping it hide.
 */
const orchestratorCallsRepairRequestStep = fs
    .readFileSync(orchestratorPath, 'utf8')
    .includes('eraseRepairRequests(');

/** Source with comments stripped, so prose cannot satisfy or trip a scan. */
function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('erasure-manifest coverage', () => {
    it('every anonymize rule column (camelCase) appears in the orchestrator source', () => {
        const anonymizeRules = ERASURE_MANIFEST.filter((r) => r.action === 'anonymize');
        const missing: string[] = [];

        for (const rule of anonymizeRules) {
            const camel = toCamelCase(rule.column);
            if (!orchestratorSource.includes(camel)) {
                missing.push(`${rule.table}.${rule.column} (camelCase: ${camel})`);
            }
        }

        expect(missing, `Orchestrator missing anonymize columns: ${missing.join(', ')}`).toHaveLength(0);
    });

    it('every delete/null rule table is referenced in the orchestrator source', () => {
        const actionRules = ERASURE_MANIFEST.filter(
            (r) => r.action === 'delete' || r.action === 'null',
        );
        // Collect unique tables.
        const tables = [...new Set(actionRules.map((r) => r.table))];
        const missing: string[] = [];

        for (const table of tables) {
            // The orchestrator imports the Drizzle table object whose name is
            // the camelCase form of the DB table name.
            const camel = toCamelCase(table);
            if (!orchestratorSource.includes(camel)) {
                missing.push(`${table} (camelCase: ${camel})`);
            }
        }

        expect(missing, `Orchestrator missing delete/null tables: ${missing.join(', ')}`).toHaveLength(0);
    });

    it('the delegated repair-request step is actually called by the orchestrator', () => {
        expect(
            orchestratorCallsRepairRequestStep,
            'erase-repair-requests.ts is read into the drift scan above. If the orchestrator ' +
            'stops calling eraseRepairRequests(), those rules would still pass the scan while ' +
            'nothing executed them.',
        ).toBe(true);
    });
});

/** table.column pairs that carry a rule OR a reasoned exclusion. */
const DECIDED = new Set([
    ...ERASURE_MANIFEST.map((r) => `${r.table}.${r.column}`),
    ...ERASURE_OUT_OF_SCOPE.map((e) => `${e.table}.${e.column}`),
]);

describe('portal #88 — the repair-request columns', () => {
    // Asserts the ABSENCE of a gap, which is the shape that catches this class
    // of defect: a table entirely missing from the manifest is invisible to any
    // check that starts from the manifest's own entries, and invisible reads
    // exactly like correct.
    it.each([
        'repair_requests.created_by_ref',
        'repair_requests.custom_intro',
        'repair_request_items.note',
        'repair_request_items.comment_snapshot',
    ])('%s has a rule or a reasoned exclusion', (key) => {
        expect(DECIDED.has(key)).toBe(true);
    });

    it('created_by_ref is treated as an identifier, not as an opaque reference', () => {
        // It holds the actor's email on the portal-token path. A rule that
        // merely retained or excluded it would leave the subject's address
        // sitting in a NOT NULL column on a shareable document.
        const rule = ERASURE_MANIFEST.find(
            (r) => r.table === 'repair_requests' && r.column === 'created_by_ref',
        );
        expect(rule?.action).toBe('delete');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// The property address family.
//
// The columns a widened PII heuristic flags. Two of them are a different
// question from the other ten and are settled by exclusion; the rest are
// RETAINED under Art. 17(3)(e) with a bounded window. Classifying the family as
// out of scope was considered and rejected — these tests are what stops that
// decision from being quietly re-made later, because the exclusion is cheaper
// to write and looks identical in a green gate.
// ─────────────────────────────────────────────────────────────────────────────
const INSPECTION_ADDRESS_COLUMNS = [
    'property_address', 'address_place_id', 'address_street', 'address_city',
    'address_state', 'address_zip', 'address_county', 'address_lat', 'address_lng',
];
const RETAINED_ADDRESS_COLUMNS = [
    ...INSPECTION_ADDRESS_COLUMNS.map((c) => `inspections.${c}`),
    'inspection_requests.property_address',
];
const ADDRESS_FAMILY = [
    ...RETAINED_ADDRESS_COLUMNS,
    'inspections.address_geocoded_at',
    'tenant_configs.company_address',
];

describe('the property address family', () => {
    it.each(ADDRESS_FAMILY)('%s is decided', (key) => {
        expect(DECIDED.has(key)).toBe(true);
    });

    it.each(RETAINED_ADDRESS_COLUMNS)('%s is retained, not excluded', (key) => {
        const [table, column] = key.split('.');
        const rule = ERASURE_MANIFEST.find((r) => r.table === table && r.column === column);
        expect(rule, `${key} has no manifest rule`).toBeTruthy();
        expect(rule!.action).toBe('retain');
        expect(rule!.legalBasis).toBe('art_17_3_e');
        expect(
            ERASURE_OUT_OF_SCOPE.some((e) => `${e.table}.${e.column}` === key),
            `${key} is declared out of scope. That option was rejected: a property address on a ` +
            'residential inspection can be where a person lives, so it is retained with a stated ' +
            'basis and a bounded window, never waved through as property data.',
        ).toBe(false);
    });

    it.each(RETAINED_ADDRESS_COLUMNS)('%s states a bounded period', (key) => {
        const [table, column] = key.split('.');
        const rule = ERASURE_MANIFEST.find((r) => r.table === table && r.column === column);
        expect(
            rule!.retention,
            `${key} is retained with no period. "Retained" means for a period; an unbounded ` +
            'retain is the exclusion this ruling rejected, wearing a different label.',
        ).toMatch(/^P\d+Y$/);
    });

    // A TRIPWIRE, not a requirement. Nothing expires an inspection address
    // today, so the rules above record a decision no code acts on, and the
    // manifest says so where the rules are. The day the sweep learns about
    // `inspections`, that notice becomes false — and a false "not yet enforced"
    // is worse than none, because it tells a reader to go looking for a gap
    // that has been closed. This fails then, so the notice cannot outlive it.
    it('the retention sweep does not yet enforce the inspection-record window', () => {
        const sweep = stripComments(fs.readFileSync(retentionSweepPath, 'utf8'));
        expect(
            /\binspections\b/.test(sweep),
            'retention-sweep.ts now references `inspections`. If the sweep expires the property ' +
            'address family, delete the "NOT YET ENFORCED" notice above those rules in ' +
            'erasure-manifest.ts and delete this test. If it references inspections for some ' +
            'other reason, narrow this check rather than removing it — the notice is only ' +
            'honest while nothing acts on the window.',
        ).toBe(false);
    });
});
