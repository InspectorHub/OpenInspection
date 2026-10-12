// @vitest-environment happy-dom
/** Speed Mode sits on the shared layer stack: Escape exits it, and only the top layer answers. */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { SpeedMode } from './SpeedMode';
import { useLayer } from '@core/shared-ui';

const base = {
  item: { id: 'i1', label: 'Flashing', type: 'rich' },
  sectionTitle: 'Roof',
  result: {},
  onRating: () => {},
  onPrev: () => {},
  onNext: () => {},
  currentIndex: 0,
  totalCount: 3,
};

function Above({ onEscape }: { onEscape: () => void }) {
  useLayer(true, { onEscape });
  return null;
}

describe('SpeedMode layer', () => {
  it('Escape exits Speed Mode', () => {
    const onExit = vi.fn();
    render(<SpeedMode {...base} onExit={onExit} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('a layer opened above it takes Escape; Speed Mode stays', () => {
    const onExit = vi.fn();
    const onTop = vi.fn();
    const { rerender } = render(<SpeedMode {...base} onExit={onExit} />);
    rerender(<><SpeedMode {...base} onExit={onExit} /><Above onEscape={onTop} /></>);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onTop).toHaveBeenCalledTimes(1);
    expect(onExit).not.toHaveBeenCalled();
  });

  it('the root is the modal dialog; the coach mark is a status, not a nested dialog', () => {
    localStorage.clear();
    const { container, getByTestId } = render(<SpeedMode {...base} onExit={() => {}} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.getAttribute('role')).toBe('dialog');
    expect(root.getAttribute('aria-modal')).toBe('true');
    expect(root.querySelector(':scope > [data-testid="speedmode-coach"]')?.getAttribute('role') ?? getByTestId('speedmode-coach').getAttribute('role')).toBe('status');
  });
});
