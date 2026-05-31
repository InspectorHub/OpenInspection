import { describe, it, expect } from 'vitest';
import {
    canEditSection,
    formatSectionHeading,
    buildSectionEditHref,
} from '../../src/lib/report-section-numbering';

/**
 * Competitor parity App.F.4 (Spectora) — auto-numbered section headings
 * + EDIT SECTION hover affordance in the published report viewer.
 */
describe('report-section-numbering', () => {
    describe('canEditSection', () => {
        it('grants edit to owner / admin / inspector', () => {
            expect(canEditSection('owner')).toBe(true);
            expect(canEditSection('admin')).toBe(true);
            expect(canEditSection('inspector')).toBe(true);
        });
        it('denies edit to client / agent / unknown roles', () => {
            expect(canEditSection('agent')).toBe(false);
            expect(canEditSection('client')).toBe(false);
            expect(canEditSection('viewer')).toBe(false);
        });
        it('denies edit when role is null / undefined / empty', () => {
            expect(canEditSection(null)).toBe(false);
            expect(canEditSection(undefined)).toBe(false);
            expect(canEditSection('')).toBe(false);
        });
    });

    describe('formatSectionHeading', () => {
        it('produces 1-based numbering with em-dashed title', () => {
            expect(formatSectionHeading('Roof', 0)).toBe('1 - Roof');
            expect(formatSectionHeading('Heating', 4)).toBe('5 - Heating');
            expect(formatSectionHeading('Electrical', 2)).toBe('3 - Electrical');
        });
        it('trims surrounding whitespace from the title', () => {
            expect(formatSectionHeading('  Roof  ', 0)).toBe('1 - Roof');
        });
        it('falls back to bare number when title is missing', () => {
            expect(formatSectionHeading('', 2)).toBe('3');
            expect(formatSectionHeading(null, 0)).toBe('1');
            expect(formatSectionHeading(undefined, 7)).toBe('8');
            expect(formatSectionHeading('   ', 4)).toBe('5');
        });
        it('floors fractional indexes and clamps negatives to 0', () => {
            expect(formatSectionHeading('Roof', 1.7)).toBe('2 - Roof');
            expect(formatSectionHeading('Roof', -3)).toBe('1 - Roof');
        });
    });

    describe('buildSectionEditHref', () => {
        it('builds the editor deep-link with #section-{id} fragment', () => {
            expect(buildSectionEditHref('insp-123', 'roof'))
                .toBe('/inspections/insp-123/report#section-roof');
            expect(buildSectionEditHref('abc', 'electrical-panel'))
                .toBe('/inspections/abc/report#section-electrical-panel');
        });
    });
});
