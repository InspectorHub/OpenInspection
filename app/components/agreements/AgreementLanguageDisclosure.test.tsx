// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { AgreementLanguageDisclosure } from './AgreementLanguageDisclosure';
import { AGREEMENT_LANGUAGE_DISCLOSURE } from '../../../server/lib/legal/agreement-language-disclosure';

// What this file can and cannot settle:
//
// It can check what a reader sees. It CANNOT check which allow-list the mount
// pass uses — DOMPurify under happy-dom drops the outermost element and applies
// no allow-list at all, so a round trip through it proves nothing about a
// browser (measured; see tests/unit/agreements/language-disclosure.spec.ts).
// Worse, the server-sanitized-then-re-sanitized pattern means the wrong
// component would render identical markup on this first pass, so no synchronous
// DOM assertion here can tell the two apart. The sanitizer choice is asserted
// against source in that spec, and confirmed in a real browser.

describe('AgreementLanguageDisclosure', () => {
  it('states the fact, under a heading that says it is not a term', () => {
    const { container } = render(<AgreementLanguageDisclosure />);
    expect(container.textContent).toContain(AGREEMENT_LANGUAGE_DISCLOSURE.label);
    expect(container.textContent).toMatch(/provided in English/i);
    expect(container.textContent).toMatch(/translated before signing/i);
  });

  it('keeps the wrapper that marks it as a note rather than prose', () => {
    const { container } = render(<AgreementLanguageDisclosure />);
    const note = container.querySelector('section[role="note"]');
    expect(note, 'the wrapper is what stops this reading as a loose paragraph').not.toBeNull();
    expect(note!.textContent).toMatch(/provided in English/i);
  });

  it('offers nothing to click and nothing to load', () => {
    // A platform note inside a signing flow is the last place to introduce an
    // outbound link or a remote asset.
    const { container } = render(<AgreementLanguageDisclosure />);
    expect(container.querySelector('a, img, iframe, svg, form')).toBeNull();
  });
});
