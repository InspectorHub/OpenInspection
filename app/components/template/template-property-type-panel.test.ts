import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { TemplatePropertyTypePanel } from '~/components/template/TemplatePropertyTypePanel';

function html(props: Parameters<typeof TemplatePropertyTypePanel>[0]): string {
  return renderToStaticMarkup(createElement(TemplatePropertyTypePanel, props));
}

describe('TemplatePropertyTypePanel', () => {
  it('renders the property-type select with all three options', () => {
    const out = html({ onChange: () => {} });
    expect(out).toContain('data-testid="template-property-type"');
    for (const v of ['single-family', 'multi-unit', 'commercial']) {
      expect(out).toContain(`value="${v}"`);
    }
  });

  it('hides the subtype select unless propertyType is commercial', () => {
    expect(html({ propertyType: 'single-family', onChange: () => {} }))
      .not.toContain('data-testid="template-commercial-subtype"');
  });

  it('shows the subtype select with platform presets when commercial', () => {
    const out = html({ propertyType: 'commercial', onChange: () => {} });
    expect(out).toContain('data-testid="template-commercial-subtype"');
    expect(out).toContain('value="office"');
    expect(out).toContain('value="mixed-use"');
  });
});
