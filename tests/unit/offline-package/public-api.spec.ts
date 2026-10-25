import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as api from '@core/offline-package';

/**
 * The published surface of @inspectorhub/offline-package. A native client installs the package from npm,
 * so an export that appears or disappears here is a change to a public contract: it must be a decision,
 * not a side effect of editing a `export *` line. Update this list on purpose, in the same commit.
 */
const VALUE_EXPORTS = [
  'APPLIED_RECORD_RETENTION_DAYS',
  'APPLIED_RECORD_SWEEP_BATCH',
  'BACKOFF_BASE_MS',
  'BACKOFF_CAP_MS',
  'DEFAULT_IMPORT_LIMITS',
  'IMPORT_LIMIT_CEILINGS',
  'MAX_ATTEMPTS_PER_PART',
  'MAX_RETRY_WINDOW_MS',
  'MediaIndexSchema',
  'OFFLINE_ID_PATTERN',
  'OfflinePackageManifestSchema',
  'OutboxEntrySchema',
  'OutboxSchema',
  'PACKAGE_MAX_AGE_DAYS',
  'PACKAGE_MAX_FUTURE_SKEW_DAYS',
  'PackageFormatError',
  'classifyResponse',
  'extractHeldBackPackage',
  'parsePackage',
  'planParts',
  'readPackageSummary',
  'runImport',
  'splitPackage',
];

const TYPE_EXPORTS = [
  'Classified',
  'HeldBack',
  'HeldBackReason',
  'ImportLimitName',
  'ImportLimits',
  'ImportOptions',
  'ImportReport',
  'MediaIndex',
  'NeedsAttention',
  'OfflinePackageManifest',
  'OutboxEntry',
  'PackageSummary',
  'ParseOptions',
  'ParsedPackage',
  'Part',
  'PartLimits',
  'PartPlan',
  'Send',
  'SendResult',
  'SplitResult',
];

/** Pure: what is in `actual` but not `expected` and the reverse. */
function diff(expected: string[], actual: string[]): { missing: string[]; extra: string[] } {
  return { missing: expected.filter((n) => !actual.includes(n)), extra: actual.filter((n) => !expected.includes(n)) };
}

describe('@inspectorhub/offline-package public API', () => {
  it('exports exactly the listed values, and prints both numbers', () => {
    const actual = Object.keys(api).sort();
    // Both numbers: an empty module would read as a pass against an empty list, so the count is pinned too.
    expect([actual.length, VALUE_EXPORTS.length]).toEqual([23, 23]);
    expect(diff(VALUE_EXPORTS, actual)).toEqual({ missing: [], extra: [] });
    expect(actual).toEqual([...VALUE_EXPORTS].sort());
  });

  it('every listed value is really defined (a re-export of nothing would still appear as a key)', () => {
    const record = api as Record<string, unknown>;
    for (const name of VALUE_EXPORTS) expect(record[name], name).toBeDefined();
  });

  it('the comparison itself fails on a removed or an added export (positive control)', () => {
    expect(diff(VALUE_EXPORTS, VALUE_EXPORTS.filter((n) => n !== 'runImport'))).toEqual({ missing: ['runImport'], extra: [] });
    expect(diff(VALUE_EXPORTS, [...VALUE_EXPORTS, 'leaked'])).toEqual({ missing: [], extra: ['leaked'] });
  });

  it('the committed api-surface.json (checked against the build by release-check) lists the same names', () => {
    const file = join(resolve(__dirname, '..', '..', '..'), 'packages', 'offline-package', 'api-surface.json');
    const committed = JSON.parse(readFileSync(file, 'utf8')) as { loadable: boolean; values: string[]; types: string[] };
    expect(committed.loadable).toBe(true);
    expect(committed.values).toEqual([...VALUE_EXPORTS].sort());
    expect(committed.types).toEqual([...TYPE_EXPORTS].sort());
  });

  it('exports the listed types, read from the index source (types are erased at runtime)', () => {
    const root = resolve(__dirname, '..', '..', '..', 'packages', 'offline-package');
    const text = readFileSync(join(root, 'index.ts'), 'utf8');
    const names = new Set<string>();
    for (const m of text.matchAll(/export type \{([^}]*)\}/g)) {
      for (const n of m[1]!.split(',')) if (n.trim() !== '') names.add(n.trim());
    }
    // `export type { ... }` lines in index.ts, plus the interfaces and aliases that `export *` re-exports from limits and manifest.
    for (const file of ['src/limits.ts', 'src/manifest.ts']) {
      const src = readFileSync(join(root, file), 'utf8');
      for (const m of src.matchAll(/^export (?:interface|type) (\w+)/gm)) names.add(m[1]!);
    }
    expect([names.size, TYPE_EXPORTS.length]).toEqual([20, 20]);
    expect(diff(TYPE_EXPORTS, [...names])).toEqual({ missing: [], extra: [] });
  });
});
