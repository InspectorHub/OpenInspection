import { describe, it, expect } from 'vitest';
import { appendDeviation, type Deviation } from '../../server/lib/pca-deviations';

const input = {
  area: 'Cost threshold',
  baselineRequirement: 'ASTM E2018 $3,000 reporting threshold',
  deviation: 'Raised to $5,000 per client request',
  reason: 'Client portfolio standard',
};

describe('appendDeviation', () => {
  it('appends to an empty/null store and assigns an id', () => {
    const out = appendDeviation(null, input);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject(input);
    expect(typeof out[0].id).toBe('string');
    expect(out[0].id.length).toBeGreaterThan(0);
  });

  it('does not mutate the input store', () => {
    const store: Deviation[] = [];
    const out = appendDeviation(store, input);
    expect(store).toHaveLength(0);
    expect(out).toHaveLength(1);
    expect(out).not.toBe(store);
  });

  it('is idempotent on an identical disclosure (no duplicate row)', () => {
    const once = appendDeviation([], input);
    const twice = appendDeviation(once, input);
    expect(twice).toHaveLength(1);
  });

  it('appends distinct disclosures', () => {
    const a = appendDeviation([], input);
    const b = appendDeviation(a, { ...input, area: 'Scope reduction' });
    expect(b).toHaveLength(2);
    expect(b.map((d) => d.area)).toEqual(['Cost threshold', 'Scope reduction']);
  });
});
