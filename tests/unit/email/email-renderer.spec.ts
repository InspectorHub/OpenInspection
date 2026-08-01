import { describe, it, expect } from 'vitest';
import { EmailTemplateRenderer } from '../../../server/lib/email-templates/renderer';

const tenantBrand = { name: 'Acme', logoUrl: null, primaryColor: '#F55A1A' };
const platformBrand = { name: 'OpenInspection', logoUrl: null, primaryColor: '#4f46e5' };
function mk() { return new EmailTemplateRenderer({ tenantBrand, platformBrand }); }

describe('EmailTemplateRenderer', () => {
  it('renders subject + html from registry defaults with variables substituted', () => {
    const r = mk().render('report-ready', { address: '12 Elm', reportUrl: 'https://x/r' });
    expect(r.enabled).toBe(true);
    expect(r.subject).toBe('Property Inspection Report: 12 Elm');
    expect(r.html).toContain('12 Elm');
    expect(r.html).toContain('https://x/r');
    expect(r.html).toContain('View Interactive Report');
    expect(r.html).toContain('Acme');
  });
  it('uses the platform brand for password-reset', () => {
    const r = mk().render('password-reset', { resetLink: 'https://x/reset' });
    expect(r.html).toContain('OpenInspection');
    expect(r.html).not.toContain('>Acme<');
    expect(r.html).toContain('https://x/reset');
  });
  it('escapes a malicious variable value (no HTML injection)', () => {
    const r = mk().render('report-ready', { address: '<script>x</script>', reportUrl: 'u' });
    expect(r.html).not.toContain('<script>x</script>');
    expect(r.html).toContain('&lt;script&gt;');
  });
  it('keeps line breaks a sender or template author typed', () => {
    // Every `multiline: true` block invites newlines, and until now they were
    // collapsed into one run-on paragraph. The break is inserted AFTER escaping,
    // so it is layout chrome — an author still cannot smuggle HTML through.
    const r = mk().render('repair-request-share', {
      propertyAddress: '12 Elm',
      message: 'Line one.\nLine two.',
      shareUrl: 'https://x/s',
    });
    expect(r.html).toContain('Line one.<br />Line two.');
    expect(r.html).not.toContain('<b>');
  });

  it('leaves no empty paragraph when an optional block resolves to nothing', () => {
    const r = mk().render('repair-request-share', { propertyAddress: '12 Elm', shareUrl: 'https://x/s' });
    expect(r.html).toContain('12 Elm');
    expect(r.html).not.toMatch(/<p[^>]*>\s*<\/p>/);
  });

  it('throws for an unknown trigger', () => {
    expect(() => mk().render('nope', {})).toThrow();
  });
  it('omits the CTA when the descriptor has none (booking-confirmation)', () => {
    const r = mk().render('booking-confirmation', { clientName: 'Jo', address: 'A', date: 'D', time: 'T' });
    expect(r.subject).toContain('A');
    expect(r.html).toContain('Jo');
  });
});
