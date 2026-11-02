// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MobileDrawerTriggers } from './MobileDrawerTriggers';
import { m } from '../../i18n';

afterEach(cleanup);

describe('MobileDrawerTriggers', () => {
  it('names the navigation landmark', () => {
    render(<MobileDrawerTriggers onOpen={() => {}} />);
    expect(screen.getByRole('navigation', { name: m.editor_mobile_nav_label() })).toBeTruthy();
  });

  it('hides the decorative glyphs from the accessibility tree, so each button is named by its label alone', () => {
    render(<MobileDrawerTriggers onOpen={() => {}} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(4);
    for (const button of buttons) {
      const glyph = button.querySelector('span');
      expect(glyph?.getAttribute('aria-hidden')).toBe('true');
    }
    expect(screen.getByRole('button', { name: m.editor_mobile_drawer_sections() })).toBeTruthy();
  });

  it('draws every tab icon as the same kind of line icon, never as a text glyph or an emoji (an emoji is coloured and drawn by the phone\'s own font, so it looked unlike its neighbours)', () => {
    render(<MobileDrawerTriggers onOpen={() => {}} />);
    for (const button of screen.getAllByRole('button')) {
      const icon = button.querySelector('span')!;
      const svg = icon.querySelector('svg');
      expect(svg, button.textContent ?? '').not.toBeNull();
      expect(svg!.getAttribute('fill')).toBe('none');
      expect(svg!.getAttribute('stroke')).toBe('currentColor');
      expect(icon.textContent).toBe('');
    }
  });

  it('control: the labels are still the only text, so the accessible names did not change', () => {
    render(<MobileDrawerTriggers onOpen={() => {}} />);
    expect(screen.getByRole('button', { name: m.editor_route_drawer_preview() })).toBeTruthy();
    expect(screen.getByRole('button', { name: m.editor_mobile_drawer_items() })).toBeTruthy();
    expect(screen.getByRole('button', { name: m.nav_theme_label() })).toBeTruthy();
  });

  it('marks the page while it is mounted (so floating notices clear it) and unmarks on unmount', () => {
    expect(document.documentElement.hasAttribute('data-mobile-nav')).toBe(false);
    const { unmount } = render(<MobileDrawerTriggers onOpen={() => {}} />);
    expect(document.documentElement.hasAttribute('data-mobile-nav')).toBe(true);
    unmount();
    expect(document.documentElement.hasAttribute('data-mobile-nav')).toBe(false);
  });

  it('two overlapping instances share one mark: unmounting one keeps it, unmounting the last removes it', () => {
    const marked = () => document.documentElement.hasAttribute('data-mobile-nav');
    const first = render(<MobileDrawerTriggers onOpen={() => {}} />);
    const second = render(<MobileDrawerTriggers onOpen={() => {}} />);
    expect(marked()).toBe(true);
    first.unmount();
    expect(marked()).toBe(true);
    second.unmount();
    expect(marked()).toBe(false);
    // CONTROL: the count did not go negative, so a later single instance marks and unmarks normally.
    const third = render(<MobileDrawerTriggers onOpen={() => {}} />);
    expect(marked()).toBe(true);
    third.unmount();
    expect(marked()).toBe(false);
  });

  it('takes its height from the shared layout variable, and the stylesheet lifts the notice offset only while the nav is marked', () => {
    render(<MobileDrawerTriggers onOpen={() => {}} />);
    const nav = screen.getByRole('navigation', { name: m.editor_mobile_nav_label() });
    expect(nav.className).toContain('h-[var(--ih-mobile-nav-h)]');
    const css = readFileSync(join(process.cwd(), 'packages', 'field-ui', 'src', 'theme.css'), 'utf8');
    expect(css).toMatch(/--ih-mobile-nav-h:\s*calc\(3\.5rem \+ env\(safe-area-inset-bottom\)\)/);
    expect(css).toMatch(/:root\[data-mobile-nav\]\s*\{[^}]*--ih-toast-bottom:\s*calc\(var\(--ih-mobile-nav-h\) \+ 1rem\)/);
  });
});
