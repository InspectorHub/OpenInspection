// @vitest-environment happy-dom
/**
 * Portal #98 item 3 / spec §3.4 — the notice is part of the mechanism.
 *
 * Three things it must do, each asserted: state the ACTUAL unlock time (not
 * "24 hours" relative to something the reader has to compute), name what still
 * works (a vague restriction reads as a broken account), and offer the escape
 * hatch that genuinely exists today.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OutboundCoolingBanner } from './OutboundCoolingBanner';

vi.mock('~/hooks/useSessionContext', () => ({
  useDisplayTimeZone: () => 'America/New_York',
  useChromeDateTimeFormat: () => ({ locale: 'en-US', dateFormat: 'us', timeFormat: '12h' }),
}));

describe('OutboundCoolingBanner', () => {
  it('renders nothing when the window is closed', () => {
    const { container } = render(<OutboundCoolingBanner unlockAtMs={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('states the actual unlock instant, not a relative duration', () => {
    // 2026-08-11 14:00 UTC -> 10:00 AM EDT
    render(<OutboundCoolingBanner unlockAtMs={Date.UTC(2026, 7, 11, 14, 0, 0)} />);
    expect(screen.getByRole('status').textContent).toMatch(/Aug 11, 2026/);
    expect(screen.getByRole('status').textContent).toMatch(/10:00\s?AM/);
  });

  it('names what still works', () => {
    render(<OutboundCoolingBanner unlockAtMs={Date.now() + 3_600_000} />);
    expect(screen.getByRole('status').textContent).toMatch(/inspections/i);
    expect(screen.getByRole('status').textContent).toMatch(/team invitations/i);
  });

  it('points at the BYO escape hatch', () => {
    render(<OutboundCoolingBanner unlockAtMs={Date.now() + 3_600_000} />);
    expect(screen.getByRole('link', { name: /own email provider/i }))
      .toHaveAttribute('href', '/settings/communication');
  });
});
