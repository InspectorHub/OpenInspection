// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
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

describe('MobileDrawer', () => {
  it('Escape closes it and focus returns to the opener', async () => {
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
});
