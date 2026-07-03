import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { QuotaBanner } from '~/components/QuotaBanner';

describe('QuotaBanner', () => {
  it('renders nothing below the 80% threshold', () => {
    const { container } = render(
      <QuotaBanner metric="inspections" used={3} cap={5} billingUrl="https://billing.example.com" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders a soft warning at >=80% but below the cap', () => {
    const { getByText } = render(
      <QuotaBanner metric="sms" used={40} cap={50} billingUrl="https://billing.example.com" />,
    );
    expect(getByText(/40 of 50 free SMS messages used/)).toBeTruthy();
    expect(getByText('Upgrade')).toBeTruthy();
  });

  it('renders a hard-block message at the cap', () => {
    const { getByText } = render(
      <QuotaBanner metric="inspections" used={5} cap={5} billingUrl="https://billing.example.com" />,
    );
    expect(getByText(/You've used all 5 free inspections/)).toBeTruthy();
  });

  it('omits the Upgrade link when no billingUrl is provided', () => {
    const { queryByText } = render(
      <QuotaBanner metric="email" used={50} cap={50} />,
    );
    expect(queryByText('Upgrade')).toBeNull();
  });

  it('renders nothing when cap is 0 (non-free/unlimited sentinel)', () => {
    const { container } = render(
      <QuotaBanner metric="email" used={10} cap={0} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
