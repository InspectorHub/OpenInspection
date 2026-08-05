// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { createRoutesStub } from 'react-router';
import { SignCard } from './SignCard';
import type { StepState } from '~/lib/checkout-steps';

// The checkout flow is the other surface a client signs on. Whatever the
// standalone signing page tells a signer about language, this one has to tell
// them too — a disclosure that depends on which link the client happened to
// open is not a disclosure.

function renderCard(state: StepState = 'todo') {
  const Stub = createRoutesStub([
    {
      path: '/',
      Component: () => (
        <SignCard
          agreementName="Standard Agreement"
          content="<p>terms</p>"
          signerName="Jane"
          progress={{ signed: 0, total: 1 }}
          state={state}
          onSigned={() => {}}
        />
      ),
    },
  ]);
  return render(<Stub initialEntries={['/']} />);
}

describe('SignCard — language disclosure', () => {
  it('shows it alongside the snapshot', () => {
    const { container } = renderCard();
    const note = container.querySelector('[data-testid="agreement-language-disclosure"]');
    expect(note).not.toBeNull();
    expect(note!.textContent).toMatch(/provided in English/i);
  });

  it('renders it OUTSIDE the snapshot, not within it', () => {
    const { container } = renderCard();
    const body = container.querySelector('[data-testid="agreement-body"]');
    const note = container.querySelector('[data-testid="agreement-language-disclosure"]');
    expect(body).not.toBeNull();
    expect(body!.contains(note!)).toBe(false);
    expect(body!.textContent?.trim()).toBe('terms');
  });

  it('is still there once this step is done', () => {
    const { container } = renderCard('done');
    expect(container.querySelector('[data-testid="agreement-language-disclosure"]')).not.toBeNull();
  });
});
