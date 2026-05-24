import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(__dirname, '../../public/js/editor-fields.js'), 'utf8');

let OIFields: {
    FIELD_RE: RegExp;
    VOCABULARY: Array<{ tag: string; hint: string }>;
    findOpenFields: (text: string) => Array<{ tag: string; index: number; length: number }>;
    hasOpenFields: (text: string) => boolean;
};

beforeAll(() => {
    const window: Record<string, unknown> = {};
    const fn = new Function('window', src);
    fn(window);
    OIFields = window.OIFields as typeof OIFields;
});

describe('OIFields.VOCABULARY', () => {
    it('has 4 entries', () => {
        expect(OIFields.VOCABULARY).toHaveLength(4);
    });

    it('includes LOCATION, DEADLINE, TIMEFRAME, N', () => {
        const tags = OIFields.VOCABULARY.map(v => v.tag);
        expect(tags).toContain('LOCATION');
        expect(tags).toContain('DEADLINE');
        expect(tags).toContain('TIMEFRAME');
        expect(tags).toContain('N');
    });
});

describe('OIFields.findOpenFields', () => {
    it('finds placeholders in text', () => {
        const text = 'Leak at [LOCATION], repair within [TIMEFRAME].';
        const fields = OIFields.findOpenFields(text);
        expect(fields).toHaveLength(2);
        expect(fields[0].tag).toBe('LOCATION');
        expect(fields[1].tag).toBe('TIMEFRAME');
    });

    it('returns empty for text without placeholders', () => {
        expect(OIFields.findOpenFields('No fields here.')).toHaveLength(0);
    });

    it('returns empty for null/empty', () => {
        expect(OIFields.findOpenFields('')).toHaveLength(0);
        expect(OIFields.findOpenFields(null as unknown as string)).toHaveLength(0);
    });

    it('captures index and length', () => {
        const text = 'Found [N] issues.';
        const fields = OIFields.findOpenFields(text);
        expect(fields[0].index).toBe(6);
        expect(fields[0].length).toBe(3);
    });

    it('finds multiple occurrences of same placeholder', () => {
        const text = '[LOCATION] to [LOCATION]';
        const fields = OIFields.findOpenFields(text);
        expect(fields).toHaveLength(2);
    });
});

describe('OIFields.hasOpenFields', () => {
    it('returns true when placeholders exist', () => {
        expect(OIFields.hasOpenFields('Fix [LOCATION] soon.')).toBe(true);
    });

    it('returns false when no placeholders', () => {
        expect(OIFields.hasOpenFields('All clear.')).toBe(false);
    });
});
