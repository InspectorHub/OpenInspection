import { describe, it, expect } from 'vitest';
import { renderTemplate, listUnresolved } from '../../../server/lib/mustache';

describe('renderTemplate', () => {
    it('substitutes single variable', () => {
        expect(renderTemplate('hello {{name}}', { name: 'world' }))
            .toBe('hello world');
    });

    it('substitutes multiple variables in one pass', () => {
        expect(renderTemplate('{{a}} and {{b}}', { a: 'foo', b: 'bar' }))
            .toBe('foo and bar');
    });

    it('leaves unresolved variables as literal tokens', () => {
        expect(renderTemplate('hello {{name}}', {}))
            .toBe('hello {{name}}');
    });

    it('treats null / undefined values as unresolved (preserves literal)', () => {
        expect(renderTemplate('hello {{name}}', { name: null }))
            .toBe('hello {{name}}');
        expect(renderTemplate('hello {{name}}', { name: undefined }))
            .toBe('hello {{name}}');
    });

    it('renders empty string vars as empty (resolved)', () => {
        expect(renderTemplate('hello {{name}}', { name: '' }))
            .toBe('hello ');
    });

    it('tolerates whitespace inside braces', () => {
        expect(renderTemplate('{{ name }}', { name: 'x' }))
            .toBe('x');
    });

    it('does not recurse into substituted values (no infinite loop)', () => {
        expect(renderTemplate('{{a}}', { a: '{{b}}', b: 'oops' }))
            .toBe('{{b}}');
    });
});

describe('listUnresolved', () => {
    it('returns unique unresolved keys', () => {
        expect(listUnresolved('one {{a}} two {{b}} three {{a}}', { b: 'x' }))
            .toEqual(['a']);
    });

    it('returns empty array when all keys resolve', () => {
        expect(listUnresolved('one {{a}} two {{b}}', { a: 'x', b: 'y' }))
            .toEqual([]);
    });

    it('counts null and undefined values as unresolved', () => {
        const result = listUnresolved('{{a}} {{b}} {{c}}', { a: null, b: undefined });
        expect(result.sort()).toEqual(['a', 'b', 'c']);
    });
});
