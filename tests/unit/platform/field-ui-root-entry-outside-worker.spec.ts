import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The root entry of the editor package (`@core/field-ui`) now exports the editor component and its whole React
 * graph. The Worker must never pull that in: server and page code import the narrow subpaths
 * (`@core/field-ui/shared/*`, `@core/field-ui/editor/FieldEditor`), and the root only as a TYPE import, which the
 * compiler erases. A value import of the root from `app/`, `server/` or `workers/` would put the package's own
 * barrel into the bundle, so it is refused here.
 */
const ROOT = resolve(__dirname, '..', '..', '..');
const SOURCE = /\.(ts|tsx)$/;
// `from '@core/field-ui'` or `import('@core/field-ui')`, exactly the root (no subpath).
const ROOT_IMPORT = /(?:from\s+|import\s*\(\s*)['"]@core\/field-ui['"]/;
const TYPE_ONLY_LINE = /^\s*import\s+type\b|^\s*export\s+type\b/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.react-router' || name === 'build') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (SOURCE.test(name)) out.push(full);
  }
  return out;
}

/** Statements (possibly spanning lines) that import the root entry as a value. */
function valueImportsOfRoot(text: string): string[] {
  const hits: string[] = [];
  for (const m of text.matchAll(/\b(?:import|export)\b(?:(?!\b(?:import|export)\b)[^;])*?['"]@core\/field-ui['"]/g)) {
    const stmt = m[0];
    if (!ROOT_IMPORT.test(stmt)) continue;
    if (TYPE_ONLY_LINE.test(stmt)) continue;
    hits.push(stmt.slice(0, 80));
  }
  return hits;
}

describe('the editor package root entry stays out of the Worker graph', () => {
  it('detects a value import and ignores a type import and a subpath (positive and negative controls)', () => {
    expect(valueImportsOfRoot("import { FieldEditor } from '@core/field-ui';")).toHaveLength(1);
    expect(valueImportsOfRoot("const m = await import('@core/field-ui');")).toHaveLength(1);
    expect(valueImportsOfRoot("import type { CostItemView } from '@core/field-ui';")).toHaveLength(0);
    expect(valueImportsOfRoot("import { findingKey } from '@core/field-ui/shared/finding-key';")).toHaveLength(0);
  });

  it('no file under app/, server/ or workers/ imports the root as a value; prints both numbers', () => {
    const files = ['app', 'server', 'workers'].flatMap((d) => walk(join(ROOT, d)));
    const offenders = files.filter((f) => valueImportsOfRoot(readFileSync(f, 'utf8')).length > 0);
    // Both numbers: an empty file list would read as a pass.
    expect(files.length).toBeGreaterThan(500);
    expect(offenders.map((f) => f.slice(ROOT.length + 1))).toEqual([]);
  });
});
