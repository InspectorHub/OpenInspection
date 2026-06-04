import { describe, it, expect } from 'vitest';
import { EmailLayout } from '../../../server/lib/email-templates/layout';

const brand = { name: 'Acme Inspections', logoUrl: null, primaryColor: '#F55A1A' };

describe('EmailLayout', () => {
  it('renders heading + paragraphs + branded footer', () => {
    const html = EmailLayout({ brand, heading: 'Report Ready', paragraphs: ['First line.', 'Second line.'] });
    expect(html).toContain('Report Ready');
    expect(html).toContain('First line.');
    expect(html).toContain('Second line.');
    expect(html).toContain('Acme Inspections');
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
  });

  it('renders the CTA button with the primary color and url', () => {
    const html = EmailLayout({ brand, heading: 'H', paragraphs: [], cta: { label: 'View Report', url: 'https://x/y' } });
    expect(html).toContain('https://x/y');
    expect(html).toContain('View Report');
    expect(html).toContain('#F55A1A');
  });

  it('omits the CTA block when no cta given', () => {
    const html = EmailLayout({ brand, heading: 'H', paragraphs: ['p'] });
    expect(html).not.toContain('<a ');
  });

  it('renders a logo img when logoUrl is set, else the wordmark', () => {
    const withLogo = EmailLayout({ brand: { ...brand, logoUrl: 'https://x/logo.png' }, heading: 'H', paragraphs: [] });
    expect(withLogo).toContain('https://x/logo.png');
  });

  it('renders a system block (audit metadata) when provided', () => {
    const html = EmailLayout({ brand, heading: 'H', paragraphs: [], systemHtml: '<div class="audit">Signed: now</div>' });
    expect(html).toContain('Signed: now');
  });

  it('appends signatureHtml when provided', () => {
    const html = EmailLayout({ brand, heading: 'H', paragraphs: [], signatureHtml: '<div>sig</div>' });
    expect(html).toContain('<div>sig</div>');
  });

  it('escapes brand.name to prevent HTML injection', () => {
    const html = EmailLayout({ brand: { name: '</span><script>x</script>', logoUrl: null, primaryColor: '#000' }, heading: 'H', paragraphs: [] });
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
