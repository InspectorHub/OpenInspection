import { describe, it, expect } from 'vitest';

describe('Sidebar', () => {
  it('exports Sidebar and MobileHeader', async () => {
    // Basic smoke test that the module loads
    const mod = await import('~/components/Sidebar');
    expect(mod.Sidebar).toBeDefined();
    expect(mod.MobileHeader).toBeDefined();
  });
});
