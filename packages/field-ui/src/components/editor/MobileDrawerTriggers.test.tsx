// @vitest-environment happy-dom
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
});
