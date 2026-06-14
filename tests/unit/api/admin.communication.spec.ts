import { describe, it, expect } from 'vitest';
import { validateCommunicationPatch } from '../../../server/api/admin';

describe('validateCommunicationPatch', () => {
  it('rejects company mode with blank reply-to', () => {
    expect(validateCommunicationPatch({ pointOfContact: 'company', replyTo: '' }))
      .toEqual({ ok: false, error: 'Reply-to is required when the Point of Contact is your company.' });
  });
  it('rejects company mode with whitespace-only reply-to', () => {
    expect(validateCommunicationPatch({ pointOfContact: 'company', replyTo: '   ' }))
      .toEqual({ ok: false, error: 'Reply-to is required when the Point of Contact is your company.' });
  });
  it('accepts company mode with a reply-to', () => {
    expect(validateCommunicationPatch({ pointOfContact: 'company', replyTo: 'office@acme.com' }))
      .toEqual({ ok: true });
  });
  it('accepts inspector mode with blank reply-to', () => {
    expect(validateCommunicationPatch({ pointOfContact: 'inspector', replyTo: '' }))
      .toEqual({ ok: true });
  });
});
