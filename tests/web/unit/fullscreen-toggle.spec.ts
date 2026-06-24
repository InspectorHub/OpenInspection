import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { FullscreenToggle } from '~/components/editor/FullscreenToggle';

/**
 * FullscreenToggle — verifies the toggle button renders correct aria-pressed
 * state and an accessible label mentioning "fullscreen".
 */

describe('FullscreenToggle', () => {
  it('renders a button with aria-pressed="false" when active=false', () => {
    const html = renderToStaticMarkup(
      createElement(FullscreenToggle, { active: false, onToggle: () => {} }),
    );
    expect(html).toContain('<button');
    expect(html).toContain('aria-pressed="false"');
  });

  it('renders a button with aria-pressed="true" when active=true', () => {
    const html = renderToStaticMarkup(
      createElement(FullscreenToggle, { active: true, onToggle: () => {} }),
    );
    expect(html).toContain('<button');
    expect(html).toContain('aria-pressed="true"');
  });

  it('has a title or aria-label mentioning "fullscreen" (case-insensitive)', () => {
    const htmlInactive = renderToStaticMarkup(
      createElement(FullscreenToggle, { active: false, onToggle: () => {} }),
    );
    const htmlActive = renderToStaticMarkup(
      createElement(FullscreenToggle, { active: true, onToggle: () => {} }),
    );
    expect(htmlInactive.toLowerCase()).toMatch(/fullscreen/);
    expect(htmlActive.toLowerCase()).toMatch(/fullscreen/);
  });
});
