// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QuotaBanner } from '~/components/QuotaBanner';

const tz = vi.hoisted(() => ({ value: 'UTC' }));
vi.mock('~/hooks/useSessionContext', () => ({
  useDisplayLocale: () => 'en-US',
  useDisplayTimeZone: () => tz.value,
}));

const RESETS = '2026-12-01T00:00:00.000Z';
const renderBanner = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('QuotaBanner', () => {
  it('renders nothing below the 80% threshold', () => {
    const { container } = renderBanner(<QuotaBanner metric="inspections" used={3} cap={5} resetsAt={RESETS} />);
    expect(container.textContent).toBe('');
  });

  it('renders a soft note at >=80% but below the cap, with the renewal date and no upgrade link', () => {
    const { getByText, queryByText, container } = renderBanner(<QuotaBanner metric="email" used={40} cap={50} resetsAt={RESETS} />);
    expect(getByText(/40 of 50 built-in emails used this month/)).toBeTruthy();
    expect(container.textContent).toMatch(/Resets Dec 1, 2026 \(UTC\)/);
    expect(queryByText('Upgrade')).toBeNull();
  });

  it('renders the at-cap inspection message with the renewal date', () => {
    const { container } = renderBanner(<QuotaBanner metric="inspections" used={5} cap={5} resetsAt={RESETS} />);
    expect(container.textContent).toMatch(/All 5 new inspections for this month are used/);
    expect(container.textContent).toMatch(/\(UTC\)/);
  });

  it('points the email cap at the own-account path', () => {
    const { getByText } = renderBanner(<QuotaBanner metric="email" used={50} cap={50} />);
    expect(getByText('Send from your own email account').getAttribute('href')).toBe('/settings/integrations/email');
  });

  it('also shows the renewal instant in the viewer zone when it is not UTC', () => {
    tz.value = 'America/New_York';
    try {
      const { container } = renderBanner(<QuotaBanner metric="inspections" used={4} cap={5} resetsAt={RESETS} />);
      expect(container.textContent).toMatch(/Resets Dec 1, 2026 \(UTC\)/);
      expect(container.textContent).toMatch(/Nov 30, 2026.*7:00 PM.*your time/);
    } finally { tz.value = 'UTC'; }
  });

  it('omits the renewal line when the server sent none', () => {
    const { container } = renderBanner(<QuotaBanner metric="inspections" used={4} cap={5} />);
    expect(container.textContent).not.toMatch(/Resets/);
  });

  it('renders nothing when cap is 0 (non-free/unlimited sentinel)', () => {
    const { container } = renderBanner(<QuotaBanner metric="email" used={10} cap={0} />);
    expect(container.textContent).toBe('');
  });
});
