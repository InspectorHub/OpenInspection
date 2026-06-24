import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { sectionIconFor } from '~/components/editor/section-icons';

/**
 * Per-section icon lookup — verifies that `sectionIconFor` returns an inline
 * SVG carrying the correct `data-icon` category attribute without requiring
 * pixel-level inspection.
 */

function iconKey(el: React.ReactElement): string | null {
  const html = renderToStaticMarkup(el);
  const match = html.match(/data-icon="([^"]+)"/);
  return match ? match[1] : null;
}

describe('sectionIconFor — known section keywords (case-insensitive)', () => {
  it('matches roof sections', () => {
    expect(iconKey(sectionIconFor('Roof'))).toBe('roof');
    expect(iconKey(sectionIconFor('roof covering'))).toBe('roof');
    expect(iconKey(sectionIconFor('ROOF DRAINAGE'))).toBe('roof');
  });

  it('matches electrical sections', () => {
    expect(iconKey(sectionIconFor('Electrical'))).toBe('electrical');
    expect(iconKey(sectionIconFor('electrical panel'))).toBe('electrical');
  });

  it('matches HVAC sections', () => {
    expect(iconKey(sectionIconFor('HVAC'))).toBe('hvac');
    expect(iconKey(sectionIconFor('Heating & Cooling'))).toBe('hvac');
  });

  it('matches plumbing sections', () => {
    expect(iconKey(sectionIconFor('Plumbing'))).toBe('plumbing');
    expect(iconKey(sectionIconFor('water supply'))).toBe('plumbing');
  });

  it('matches exterior sections', () => {
    expect(iconKey(sectionIconFor('Exterior'))).toBe('exterior');
    expect(iconKey(sectionIconFor('siding and trim'))).toBe('exterior');
  });

  it('matches interior sections', () => {
    expect(iconKey(sectionIconFor('Interior'))).toBe('interior');
    expect(iconKey(sectionIconFor('Bedrooms'))).toBe('interior');
  });

  it('matches kitchen sections', () => {
    expect(iconKey(sectionIconFor('Kitchen'))).toBe('kitchen');
  });

  it('matches bathroom sections', () => {
    expect(iconKey(sectionIconFor('Bathrooms'))).toBe('bathroom');
    expect(iconKey(sectionIconFor('Master Bath'))).toBe('bathroom');
  });

  it('matches attic sections', () => {
    expect(iconKey(sectionIconFor('Attic'))).toBe('attic');
  });

  it('matches crawlspace sections', () => {
    expect(iconKey(sectionIconFor('Crawlspace'))).toBe('crawlspace');
    expect(iconKey(sectionIconFor('crawl space'))).toBe('crawlspace');
  });

  it('matches foundation sections', () => {
    expect(iconKey(sectionIconFor('Foundation'))).toBe('foundation');
    expect(iconKey(sectionIconFor('Basement'))).toBe('foundation');
  });

  it('matches garage sections', () => {
    expect(iconKey(sectionIconFor('Garage'))).toBe('garage');
  });

  it('matches structural sections', () => {
    expect(iconKey(sectionIconFor('Structural'))).toBe('structural');
  });

  it('matches safety sections', () => {
    expect(iconKey(sectionIconFor('Safety'))).toBe('safety');
    expect(iconKey(sectionIconFor('Smoke Detectors'))).toBe('safety');
  });

  it('matches summary sections', () => {
    expect(iconKey(sectionIconFor('Summary'))).toBe('summary');
  });
});

describe('sectionIconFor — fallback', () => {
  it('falls back to a neutral glyph for unknown sections', () => {
    expect(iconKey(sectionIconFor('Zorptastic Section'))).toBe('generic');
    expect(iconKey(sectionIconFor(''))).toBe('generic');
    expect(iconKey(sectionIconFor('misc-notes'))).toBe('generic');
  });
});
