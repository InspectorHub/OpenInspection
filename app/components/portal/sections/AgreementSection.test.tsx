// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { createRoutesStub } from 'react-router';
import { AgreementSection, type AgreementData } from './AgreementSection';

// IA-46 — the e-sign value proposition has two halves: "signs" and "can be
// independently verified later". The verify page was only ever reachable by
// hand-pasting the envelope id. The Hub agreement section must surface the
// /verify/:envelopeId link once this signer has signed.

function signed(overrides: Partial<AgreementData> = {}): AgreementData {
  return {
    status: 'signed',
    envelopeId: 'env-123',
    clientName: 'Jane',
    agreementName: 'Standard Agreement',
    agreementContent: '<p>terms</p>',
    signer: { name: 'Jane', role: 'client', status: 'signed' },
    progress: { signed: 1, total: 1 },
    completionPolicy: 'all',
    ...overrides,
  };
}

function renderSection(agreement: AgreementData) {
  const Stub = createRoutesStub([
    {
      path: '/',
      Component: () => (
        <AgreementSection agreement={agreement} error={null} token="tok" actionPath="/sign" />
      ),
    },
  ]);
  return render(<Stub initialEntries={['/']} />);
}

describe('AgreementSection — verify link (IA-46)', () => {
  it('renders the /verify/:envelopeId link once signed', () => {
    const { container } = renderSection(signed());
    const link = container.querySelector('a[href="/verify/env-123"]');
    expect(link).not.toBeNull();
  });

  it('points at the verify PAGE, never the JSON API surface', () => {
    const { container } = renderSection(signed());
    const link = container.querySelector('a[href^="/verify/"]') as HTMLAnchorElement | null;
    expect(link?.getAttribute('href')).toBe('/verify/env-123');
    expect(container.querySelector('a[href*="/api/"]')).toBeNull();
  });

  it('omits the verify link when the envelope id is absent (older payloads)', () => {
    const { container } = renderSection(signed({ envelopeId: null }));
    expect(container.querySelector('a[href^="/verify/"]')).toBeNull();
  });

  it('does not render the verify link before this signer has signed', () => {
    const pending = signed({
      status: 'sent',
      signer: { name: 'Jane', role: 'client', status: 'sent' },
      progress: { signed: 0, total: 1 },
    });
    const { container } = renderSection(pending);
    expect(container.querySelector('a[href^="/verify/"]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Language disclosure — beside the agreement, never inside it.
// ---------------------------------------------------------------------------

function unsigned(): AgreementData {
  return signed({
    status: 'sent',
    signer: { name: 'Jane', role: 'client', status: 'sent' },
    progress: { signed: 0, total: 1 },
  });
}

describe('AgreementSection — language disclosure', () => {
  it('shows it to a signer who has not signed yet', () => {
    const { container } = renderSection(unsigned());
    const note = container.querySelector('[data-testid="agreement-language-disclosure"]');
    expect(note).not.toBeNull();
    expect(note!.textContent).toMatch(/provided in English/i);
  });

  it('still shows it after signing — the screen keeps saying what the record says', () => {
    const { container } = renderSection(signed());
    expect(container.querySelector('[data-testid="agreement-language-disclosure"]')).not.toBeNull();
  });

  it('renders it OUTSIDE the agreement body, not within it', () => {
    // "Append it at render" and "append it to the body" look identical on a
    // screenshot and are completely different legally: the body is the tenant's
    // contract, which we write no word of. Nesting is the failure this catches.
    const { container } = renderSection(unsigned());
    const body = container.querySelector('[data-testid="agreement-body"]');
    const note = container.querySelector('[data-testid="agreement-language-disclosure"]');
    expect(body).not.toBeNull();
    expect(note).not.toBeNull();
    expect(body!.contains(note!)).toBe(false);
    expect(body!.textContent).not.toMatch(/provided in English/i);
  });

  it('leaves the agreement content itself untouched', () => {
    const { container } = renderSection(unsigned());
    const body = container.querySelector('[data-testid="agreement-body"]');
    expect(body!.textContent?.trim()).toBe('terms');
  });
});
