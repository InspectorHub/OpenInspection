/**
 * shared-ui FileDropzone — pure logic layer (the rendering + drag states are
 * Chrome-verified; happy-dom has no component-render harness in this repo).
 */
import { describe, it, expect } from 'vitest';
import { firstFileFromDrop, formatFileSize, truncateMiddle } from '../../../packages/shared-ui/src/FileDropzone';

describe('firstFileFromDrop', () => {
    it('returns the first file of a drop DataTransfer', () => {
        const file = new File(['x'], 'a.csv', { type: 'text/csv' });
        const dt = { files: [file] } as unknown as DataTransfer;
        expect(firstFileFromDrop(dt)).toBe(file);
    });

    it('returns null for empty or missing DataTransfer', () => {
        expect(firstFileFromDrop(null)).toBeNull();
        expect(firstFileFromDrop({ files: [] } as unknown as DataTransfer)).toBeNull();
    });
});

describe('formatFileSize', () => {
    it('formats bytes, KB, and MB at sensible precision', () => {
        expect(formatFileSize(0)).toBe('0 B');
        expect(formatFileSize(512)).toBe('512 B');
        expect(formatFileSize(7025)).toBe('6.9 KB');
        expect(formatFileSize(245_760)).toBe('240 KB');
        expect(formatFileSize(1_572_864)).toBe('1.5 MB');
    });
});

describe('truncateMiddle', () => {
    it('keeps short names intact and middle-truncates long ones, preserving the extension', () => {
        expect(truncateMiddle('a.csv', 28)).toBe('a.csv');
        const long = 'really-long-spectora-export-2026-06-07-final-v2.xlsx';
        const out = truncateMiddle(long, 28);
        expect(out.length).toBeLessThanOrEqual(28);
        expect(out).toMatch(/^really-long/);
        expect(out).toMatch(/\.xlsx$/);
        expect(out).toContain('…');
    });
});
