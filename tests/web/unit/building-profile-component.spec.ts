// tests/web/unit/building-profile-component.spec.ts
//
// TDD for <BuildingProfile> — the Commercial PCA Phase F fact list rendered at
// the top of ReportView. Uses renderToStaticMarkup (react-dom/server) — this
// branch does not have @testing-library/react installed.

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { BuildingProfile } from '~/components/portal/sections/report/BuildingProfile';
import type { ProfileRow } from '~/components/portal/sections/report/types';

function render(rows: ProfileRow[]): string {
  return renderToStaticMarkup(createElement(BuildingProfile, { rows }));
}

describe('BuildingProfile', () => {
  it('renders nothing when rows are empty', () => {
    const html = render([]);
    expect(html).toBe('');
  });

  it('renders grouped labelled rows with units', () => {
    const html = render([
      { id: 'nra', group: 'physical', label: 'Net rentable area', value: 120000, unit: 'sqft' },
      { id: 'yearBuilt', group: 'identity', label: 'Year built', value: 1998, unit: null },
    ]);
    expect(html).toContain('Net rentable area');
    expect(html).toContain('120000');
    expect(html).toContain('sqft');
    expect(html).toContain('Year built');
  });
});
