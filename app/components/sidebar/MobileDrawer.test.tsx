// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { MobileDrawer } from './MobileDrawer';

vi.mock('~/hooks/useSessionContext', () => ({
  useSessionContext: () => null,
  useCapabilities: () => null,
}));
vi.mock('~/components/LocaleSwitcher', () => ({ LocaleSwitcher: () => null }));
vi.mock('~/components/sidebar/ThemeSegmentControl', () => ({ ThemeSegmentControl: () => null }));

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <MemoryRouter>
      <button data-testid="opener" onClick={() => setOpen(true)}>menu</button>
      <MobileDrawer open={open} onClose={() => setOpen(false)} />
    </MemoryRouter>
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('MobileDrawer', () => {
  it('Escape closes it and focus returns to the opener', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false, media: query, addEventListener() {}, removeEventListener() {},
    }));
    render(<Harness />);
    const opener = screen.getByTestId('opener');
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('true');
    fireEvent.keyDown(window, { key: 'Escape' });
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('closes itself when the viewport reaches lg, where the panel is display:none', async () => {
    let wide = false;
    const listeners = new Set<() => void>();
    vi.stubGlobal('matchMedia', (query: string) => ({
      get matches() { return query === '(min-width: 1024px)' && wide; },
      media: query,
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    }));
    try {
      const { unmount } = render(<Harness />);
      const opener = screen.getByTestId('opener');
      opener.focus();
      fireEvent.click(opener);
      expect(screen.getByRole('dialog')).toBeTruthy();
      expect(document.body.style.overflow).toBe('hidden');
      expect(listeners.size).toBe(1);
      wide = true;
      await act(async () => { listeners.forEach((fn) => fn()); await Promise.resolve(); });
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(document.body.style.overflow).not.toBe('hidden');
      expect(listeners.size).toBe(0);
      unmount();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
