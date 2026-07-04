import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { SectionApplicabilityPreview } from '~/components/template/SectionApplicabilityPreview';
import { sectionApplies } from '../../../server/lib/section-applicability';
import type { TemplateSection } from '../../../server/types/template-schema';

const sections: TemplateSection[] = [
  { id: 'universal', title: 'General', items: [] },
  { id: 'commercial-only', title: 'Elevators', items: [], applicableTo: { propertyTypes: ['commercial'] } },
  { id: 'office-only', title: 'Server Room', items: [], applicableTo: { propertyTypes: ['commercial'], commercialSubtypes: ['office'] } },
  { id: 'residential', title: 'Attic', items: [], applicableTo: { propertyTypes: ['single-family', 'multi-unit'] } },
];

function html(propertyType: string, subtype?: string): string {
  return renderToStaticMarkup(createElement(SectionApplicabilityPreview, {
    sections, initialPropertyType: propertyType, initialCommercialSubtype: subtype,
  }));
}

/** Extract data-applies flags keyed by section id from the rendered markup. */
function flags(markup: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /data-section-id="([^"]+)"[^>]*data-applies="([01])"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markup)) !== null) out[m[1]] = m[2];
  return out;
}

describe('SectionApplicabilityPreview', () => {
  it('matches sectionApplies() exactly for a commercial/office preview', () => {
    const rendered = flags(html('commercial', 'office'));
    for (const s of sections) {
      const expected = sectionApplies(s, 'commercial', 'office') ? '1' : '0';
      expect(rendered[s.id]).toBe(expected);
    }
  });

  it('matches sectionApplies() exactly for a single-family preview', () => {
    const rendered = flags(html('single-family'));
    for (const s of sections) {
      const expected = sectionApplies(s, 'single-family', null) ? '1' : '0';
      expect(rendered[s.id]).toBe(expected);
    }
  });

  it('shows a human badge for each section', () => {
    const out = html('commercial', 'office');
    expect(out).toContain('Applies');
    expect(out).toContain('Hidden');
  });
});
