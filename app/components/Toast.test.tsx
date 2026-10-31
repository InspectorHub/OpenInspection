// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { act, render, cleanup } from '@testing-library/react';
import { ToastPortal } from '~/components/Toast';
import { pushToast } from '~/hooks/useToast';

afterEach(cleanup);

describe('ToastPortal', () => {
  it('renders a warning toast with the DS amber (ih-watch) accent, not the error (ih-bad) one', () => {
    const { getByText } = render(<ToastPortal />);
    act(() => {
      pushToast({ message: 'Saved, but the copy failed', variant: 'warning', durationMs: 10_000 });
    });
    const card = getByText('Saved, but the copy failed').parentElement as HTMLElement;
    expect(card.className).toContain('border-l-ih-watch');
    expect(card.className).not.toContain('border-l-ih-bad');
    expect(card.className).not.toContain('border-l-ih-ok');
  });

  it('renders an error toast with the ih-bad accent', () => {
    const { getByText } = render(<ToastPortal />);
    act(() => {
      pushToast({ message: 'Save failed', variant: 'error', durationMs: 10_000 });
    });
    const card = getByText('Save failed').parentElement as HTMLElement;
    expect(card.className).toContain('border-l-ih-bad');
  });

  it('sits at the shared notice offset: 1rem by default (desktop), lifted above the bottom nav only when the stylesheet sets the variable', () => {
    const { getByText } = render(<ToastPortal />);
    act(() => {
      pushToast({ message: 'Where am I', variant: 'error', durationMs: 10_000 });
    });
    const stack = getByText('Where am I').parentElement?.parentElement as HTMLElement;
    expect(stack.className).toContain('bottom-[var(--ih-toast-bottom,1rem)]');
    // CONTROL: the old fixed offset is gone, so nothing pins the stack at 1rem under a phone nav.
    expect(stack.className).not.toMatch(/(^|\s)bottom-4(\s|$)/);
  });

  it('stacks above the full-screen studio overlays (cropper z-70, annotator and speed mode z-100) and below the transient shortcuts HUD', () => {
    const { getByText } = render(<ToastPortal />);
    act(() => {
      pushToast({ message: 'Visible over a cropper', variant: 'error', durationMs: 10_000 });
    });
    const stack = getByText('Visible over a cropper').parentElement?.parentElement as HTMLElement;
    const z = Number(/(?:^|\s)z-\[(\d+)\]/.exec(stack.className)?.[1] ?? /(?:^|\s)z-(\d+)/.exec(stack.className)?.[1]);
    expect(z).toBeGreaterThan(100);
    expect(z).toBeLessThan(200); // the route progress bar (z-200) and the shortcuts HUD stay above a notice
  });
});
