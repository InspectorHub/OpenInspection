import { describe, it, expect } from 'vitest';
import {
  PCA_SECTION_REGISTRY,
  gatedSectionRegistry,
  type PcaSectionEntry,
} from '../../server/lib/pca-section-registry';

const ids = (entries: readonly PcaSectionEntry[]) => entries.map((e) => e.id);

describe('PCA_SECTION_REGISTRY', () => {
  it('emits the canonical front-matter order: transmittal + systems-summary before the PCA summary page', () => {
    const order = ids(PCA_SECTION_REGISTRY);
    expect(order.indexOf('transmittal-letter')).toBeLessThan(order.indexOf('systems-summary'));
    expect(order.indexOf('systems-summary')).toBeLessThan(order.indexOf('pca-summary'));
    expect(order.indexOf('pca-summary')).toBeLessThan(order.indexOf('toc'));
  });

  it('names the five ES subsections 1.1-1.5 in order under SUMMARY', () => {
    const order = ids(PCA_SECTION_REGISTRY);
    expect(order.filter((id) => id.startsWith('summary.'))).toEqual([
      'summary.general-description',
      'summary.physical-condition',
      'summary.opinion-of-cost',
      'summary.deviations',
      'summary.recommendations',
    ]);
  });

  it('puts Limitations & Exceptions inside INTRODUCTION (not at the end) and has NO standalone methodology chapter', () => {
    const order = ids(PCA_SECTION_REGISTRY);
    expect(order).toContain('introduction.limitations-exceptions');
    // limitations sits before the system chapters
    expect(order.indexOf('introduction.limitations-exceptions')).toBeLessThan(order.indexOf('site'));
    // methodology is folded into scope-of-work, never its own entry
    expect(order.some((id) => id.includes('methodology'))).toBe(false);
    expect(order).toContain('introduction.scope-of-work');
  });

  it('includes the Phase-S structural sections', () => {
    const order = ids(PCA_SECTION_REGISTRY);
    for (const id of ['transmittal-letter', 'systems-summary', 'document-review', 'additional-considerations']) {
      expect(order).toContain(id);
    }
  });

  it('gates transmittal + systems-summary out of the light tier', () => {
    const light = ids(gatedSectionRegistry('light'));
    expect(light).not.toContain('transmittal-letter');
    expect(light).not.toContain('systems-summary');
    expect(light).toContain('summary'); // body sections still present
    const full = ids(gatedSectionRegistry('full'));
    expect(full).toContain('transmittal-letter');
    expect(full).toContain('systems-summary');
  });
});
