/**
 * Multi-unit inspections live on `inspection_units`, NOT on the template.
 *
 * WHY THIS TEST EXISTS, which is the only reason it is worth its weight.
 *
 * A field-level census found four keys on `TemplateSchemaV2` that the `.strict()`
 * validator refuses — `structure`, `sectionAssignments`, `itemAssignments`,
 * `propertyMetadataFields` — and the conclusion drawn from that refusal was
 * "multi-unit is an unbuilt subsystem". The next step would have been to build
 * it, on top of a working one.
 *
 * A validator refusing a field proves the FIELD is unused. It proves nothing at
 * all about the capability the field describes, which can be — and here is —
 * complete on a different data model:
 *
 *   DB       `inspection_units` (per inspection, `parent_unit_id` for the
 *            building -> unit hierarchy) and `inspections.unit_inspection_mode`
 *   service  `server/services/unit.service.ts`
 *   editor   `UnitsManager`, mounted in `app/routes/inspection-edit.tsx`
 *   report   `PerUnitReportBlock`, rendered from `ReportView.tsx`
 *   template section-level `defaultScope: 'common' | 'unit'`, already accepted
 *            by the validator
 *
 * So this pins two different kinds of fact. The schema half is ordinary. The
 * MOUNT half is the one that matters: a component that exists and is rendered
 * by nothing looks identical, from a type or a schema, to one that is wired —
 * and it was the mounting that settled the question.
 */
import fs from 'node:fs';
import path from 'node:path';

import { describe, it, expect } from 'vitest';

import { inspections, inspectionUnits } from '../../../server/lib/db/schema';

const APP = path.join(process.cwd(), 'app');

function source(rel: string): string {
    return fs.readFileSync(path.join(APP, rel), 'utf8');
}

describe('the live multi-unit model', () => {
    it('is a per-inspection table carrying a parent pointer', () => {
        const cols = Object.keys(inspectionUnits);
        expect(cols).toContain('inspectionId');
        expect(cols).toContain('parentUnitId');
    });

    it('is selected by a mode on the inspection, not by a template key', () => {
        expect(Object.keys(inspections)).toContain('unitInspectionMode');
    });

    /**
     * The editor really opens it. Read as source text because the assertion is
     * about the MOUNT — importing the route would prove the module parses, which
     * is exactly what an unmounted component also does.
     */
    it('is reachable from the editor', () => {
        const editor = source('routes/inspection-edit.tsx');
        expect(editor).toContain('UnitsManager');
        expect(editor).toMatch(/<UnitsManager/);
    });

    it('is rendered in the report', () => {
        const report = source('components/portal/sections/ReportView.tsx');
        expect(report).toMatch(/<PerUnitReportBlock/);
    });

    /**
     * POSITIVE CONTROL for the two source reads above. If `source()` silently
     * returned something that contained everything — or if `toContain` were
     * being handed a value that matches anything — the mount assertions would
     * pass against an unmounted component just as happily.
     */
    it('does not find a component that is not there', () => {
        const editor = source('routes/inspection-edit.tsx');
        expect(editor).not.toContain('NoSuchUnitsManagerXyz');
        expect(editor.length).toBeGreaterThan(1000);
    });
});
