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
});
