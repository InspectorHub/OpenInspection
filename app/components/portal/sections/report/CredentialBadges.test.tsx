import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { CredentialBadges } from './CredentialBadges';

const creds = [
  { label: 'InterNACHI CPI', memberNumber: '12345', imageUrl: '/api/public/brand-asset?key=t%2Fcredentials%2Fc1%2Flogo-a.png' },
  { label: 'TX License', memberNumber: '22841', imageUrl: null }, // text-only
];

describe('CredentialBadges', () => {
  it('renders images for image creds and text for text-only creds', () => {
    const { container, getByText } = render(<CredentialBadges credentials={creds} layout="strip" />);
    expect(container.querySelectorAll('img').length).toBe(1);
    expect(getByText(/TX License/)).toBeTruthy();
  });

  it('empty credentials renders nothing', () => {
    const { container } = render(<CredentialBadges credentials={[]} layout="strip" />);
    expect(container.firstChild).toBeNull();
  });

  it('drops an unfilled row (no image, blank label) — no stray separator', () => {
    const { container } = render(
      <CredentialBadges credentials={[{ label: '  ', memberNumber: null, imageUrl: null }]} layout="strip" />,
    );
    expect(container.firstChild).toBeNull();
  });
});
