import { describe, it, expect } from 'vitest';
import { normalizeStoredJson, normalizeStoredObject } from '../../../server/lib/stored-json';

const DOC = { title: 'T', sections: [{ id: 's1', items: [] }] };

describe('normalizeStoredJson', () => {
    it('returns a stored object unchanged', () => {
        expect(normalizeStoredJson(DOC)).toStrictEqual(DOC);
    });
    it('unwraps one layer of string wrapping', () => {
        expect(normalizeStoredJson(JSON.stringify(DOC))).toStrictEqual(DOC);
    });
    it('unwraps two layers of string wrapping', () => {
        expect(normalizeStoredJson(JSON.stringify(JSON.stringify(DOC)))).toStrictEqual(DOC);
    });
    it('answers null for text that is not JSON', () => {
        expect(normalizeStoredJson('not json {')).toBeNull();
    });
    it('answers null for a string still wrapped after two layers', () => {
        expect(normalizeStoredJson(JSON.stringify(JSON.stringify(JSON.stringify(DOC))))).toBeNull();
    });
    it('passes null and non-string scalars through', () => {
        expect(normalizeStoredJson(null)).toBeNull();
        expect(normalizeStoredJson(7)).toBe(7);
    });
});

describe('normalizeStoredObject', () => {
    it('accepts an object in either stored shape', () => {
        expect(normalizeStoredObject(DOC)).toStrictEqual(DOC);
        expect(normalizeStoredObject(JSON.stringify(JSON.stringify(DOC)))).toStrictEqual(DOC);
    });
    it('rejects arrays, scalars and null', () => {
        expect(normalizeStoredObject([1])).toBeNull();
        expect(normalizeStoredObject('[1]')).toBeNull();
        expect(normalizeStoredObject(5)).toBeNull();
        expect(normalizeStoredObject(null)).toBeNull();
    });
});
