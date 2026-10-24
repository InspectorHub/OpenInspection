// @vitest-environment happy-dom
/**
 * Speed Mode is a modal dialog: focus moves into it on open, stays inside it, and returns to the control that
 * opened it. Tab and Shift+Tab stay Speed Mode's next/prev shortcuts, so focus is contained rather than wrapped
 * on keydown; the keys that already worked keep working with the dialog focused.
 */
import { useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import { SpeedMode } from './SpeedMode';
import { useKeyboard, type KeyboardHandlers } from '../../hooks/useKeyboard';

afterEach(cleanup);

const base = {
  item: { id: 'i1', label: 'Flashing', type: 'rich' },
  sectionTitle: 'Roof',
  result: {},
  onRating: () => {},
  onPrev: () => {},
  onNext: () => {},
  currentIndex: 1,
  totalCount: 3,
};

function Opener({ spy }: { spy?: Partial<KeyboardHandlers> }) {
  const [open, setOpen] = useState(false);
  useKeyboard({
    onRate: vi.fn(), onClearRating: vi.fn(), onNARating: vi.fn(), onNextItem: vi.fn(), onPrevItem: vi.fn(),
    onToggleSpeed: () => setOpen((v) => !v), speedMode: open,
    showCommentLibrary: false, onPhoto: vi.fn(), onSave: vi.fn(), onPublish: vi.fn(), onCloneLast: vi.fn(),
    onToggleCheatsheet: vi.fn(), onGotoSection: vi.fn(), onOpenSectionPicker: vi.fn(), onOpenTagPicker: vi.fn(),
    onToggleFullscreen: vi.fn(), onExitFullscreen: vi.fn(),
    ...spy,
  });
  return (
    <>
      <button data-testid="opener" onClick={() => setOpen(true)}>Speed</button>
      <button data-testid="outside">Outside</button>
      {open && <SpeedMode {...base} onExit={() => setOpen(false)} />}
    </>
  );
}

function openIt(spy?: Partial<KeyboardHandlers>) {
  localStorage.setItem('oi:speedmode-coached', '1');
  const r = render(<Opener spy={spy} />);
  const opener = r.getByTestId('opener');
  opener.focus();
  fireEvent.click(opener);
  return { ...r, opener };
}

describe('Speed Mode focus', () => {
  it('moves focus into the dialog on open', () => {
    const { getByRole } = openIt();
    const dialog = getByRole('dialog');
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('pulls focus back when it would leave: Tab from the last control wraps to the first', () => {
    const { getByRole, getByTestId } = openIt();
    const dialog = getByRole('dialog');
    const buttons = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled])'));
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    // The browser would now move focus to the next control, which is outside the dialog.
    act(() => { getByTestId('outside').focus(); });
    expect(document.activeElement).toBe(first);
  });

  it('Shift+Tab out of the first control wraps to the last', () => {
    const { getByRole, getByTestId } = openIt();
    const dialog = getByRole('dialog');
    const buttons = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled])'));
    const last = buttons[buttons.length - 1];
    buttons[0].focus();
    fireEvent.keyDown(buttons[0], { key: 'Tab', shiftKey: true });
    act(() => { getByTestId('outside').focus(); });
    expect(document.activeElement).toBe(last);
  });

  it('returns focus to the control that opened it on close', () => {
    const { getByRole, opener } = openIt();
    expect(getByRole('dialog').contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(document.activeElement).toBe(opener);
  });

  it('Tab and Shift+Tab are still next and previous, and the rating keys still work', () => {
    const onSpeedNext = vi.fn();
    const onSpeedPrev = vi.fn();
    const onSpeedRate = vi.fn();
    const onClearRating = vi.fn();
    const onNARating = vi.fn();
    const { getByRole } = openIt({ onSpeedNext, onSpeedPrev, onSpeedRate, onClearRating, onNARating });
    const dialog = getByRole('dialog');
    const buttons = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled])'));
    // At both edges of the dialog, where a wrapping trap would have swallowed the shortcut.
    buttons[buttons.length - 1].focus();
    expect(fireEvent.keyDown(document.activeElement as Element, { key: 'Tab' })).toBe(false);
    expect(onSpeedNext).toHaveBeenCalledTimes(1);
    buttons[0].focus();
    expect(fireEvent.keyDown(document.activeElement as Element, { key: 'Tab', shiftKey: true })).toBe(false);
    expect(onSpeedPrev).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: '3' });
    expect(onSpeedRate).toHaveBeenCalledWith(2);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(onSpeedNext).toHaveBeenCalledTimes(2);
    expect(onSpeedPrev).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(window, { key: '0' });
    fireEvent.keyDown(window, { key: 'N' });
    expect(onClearRating).toHaveBeenCalledTimes(1);
    expect(onNARating).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
