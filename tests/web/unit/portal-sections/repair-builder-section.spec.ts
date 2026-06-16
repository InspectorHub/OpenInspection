import { describe, it, expect } from 'vitest';
import { repairBuilderSectionProps } from '../../../../app/components/portal/sections/RepairBuilderSection';

describe('repairBuilderSectionProps', () => {
  it('passes defects + existing list into the builder', () => {
    const p = repairBuilderSectionProps({ defects: [{ findingKey: 'k' }] as any, mine: [] });
    expect(p.defects.length).toBe(1);
    expect(p.mine.length).toBe(0);
  });
});
