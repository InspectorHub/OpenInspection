// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReportLightbox } from './ReportLightbox';

describe('ReportLightbox', () => {
  it('is a named modal dialog; Escape and click close it', () => {
    const onClose = vi.fn();
    render(<ReportLightbox url="/p.jpg" onClose={onClose} />);
    const d = screen.getByRole('dialog');
    expect(d.getAttribute('aria-modal')).toBe('true');
    expect(d.getAttribute('aria-label')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(d);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
  it('renders nothing without a url', () => {
    render(<ReportLightbox url={null} onClose={() => {}} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
