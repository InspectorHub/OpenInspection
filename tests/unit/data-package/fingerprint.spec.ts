import { describe, expect, it } from 'vitest';
import { columnSetFingerprint } from '../../../server/lib/data-package/fingerprint';
import { rejectsWithCode } from './helpers';

describe('columnSetFingerprint', () => {
  it('is the sha256 of the sorted table.column lines (pinned value)', async () => {
    // sha256 of "a.x\na.y\nb.z", computed independently with node:crypto when the test was written.
    expect(await columnSetFingerprint({ b: ['z'], a: ['y', 'x'] })).toBe('529b10e0320b2cb957d74a25c0a5487f95f3f935e41174d2657e0d20370ca401');
  });

  it('ignores table and column order, and changes when a column is added, removed or renamed', async () => {
    const base = await columnSetFingerprint({ a: ['x', 'y'], b: ['z'] });
    expect(await columnSetFingerprint({ b: ['z'], a: ['y', 'x'] })).toBe(base);
    expect(await columnSetFingerprint({ a: ['x', 'y', 'w'], b: ['z'] })).not.toBe(base);
    expect(await columnSetFingerprint({ a: ['x'], b: ['z'] })).not.toBe(base);
    expect(await columnSetFingerprint({ a: ['x', 'y2'], b: ['z'] })).not.toBe(base);
    expect(await columnSetFingerprint({ a: ['x', 'y'], c: ['z'] })).not.toBe(base);
  });

  it('does not let a column move between tables unnoticed', async () => {
    expect(await columnSetFingerprint({ a: ['x', 'y'], b: ['z'] })).not.toBe(await columnSetFingerprint({ a: ['x'], b: ['y', 'z'] }));
  });

  it('refuses an empty schema, repeated columns and bad names', async () => {
    await rejectsWithCode(columnSetFingerprint({}), 'fingerprint_invalid');
    await rejectsWithCode(columnSetFingerprint({ a: [] }), 'fingerprint_invalid');
    await rejectsWithCode(columnSetFingerprint({ a: [], b: ['x'] }), 'fingerprint_invalid'); // a table with no columns is not silently dropped
    await rejectsWithCode(columnSetFingerprint({ con: ['x'] }), 'fingerprint_invalid');
    await rejectsWithCode(columnSetFingerprint({ a: ['x', 'x'] }), 'fingerprint_invalid');
    await rejectsWithCode(columnSetFingerprint({ A: ['x'] }), 'fingerprint_invalid');
    await rejectsWithCode(columnSetFingerprint({ a: ['X'] }), 'fingerprint_invalid');
    await rejectsWithCode(columnSetFingerprint({ a: ['x\ny'] }), 'fingerprint_invalid');
  });
});
