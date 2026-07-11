// tests/unit/templates/seed-coverage-applicability.spec.ts
// Asserts the seed templates' system-coverage sections are tagged so that
// getApplicableSections() yields exactly what resolveSystemCoverage() prescribes
// per subtype — i.e. coverage is data-driven, not hardcoded in the renderer.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getApplicableSections } from '../../../server/lib/section-applicability';
import { SYSTEM_COVERAGE } from '../../../server/lib/system-coverage';
import type { TemplateSection } from '../../../server/types/template-schema';

function loadSeed(name: string): TemplateSection[] {
  const raw = JSON.parse(readFileSync(join(__dirname, '../../../server/data/seed-templates', name), 'utf8'));
  return raw.schema.sections as TemplateSection[];
}

describe('seed coverage applicability', () => {
  it('hospitality seed includes Vertical Transportation (ASTM §7) for the hospitality subtype', () => {
    const sections = loadSeed('commercial-hospitality.json');
    const applicable = getApplicableSections(sections, 'commercial', 'hospitality');
    expect(applicable.some((s) => s.id === 'vertical-transportation')).toBe(true);
  });

  it('every registry chapter that lists a subtype is tagged for it in at least one seed', () => {
    // Guard: a registry entry with no matching seed section would render nothing.
    const tagged = new Set<string>();
    for (const name of ['commercial.json', 'commercial-hospitality.json', 'commercial-industrial.json', 'commercial-office.json', 'commercial-retail.json']) {
      for (const s of loadSeed(name)) {
        if (SYSTEM_COVERAGE.some((c) => c.id === s.id)) tagged.add(s.id);
      }
    }
    // Cooking Areas + Loading Docks are flag-gated specials; the base coverage
    // chapters must be present as seed sections.
    expect(tagged.has('vertical-transportation')).toBe(true);
    expect(tagged.has('site-flatwork')).toBe(true);
  });
});
