import { describe, it, expect } from 'vitest';
import { repairBuilderSectionProps } from '../../../../app/components/portal/sections/RepairBuilderSection';

describe('repairBuilderSectionProps', () => {
  it('passes defects + existing list through unchanged (identity, not just length)', () => {
    const defects = [{ findingKey: 'k' }] as any;
    const mine = [{ id: 'r1' }] as any;
    const p = repairBuilderSectionProps({ defects, mine });
    expect(p.defects).toBe(defects);
    expect(p.mine).toBe(mine);
    expect(p.defects[0].findingKey).toBe('k');
    expect(p.mine[0].id).toBe('r1');
  });
});
