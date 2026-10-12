// @vitest-environment happy-dom
/** The publish gate is a real dialog on the shared stack: named, and Escape closes it. */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PublishGateModal } from './PublishGateModal';
import type { PublishReadiness } from '../../lib/types';

const defect = {
  sectionTitle: 'Roof', itemLabel: 'Flashing', cannedTitle: 'Loose flashing',
  missing: ['photo'], unresolvedTokens: [],
};
const readiness = { ready: false, blockingDefects: [defect], warningDefects: [] } as unknown as PublishReadiness;

describe('PublishGateModal', () => {
  it('opens as a named dialog and Escape calls onClose', () => {
    const onClose = vi.fn();
    render(<PublishGateModal open readiness={readiness} onClose={onClose} onJump={() => {}} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy();
    expect(dialog.textContent).toContain('Loose flashing');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when ready with no warnings', () => {
    const ready = { ready: true, blockingDefects: [], warningDefects: [] } as unknown as PublishReadiness;
    render(<PublishGateModal open readiness={ready} onClose={() => {}} onJump={() => {}} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
