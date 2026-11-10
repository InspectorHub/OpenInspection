import { describe, expect, it } from 'vitest';
import { assertSafeJson, MAX_JSON_DEPTH, parseJsonStrict, type JsonValue } from '../../../server/lib/data-package/safe-json';

const BS = String.fromCharCode(92);
const esc = (hex: string): string => `${BS}u${hex}`;
const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
};

describe('assertSafeJson', () => {
  it('accepts ordinary values and scalars at the root', () => {
    expect(() => assertSafeJson({ a: [1, 'x', null, true, { b: 1.5 }] })).not.toThrow();
    expect(() => assertSafeJson('plain')).not.toThrow();
    expect(() => assertSafeJson(7)).not.toThrow();
    expect(codeOf(() => assertSafeJson(Number.NaN))).toBe('json_unsafe');
  });

  it('nesting of exactly MAX_JSON_DEPTH containers is accepted and one more is refused (arrays and objects)', () => {
    const arrays = (n: number): JsonValue => (n === 1 ? [] : [arrays(n - 1)]);
    const objects = (n: number): JsonValue => (n === 1 ? {} : { k: objects(n - 1) });
    expect(MAX_JSON_DEPTH).toBe(64);
    expect(() => assertSafeJson(arrays(64))).not.toThrow();
    expect(codeOf(() => assertSafeJson(arrays(65)))).toBe('json_unsafe');
    expect(() => assertSafeJson(objects(64))).not.toThrow();
    expect(codeOf(() => assertSafeJson(objects(65)))).toBe('json_unsafe');
  });

  it('a hostile 100,000-deep array is refused without recursion', () => {
    let deep: JsonValue = [];
    for (let i = 0; i < 100_000; i++) deep = [deep];
    expect(codeOf(() => assertSafeJson(deep))).toBe('json_unsafe');
  });

  it('wide arrays of scalars and of empty containers are walked completely (a bad element at the very end is found)', () => {
    const wide: JsonValue[] = new Array<JsonValue>(1_000_000).fill(0);
    expect(() => assertSafeJson(wide)).not.toThrow();
    wide.push(Number.POSITIVE_INFINITY);
    expect(codeOf(() => assertSafeJson(wide))).toBe('json_unsafe');
    const boxes: JsonValue[] = Array.from({ length: 300_000 }, () => []);
    expect(() => assertSafeJson(boxes)).not.toThrow();
    boxes.push(JSON.parse('{"__proto__":1}') as JsonValue);
    expect(codeOf(() => assertSafeJson(boxes))).toBe('json_unsafe');
  });

  it('finds a bad value in every position of a container (first, middle, last)', () => {
    for (const at of [0, 1, 2]) {
      const list: JsonValue[] = [1, 2, 3];
      list[at] = '\u0000';
      expect(codeOf(() => assertSafeJson(list)), `index ${at}`).toBe('json_unsafe');
    }
  });

  it('refuses NUL and unpaired surrogates in values and keys, accepts valid pairs', () => {
    expect(codeOf(() => parseJsonStrict(`{"a":"${esc('0000')}"}`))).toBe('json_unsafe');
    expect(codeOf(() => parseJsonStrict(`{"${esc('0000')}":1}`))).toBe('json_unsafe');
    expect(codeOf(() => parseJsonStrict(`["${esc('d800')}"]`))).toBe('json_unsafe');
    expect(codeOf(() => parseJsonStrict(`["${esc('dc00')}x"]`))).toBe('json_unsafe');
    expect(codeOf(() => parseJsonStrict(`{"${esc('dc00')}":1}`))).toBe('json_unsafe');
    expect(parseJsonStrict(`["${esc('d83d')}${esc('de00')}"]`)).toEqual([String.fromCodePoint(0x1f600)]);
    expect(parseJsonStrict('[""]')).toEqual(['']);
  });

  it('refuses __proto__ at any depth but allows constructor and prototype as ordinary data keys', () => {
    expect(codeOf(() => parseJsonStrict('{"a":[{"__proto__":{}}]}'))).toBe('json_unsafe');
    expect(parseJsonStrict('{"constructor":1,"prototype":2}')).toEqual({ constructor: 1, prototype: 2 });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('parseJsonStrict maps malformed text to a typed error', () => {
    expect(codeOf(() => parseJsonStrict('{'))).toBe('json_invalid');
  });
});
