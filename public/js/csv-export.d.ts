/**
 * Type stubs for csv-export.js. Browser-runtime ESM module; the .d.ts
 * sibling lets TypeScript imports (e.g. from vitest unit tests) pick
 * up the function signatures without resorting to // @ts-expect-error.
 */
export function toCsv(rows: Array<Record<string, unknown>>): string;
export function downloadCsv(filename: string, content: string): void;
