import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { InspectionHubSchema } from '../../../server/lib/validations/inspection/read';

/**
 * `ReportRow` in the hub's reports card is a hand-written mirror of the
 * `reports` entry of `InspectionHubSchema`. A hand-written mirror of a payload
 * rots silently in one direction: the server keeps sending a field, the card's
 * type never mentions it, and the compiler is happy because a wider object is
 * assignable to a narrower one. That is how `hasNarrative` — carried by the
 * schema and by `listReportsForHub` — was invisible to the card.
 *
 * The card cannot be typechecked from a server-side spec (it is a .tsx pulling
 * React, the router and the route module behind it), and an interface leaves
 * nothing behind at runtime to inspect. So this reads the declaration as text
 * and compares its field NAMES against the schema's. Names, not types: the
 * question this answers is "does the frontend know the field exists at all",
 * which is the half that goes wrong.
 *
 * Deleting the mirror in favour of `z.infer` would make this spec unnecessary —
 * that is the better end state, and this spec is what keeps the interim honest.
 */
const CARD_PATH = fileURLToPath(new URL('../../../app/components/inspector-portal/ReportsCard.tsx', import.meta.url));

function declaredReportRowFields(): string[] {
    const source = readFileSync(CARD_PATH, 'utf8');
    // The line-break alternation is not decoration. core.autocrlf is true in
    // this repo, so a fresh Windows clone checks this .tsx out with Windows
    // line endings, and a pattern that only accepts Unix ones matches
    // nothing: the parse yields no fields and the guard below reports an
    // honest-looking "interface not found". CI runs on Linux, so it would
    // never show there.
    const body = /export interface ReportRow \{\r?\n([\s\S]*?)\r?\n\}/.exec(source)?.[1];
    // A rename or a reshape must fail loudly here rather than yield an empty
    // set that trivially "matches" nothing — an empty result would read as
    // green while checking nothing at all.
    expect(body, `ReportRow interface not found in ${CARD_PATH}`).toBeTruthy();
    const fields = [...(body as string).matchAll(/^ {4}([A-Za-z_$][\w$]*)\??:/gm)].map((m) => m[1]);
    expect(fields.length, 'parsed zero fields out of the ReportRow declaration').toBeGreaterThan(0);
    return fields;
}

/**
 * Fields `ReportRow` carries that the hub payload does NOT, because the loader
 * joins them in from a second request.
 *
 * `translationState` costs a content hash per report, and the hub is the page's
 * one aggregate round trip — so it is fetched separately and merged in
 * `inspector-portal.tsx`. That is a deliberate design decision, stated at the
 * merge site, not drift.
 *
 * This list must stay SHORT and each entry must be justified where it is
 * merged. It is an exemption from the mirror rule, and an exemption nobody
 * argues for is how the rule stops meaning anything.
 */
const LOADER_JOINED = ['translationState'];

describe('ReportRow mirrors the hub schema reports entry', () => {
    it('declares every field the schema puts on the wire', () => {
        // The direction that rots silently: the server keeps sending a field
        // and the card's type never mentions it, while the compiler stays happy
        // because a wider object is assignable to a narrower one.
        const schemaFields = Object.keys(InspectionHubSchema.shape.reports.element.shape);
        expect(schemaFields.length).toBeGreaterThan(0);
        const declared = new Set(declaredReportRowFields());
        expect(schemaFields.filter((f) => !declared.has(f))).toEqual([]);
    });

    it('carries nothing beyond the schema except what the loader joins in', () => {
        // The other direction, which used to be covered by asserting exact
        // equality. Equality broke the moment a field was deliberately fetched
        // outside the hub, and loosening it to a one-way check would have
        // retired the half that catches an invented field. So the extras are
        // enumerated instead of allowed.
        const schemaFields = new Set(Object.keys(InspectionHubSchema.shape.reports.element.shape));
        const extras = declaredReportRowFields().filter((f) => !schemaFields.has(f));
        expect(extras.sort()).toEqual([...LOADER_JOINED].sort());
    });

    it('drops an exemption once the field joins the payload', () => {
        // The positive control on the list above. If `translationState` ever
        // becomes a hub field, the exemption must be DELETED rather than left
        // behind — a stale entry would go on excusing a field that no longer
        // needs excusing, and would hide the next one that does.
        const schemaFields = new Set(Object.keys(InspectionHubSchema.shape.reports.element.shape));
        expect(LOADER_JOINED.filter((f) => schemaFields.has(f))).toEqual([]);
    });

    it('knows about the narrative flag the server sends', () => {
        expect(declaredReportRowFields()).toContain('hasNarrative');
    });
});
