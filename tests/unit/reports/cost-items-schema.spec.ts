// tests/unit/reports/cost-items-schema.spec.ts
import { describe, it, expect } from 'vitest';
import { costItems } from '../../../server/lib/db/schema/inspection/cost-items';
import { getTableConfig } from 'drizzle-orm/sqlite-core';

describe('cost_items schema', () => {
  it('is named cost_items and carries tenant_id (not null)', () => {
    const cfg = getTableConfig(costItems);
    expect(cfg.name).toBe('cost_items');
    const tenant = cfg.columns.find((col) => col.name === 'tenant_id');
    expect(tenant).toBeTruthy();
    expect(tenant!.notNull).toBe(true);
  });

  it('has money columns ending in _cents, scope columns, and no foreign keys', () => {
    const cfg = getTableConfig(costItems);
    const names = cfg.columns.map((col) => col.name);
    expect(names).toContain('unit_cost_cents');
    expect(names).toContain('lump_sum_cents');
    expect(names).toContain('unit_id');       // Phase U per-unit scope
    expect(names).toContain('finding_key');   // link to originating finding
    // No .references() FKs allowed (D1 rebuild liability).
    expect(cfg.foreignKeys.length).toBe(0);
  });

  it('models action, cost_method and bucket as enums', () => {
    const cfg = getTableConfig(costItems);
    const enumOf = (n: string) =>
      (cfg.columns.find((col) => col.name === n) as { enumValues?: string[] }).enumValues;
    expect(enumOf('action')).toEqual(['repair', 'replace', 'further_study']);
    expect(enumOf('cost_method')).toEqual(['unit', 'lump_sum']);
    expect(enumOf('bucket')).toEqual(['immediate', 'short_term', 'long_term']);
  });
});
