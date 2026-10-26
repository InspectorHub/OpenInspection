import { describe, expect, it } from 'vitest';
// @ts-expect-error - plain .mjs script, no type declarations
import { parseDtsExports, surfaceProblems } from '../../../scripts/release-check-field-ui.mjs';

type Surface = { values: string[]; types: string[] };
const surface = (s: Surface) => s;

const DTS = [
  'declare const a = 1;',
  'declare function b(): void;',
  'type T = string;',
  'interface I { x: number }',
  '',
  'export { a, b as renamed };',
  'export type { I, T };',
  '',
].join('\n');

describe('parseDtsExports', () => {
  it('reads value and type names from the trailing export statements, using the exported name of `x as y`', () => {
    expect(parseDtsExports(DTS)).toEqual({ values: ['a', 'renamed'], types: ['I', 'T'] });
  });

  it('reads several statements and inline `type` specifiers', () => {
    const text = 'export { a, type B };\nexport { c };\nexport type { D };\n';
    expect(parseDtsExports(text)).toEqual({ values: ['a', 'c'], types: ['B', 'D'] });
  });

  it('refuses a declaration file with no export statement instead of reading it as an empty surface', () => {
    expect(() => parseDtsExports('declare const a = 1;\n')).toThrow(/no export/);
  });
});

describe('surfaceProblems', () => {
  const expected = surface({ values: ['a', 'renamed'], types: ['I', 'T'] });

  it('is empty when the built surface equals the committed one', () => {
    expect(surfaceProblems(expected, parseDtsExports(DTS))).toEqual([]);
  });

  it('names a value that went missing, a value that appeared, and a type that went missing', () => {
    const missingValue = surfaceProblems({ values: ['a', 'renamed', 'gone'], types: ['I', 'T'] }, parseDtsExports(DTS));
    expect(missingValue).toHaveLength(1);
    expect(missingValue[0]).toMatch(/missing from the build.*gone/);
    const extraValue = surfaceProblems({ values: ['a'], types: ['I', 'T'] }, parseDtsExports(DTS));
    expect(extraValue).toHaveLength(1);
    expect(extraValue[0]).toMatch(/not in api-surface\.json.*renamed/);
    const missingType = surfaceProblems({ values: ['a', 'renamed'], types: ['I', 'T', 'U'] }, parseDtsExports(DTS));
    expect(missingType).toHaveLength(1);
    expect(missingType[0]).toMatch(/type.*U/);
  });

  it('treats an empty committed surface as a failure, not a pass', () => {
    const problems: string[] = surfaceProblems({ values: [], types: [] }, parseDtsExports(DTS));
    expect(problems.length).toBeGreaterThan(0);
    expect(surfaceProblems({ values: [], types: [] }, { values: [], types: [] })[0]).toMatch(/empty/);
  });
});
