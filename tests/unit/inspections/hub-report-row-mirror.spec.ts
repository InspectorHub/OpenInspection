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
    const body = /export interface ReportRow \{\n([\s\S]*?)\n\}/.exec(source)?.[1];
    // A rename or a reshape must fail loudly here rather than yield an empty
    // set that trivially "matches" nothing — an empty result would read as
    // green while checking nothing at all.
    expect(body, `ReportRow interface not found in ${CARD_PATH}`).toBeTruthy();
    const fields = [...(body as string).matchAll(/^ {4}([A-Za-z_$][\w$]*)\??:/gm)].map((m) => m[1]);
    expect(fields.length, 'parsed zero fields out of the ReportRow declaration').toBeGreaterThan(0);
    return fields;
}

describe('ReportRow mirrors the hub schema reports entry', () => {
    it('declares every field the schema puts on the wire', () => {
        const schemaFields = Object.keys(InspectionHubSchema.shape.reports.element.shape);
        expect(schemaFields.length).toBeGreaterThan(0);
        expect([...declaredReportRowFields()].sort()).toEqual([...schemaFields].sort());
    });

    it('knows about the narrative flag the server sends', () => {
        expect(declaredReportRowFields()).toContain('hasNarrative');
    });
});
