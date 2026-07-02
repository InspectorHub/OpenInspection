import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { SectionPropertiesPanel } from '~/components/template/SectionPropertiesPanel';
import type { TemplateSection } from '~/components/template/types';

const section: TemplateSection = { id: 's1', title: 'Roof', items: [] };

function html(props: Partial<Parameters<typeof SectionPropertiesPanel>[0]> = {}): string {
  return renderToStaticMarkup(createElement(SectionPropertiesPanel, {
    section, updateSection: () => {}, ...props,
  }));
}

describe('SectionPropertiesPanel', () => {
  it('renders a property-type checkbox for each option and both scope radios', () => {
    const out = html();
    for (const v of ['single-family', 'multi-unit', 'commercial']) {
      expect(out).toContain(`data-testid="applies-pt-${v}"`);
    }
    expect(out).toContain('data-testid="scope-common"');
    expect(out).toContain('data-testid="scope-unit"');
  });

  it('hides subtype checkboxes unless commercial is in scope', () => {
    expect(html()).not.toContain('data-testid="applies-sub-office"');
  });

  it('shows subtype checkboxes when the template is commercial', () => {
    expect(html({ templatePropertyType: 'commercial' })).toContain('data-testid="applies-sub-office"');
  });

  it('shows subtype checkboxes when the section itself targets commercial', () => {
    const commercialSection: TemplateSection = { ...section, applicableTo: { propertyTypes: ['commercial'] } };
    expect(html({ section: commercialSection })).toContain('data-testid="applies-sub-office"');
  });

  it('checks the unit radio when defaultScope is unit', () => {
    const unitSection: TemplateSection = { ...section, defaultScope: 'unit' };
    const out = html({ section: unitSection });
    // the unit radio carries the checked attribute
    expect(out).toMatch(/data-testid="scope-unit"[^>]*checked/);
  });
});
