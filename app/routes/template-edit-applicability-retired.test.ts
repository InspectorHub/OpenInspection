import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url)); // = <root>/app/routes
const appRoot = path.resolve(here, '..');                  // = <root>/app
const routeSrc = readFileSync(path.join(appRoot, 'routes/template-edit.tsx'), 'utf8');

describe('template editor: section-applicability rail retired (module A)', () => {
  it('no longer imports or renders the applicability panel/preview', () => {
    expect(routeSrc).not.toContain('SectionPropertiesPanel');
    expect(routeSrc).not.toContain('SectionApplicabilityPreview');
    expect(routeSrc).not.toContain('Section applicability');
  });

  it('deletes the retired applicability components', () => {
    expect(existsSync(path.join(appRoot, 'components/template/SectionPropertiesPanel.tsx'))).toBe(false);
    expect(existsSync(path.join(appRoot, 'components/template/SectionApplicabilityPreview.tsx'))).toBe(false);
  });

  it('keeps the property-type identity panel', () => {
    expect(routeSrc).toContain('TemplatePropertyTypePanel');
  });
});
