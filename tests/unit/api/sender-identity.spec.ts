import { describe, it, expect } from 'vitest';
import { resolveSenderIdentity } from '../../../server/lib/email/sender-identity';

const base = {
  mode: 'platform' as const,
  senderEmail: null,
  replyTo: null,
  senderDisplayName: 'Acme Inspections',
  useInspectorFromName: false,
  siteName: 'Acme',
};

describe('resolveSenderIdentity', () => {
  it('uses the configured display name and reply-to when the toggle is off', () => {
    const r = resolveSenderIdentity({ ...base, replyTo: 'hi@acme.com' });
    expect(r.fromName).toBe('Acme Inspections');
    expect(r.replyTo).toBe('hi@acme.com');
  });

  it('falls back to siteName when no display name is set', () => {
    const r = resolveSenderIdentity({ ...base, senderDisplayName: null });
    expect(r.fromName).toBe('Acme');
  });

  it('uses the inspector name + email when the toggle is on and an inspector is present', () => {
    const r = resolveSenderIdentity(
      { ...base, useInspectorFromName: true },
      { name: 'Jane Doe', email: 'jane@acme.com' },
    );
    expect(r.fromName).toBe('Jane Doe');
    expect(r.replyTo).toBe('jane@acme.com');
  });

  it('explicit replyTo wins over the inspector email even with the toggle on', () => {
    const r = resolveSenderIdentity(
      { ...base, useInspectorFromName: true, replyTo: 'team@acme.com' },
      { name: 'Jane Doe', email: 'jane@acme.com' },
    );
    expect(r.replyTo).toBe('team@acme.com');
    expect(r.fromName).toBe('Jane Doe');
  });

  it('returns undefined fromName/replyTo when nothing is configured', () => {
    const r = resolveSenderIdentity({ ...base, senderDisplayName: null, siteName: null });
    expect(r.fromName).toBeUndefined();
    expect(r.replyTo).toBeUndefined();
  });

  it('ignores a blank inspector name with the toggle on', () => {
    const r = resolveSenderIdentity(
      { ...base, useInspectorFromName: true },
      { name: '  ', email: null },
    );
    expect(r.fromName).toBe('Acme Inspections');
    expect(r.replyTo).toBeUndefined();
  });
});
