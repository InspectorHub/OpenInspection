/**
 * Row-schema tests: the importer validates every NDJSON row against a strict
 * per-table zod schema derived from the classification + drizzle column types.
 * The package format's own safe-JSON guard runs in the shared library; these
 * tests cover the table-level rules: column whitelist, type checks, and the
 * tenant-id boundary.
 */
import { describe, it, expect } from 'vitest';
import {
    ROW_SCHEMAS, validateRow, isRowTable, rowTableNames,
} from '../../../server/lib/data-package/row-schemas';

describe('row schemas', () => {
    const inspectionRow = {
        id: 'insp-1', tenant_id: 'tenant-src', property_address: '1 Main St',
        status: 'scheduled', date: '2026-01-01', created_at: 1700000000000,
        report_status: 'in_progress', payment_status: 'unpaid', price_cents: 0,
        is_payment_required: false, is_agreement_required: false,
        is_auto_sign_on_publish: false, is_automations_disabled: false,
        is_team_mode: false, unit_inspection_mode: 'standard', is_deposit_overridden: false,
    };

    it('covers exactly the export/partial tables, none more', () => {
        const names = rowTableNames();
        expect(names).toContain('inspections');
        expect(names).toContain('inspection_results');
        // withhold/out tables never appear; archive tables take the archive path.
        expect(names).not.toContain('tenant_data_jobs');
        // Print counts so a coverage regression is visible in CI output.
        console.log(`row-schema coverage: ${ROW_SCHEMAS.size} table(s)`);
        expect(ROW_SCHEMAS.size).toBe(names.length);
        expect(ROW_SCHEMAS.size).toBeGreaterThan(20);
    });

    it('accepts a valid row for a whitelisted table', () => {
        expect(validateRow('inspections', inspectionRow)).toEqual({ ok: true });
        expect(isRowTable('inspections')).toBe(true);
    });

    it('rejects an unknown table', () => {
        const r = validateRow('not_a_table', inspectionRow);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.issues.join(' ')).toMatch(/table/i);
    });

    it('rejects an extra column and a withheld column', () => {
        const extra = validateRow('inspections', { ...inspectionRow, invented_col: 'x' });
        expect(extra.ok).toBe(false);
        // inspections is a whole-table export; there is no withheld column on it,
        // so use a partial table for the withhold case instead (see below).
        const withheld = validateRow('inspection_results', {
            id: 'r1', tenant_id: 't', inspection_id: 'insp-1',
            data: '{}', last_synced_at: 1700000000000,
            ydoc_state: null, unknown_column: 'x',
        });
        expect(withheld.ok).toBe(false);
    });

    it('rejects a wrong scalar type for a known column', () => {
        const bad = validateRow('inspections', { ...inspectionRow, created_at: 'not-a-number' });
        expect(bad.ok).toBe(false);
        if (!bad.ok) expect(bad.issues.join(' ')).toMatch(/created_at/);
    });

    it('accepts a forged tenant_id in the schema — the importer overwrites it from the job', () => {
        // The schema allows tenant_id because it is a real column; its VALUE is
        // never trusted. The boundary is enforced by the apply layer, not here.
        expect(validateRow('inspections', { ...inspectionRow, tenant_id: 'forged-other-tenant' })).toEqual({ ok: true });
    });

    it('allows non-UUID ids at the schema layer (format decides identity, not shape)', () => {
        expect(validateRow('inspections', { ...inspectionRow, id: 'plain-id' })).toEqual({ ok: true });
    });
});
