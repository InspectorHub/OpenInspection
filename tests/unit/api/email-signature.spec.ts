import { describe, it, expect } from 'vitest';
import { EmailService } from '../../../server/services/email.service';

// signatureFor is private; test via a tiny subclass exposing it.
class T extends EmailService {
  pub(inspector?: unknown, host?: string) { return (this as unknown as { signatureFor: (i?: unknown, h?: string) => string | undefined }).signatureFor(inspector, host); }
}
const svc = new T('key', 'from@x.com', 'Acme');

describe('EmailService.signatureFor', () => {
  it('returns undefined without inspector or host', () => {
    expect(svc.pub(undefined, 'h')).toBeUndefined();
    expect(svc.pub({ name: 'John' }, undefined)).toBeUndefined();
  });
  it('returns undefined when signatureEnabled === false', () => {
    expect(svc.pub({ name: 'John', signatureEnabled: false }, 'host')).toBeUndefined();
  });
  it('returns undefined when there is no name (no half-empty block)', () => {
    expect(svc.pub({ phone: '555', signatureEnabled: true }, 'host')).toBeUndefined();
  });
  it('returns HTML when enabled and named', () => {
    const html = svc.pub({ name: 'John Doe', signatureEnabled: true }, 'host');
    expect(html).toContain('John Doe');
  });
  it('defaults to enabled when the flag is omitted', () => {
    expect(svc.pub({ name: 'John Doe' }, 'host')).toContain('John Doe');
  });
});
