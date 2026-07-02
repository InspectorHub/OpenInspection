// tests/unit/pca-render-order.spec.ts
import { describe, it, expect } from 'vitest';
import { PCA_SECTION_REGISTRY, gatedSectionRegistry } from '../../server/lib/pca-section-registry';

const ids = PCA_SECTION_REGISTRY.map((e) => e.id);

describe('PCA render order (spec §7 regression guard)', () => {
  it('Limitations is up front in §2, before the system chapters and before the end', () => {
    const lim = ids.indexOf('introduction.limitations-exceptions');
    expect(lim).toBeGreaterThan(ids.indexOf('introduction'));
    expect(lim).toBeLessThan(ids.indexOf('site'));
    expect(lim).toBeLessThan(ids.length - 1); // not last
  });

  it('there is no standalone Methodology chapter', () => {
    expect(ids.some((id) => id.toLowerCase().includes('methodology'))).toBe(false);
  });

  it('all Phase-S structural sections are present', () => {
    for (const id of ['transmittal-letter', 'systems-summary', 'document-review', 'additional-considerations', 'summary.deviations']) {
      expect(ids).toContain(id);
    }
  });

  it('light tier omits PCA-only front matter; full tier includes it', () => {
    const light = gatedSectionRegistry('light').map((e) => e.id);
    const full = gatedSectionRegistry('full').map((e) => e.id);
    expect(light).not.toContain('transmittal-letter');
    expect(light).not.toContain('systems-summary');
    expect(full).toContain('transmittal-letter');
    expect(full).toContain('systems-summary');
  });
});
