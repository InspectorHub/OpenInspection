import { describe, it, expect } from 'vitest';
import { resolveSenderIdentity, type EmailIdentityConfig } from '../../../server/lib/email/sender-identity';

const base: EmailIdentityConfig = {
  mode: 'platform',
  senderEmail: null,
  replyTo: null,
  senderDisplayName: 'Acme Inspections',
  pointOfContact: 'company',
  companyName: 'Acme Site',
};

describe('resolveSenderIdentity — Point of Contact', () => {
  it('company: uses display name, never the inspector name', () => {
    const r = resolveSenderIdentity({ ...base, pointOfContact: 'company' }, { name: 'John Doe', email: 'john@gmail.com' });
    expect(r.fromName).toBe('Acme Inspections');
  });
  it('company: falls back to companyName when display name blank', () => {
    const r = resolveSenderIdentity({ ...base, pointOfContact: 'company', senderDisplayName: null }, { name: 'John Doe' });
    expect(r.fromName).toBe('Acme Site');
  });
  it('company: reply-to is the configured reply-to, never the inspector email', () => {
    const r = resolveSenderIdentity({ ...base, pointOfContact: 'company', replyTo: 'office@acme.com' }, { name: 'John', email: 'john@gmail.com' });
    expect(r.replyTo).toBe('office@acme.com');
  });
  it('company: no reply-to when none configured (omitted)', () => {
    const r = resolveSenderIdentity({ ...base, pointOfContact: 'company', replyTo: null }, { name: 'John', email: 'john@gmail.com' });
    expect(r.replyTo).toBeUndefined();
  });
  it('inspector: uses inspector name and inspector email as reply-to', () => {
    const r = resolveSenderIdentity({ ...base, pointOfContact: 'inspector' }, { name: 'John Doe', email: 'john@gmail.com' });
    expect(r.fromName).toBe('John Doe');
    expect(r.replyTo).toBe('john@gmail.com');
  });
  it('inspector: configured reply-to wins over inspector email', () => {
    const r = resolveSenderIdentity({ ...base, pointOfContact: 'inspector', replyTo: 'office@acme.com' }, { name: 'John', email: 'john@gmail.com' });
    expect(r.replyTo).toBe('office@acme.com');
  });
  it('inspector: falls back to display name when no sending inspector', () => {
    const r = resolveSenderIdentity({ ...base, pointOfContact: 'inspector' }, undefined);
    expect(r.fromName).toBe('Acme Inspections');
  });
});
