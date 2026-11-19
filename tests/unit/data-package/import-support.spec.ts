/** Tests for import settings filtering, HTML sanitization, and the report accumulator. */
import { describe, it, expect } from 'vitest';
import { filterSettings } from '../../../server/lib/data-package/import-settings';
import { sanitizeImportedRow } from '../../../server/lib/data-package/import-sanitize';
import {
    createReport, recordCreated, recordSkipped, recordRejected, addUnique, serializeReport,
} from '../../../server/lib/data-package/import-report';

describe('settings filtering', () => {
    const row = { company_name: 'Acme', email_mode: 'platform', video_mode: 'r2', pdf_show_footer: true };

    it('drops platform-only keys in a standalone target and keeps the rest', () => {
        const r = filterSettings('tenant_configs', row, { hasBilling: false });
        expect(r.kept).toEqual({ company_name: 'Acme', video_mode: 'r2', pdf_show_footer: true });
        expect(r.dropped).toContain('email_mode');
    });

    it('drops self-host-only keys in a hosted target', () => {
        const r = filterSettings('tenant_configs', row, { hasBilling: true });
        expect(r.kept).toHaveProperty('email_mode', 'platform');
        expect(r.dropped).toContain('video_mode');
    });

    it('passes non-settings tables through untouched and never mutates input', () => {
        const original = { company_name: 'Acme' };
        const r = filterSettings('contacts', row, { hasBilling: false });
        expect(r.kept).toBe(row);
        expect(r.dropped).toEqual([]);
        expect(original).toEqual({ company_name: 'Acme' });
    });
});

describe('HTML sanitization', () => {
    it('strips script from an HTML column and leaves plain columns alone', () => {
        const r = sanitizeImportedRow({ body: 'ok<script>alert(1)</script><b>bold</b>', count: 3 });
        expect(r.row.body).not.toMatch(/script|alert/);
        expect(r.row.body).toContain('<b>bold</b>');
        expect(r.row.count).toBe(3);
        expect(r.sanitized).toContain('body');
    });
});

describe('import report', () => {
    it('accumulates counts and codes with no row content', () => {
        const report = createReport();
        recordCreated(report, 'inspections');
        recordCreated(report, 'inspections');
        recordSkipped(report, 'contacts');
        recordRejected(report, { table: 'inspections', sourceId: 'i-9', code: 'missing_parent' });
        addUnique(report, 'droppedSettings', ['email_mode', 'email_mode']);
        expect(report.created.inspections).toBe(2);
        expect(report.skipped.contacts).toBe(1);
        expect(report.rejected).toHaveLength(1);
        expect(report.droppedSettings).toEqual(['email_mode']);
        const json = serializeReport(report);
        expect(json).toContain('missing_parent');
        expect(json).not.toContain('propertyAddress');
    });
});
