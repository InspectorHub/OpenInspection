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
import { ERASURE_MANIFEST } from '../../../server/lib/compliance/erasure-manifest';
import { ERASURE_OUT_OF_SCOPE } from '../../../server/lib/compliance/erasure-out-of-scope';

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
// The columns PII_HEURISTIC cannot see (external counsel P1, 2026-08-07).
//
// Every key below was found by walking the Drizzle schema table by table, NOT
// by anything going red: `scripts/check-erasure-manifest.mjs` matches none of
// these names, so the gate was green over all of them for as long as they
// existed. Pinning them here is the part a widened regex would not give us — a
// pattern only protects the shapes somebody already thought of, while a listed
// key stays covered even after the next person narrows the pattern.
//
// A new entry belongs here when it was found by READING rather than by a red
// gate. That is the population this file exists to defend.
// ─────────────────────────────────────────────────────────────────────────────
const HEURISTIC_BLIND_SPOTS = [
    // Behavioural counters about an identified recipient. Nothing in the name of
    // any of these says "person", and the table was absent from the manifest
    // entirely — invisible to every check that starts from the manifest.
    'report_views.access_token_id',
    'report_views.view_count',
    'report_views.first_viewed_at',
    'report_views.last_viewed_at',
    'inspection_access_tokens.view_tracking_objected_at',
    // The CRM row. `contacts.phone` was declared and its neighbours were not,
    // which reads as a claim that phone was the only other personal column.
    'contacts.name',
    'contacts.agency',
    'contacts.notes',
    'contacts.locale',
    // An email-address column with neither "email" nor "mail" in its name,
    // sitting two lines from two declared address columns.
    'tenant_configs.reply_to',
    // Tenant-authored free text the pattern has no way to recognise.
    'tenant_configs.repair_quick_phrases',
    // Staff identity beside already-declared staff columns.
    'users.name',
    'report_signoff.name',
    'report_signoff.license',
    'calendar_connections.calendar_id',
    // The heaviest staff-PII blob in the schema, under a column called payload.
    'sync_outbox.payload',
    // Free text on the accountability ledger whose email sibling WAS declared.
    'erasure_log.identity_basis',
    'erasure_log.response_note',
    // #275 — the buyer's requested remedy per line item. Added to the schema and
    // to `erasure-out-of-scope.ts` in the same change, with nothing red on either
    // side of that: the gate pattern matches no part of `repair_action_tag`, so
    // the only thing standing between it and silence is this line.
    'repair_request_items.repair_action_tag',
    // #61 — AI content review evidence. `reviewed_by` is a user id and
    // `artifact_id` is the only route from a review row back to an inspection,
    // and the gate pattern matches neither, so the whole table was invisible to
    // `lint:erasure` from the moment it was written. Only these two of the
    // table's seven columns are pinned: the rest are an opaque key, a scope key,
    // a pointer discriminator and a timestamp, where losing the declaration
    // changes no answer. These two are where a wrong or missing answer would —
    // one names a person, the other names the record the person acted on.
    'ai_content_reviews.reviewed_by',
    'ai_content_reviews.artifact_id',
    // The inspector's report-level narrative. Free prose a person composes about
    // a named person's property — the exact population
    // `docs/compliance/erasure-heuristic-limits.md` says the pattern cannot
    // reach — and it went in with nothing red, the same way
    // `repair_action_tag` did. Its rule is `anonymize`, and the next test pins
    // that it is a rule rather than an exclusion.
    'reports.inspector_narrative',
];

describe('columns the PII heuristic cannot see', () => {
    it.each(HEURISTIC_BLIND_SPOTS)('%s has a rule or a reasoned exclusion', (key) => {
        expect(DECIDED.has(key)).toBe(true);
    });

    it('none of them would be caught by the gate pattern if the declaration went away', () => {
        // The assertion that keeps the list honest. If a key here starts
        // matching PII_HEURISTIC, the gate covers it and it no longer needs a
        // hand-written line — but silently leaving it would grow this file into
        // a duplicate of the gate. Kept in sync with
        // scripts/check-erasure-manifest.mjs on purpose: a copy that drifts is
        // how a test stops testing what its name says.
        const PII_HEURISTIC = /(email|phone|ip_address|user_agent|signature|client_name|full_name|recipient|address)/;
        const stillCovered = HEURISTIC_BLIND_SPOTS
            .map((k) => k.split('.')[1]!)
            .filter((col) => PII_HEURISTIC.test(col) || col === 'ip');
        expect(
            stillCovered,
            `these columns now MATCH the gate pattern, so listing them here is a duplicate: ${stillCovered.join(', ')}`,
        ).toHaveLength(0);
    });

    it('reports.inspector_narrative is cleared on erasure, not excused', () => {
        // Being DECIDED is not enough for this one. It is the only column on
        // `reports` a human composes, and the cheapest way to green would have
        // been an out-of-scope line calling it "the inspector's professional
        // opinion, not the subject's data" — which is true of the words and
        // false of what they contain. Sibling `title` looked exactly like this
        // and its stated reason turned out to be wrong in both halves.
        const rule = ERASURE_MANIFEST.find(
            (r) => r.table === 'reports' && r.column === 'inspector_narrative',
        );
        expect(rule, 'reports.inspector_narrative has no manifest rule').toBeTruthy();
        expect(rule!.action).toBe('anonymize');
        expect(rule!.legalBasis).toBe('art_17_3_e');
        expect(
            ERASURE_OUT_OF_SCOPE.some(
                (e) => e.table === 'reports' && e.column === 'inspector_narrative',
            ),
            'the narrative is declared out of scope. That option was rejected: it is free prose ' +
            'about a named person\'s property, and the PII heuristic can never see it.',
        ).toBe(false);
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

    it.each(RETAINED_ADDRESS_COLUMNS)('%s does not read as implemented', (key) => {
        // The rule is a recorded decision, not a shipped behaviour. Anything
        // rendering the manifest — a DSAR console, an audit export — has to be
        // able to tell those apart, and a `retain` that looks enforced while
        // nothing expires it is exactly the unbounded retain this ruling
        // refused. The gate enforces the same thing; this fails faster.
        const [table, column] = key.split('.');
        const rule = ERASURE_MANIFEST.find((r) => r.table === table && r.column === column);
        expect(rule!.enforcementStatus).toBe('pending');
        expect(
            rule!.enforcementDeadline,
            `${key} is pending with no deadline. Without a date, "pending" becomes permanent.`,
        ).toMatch(/^\d{4}-\d{2}-\d{2}$/);
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
