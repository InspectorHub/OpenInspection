import { describe, it, expect } from 'vitest';
import { EmailTemplateRenderer } from '../../../server/lib/email-templates/renderer';
import type { TemplateOverride } from '../../../server/lib/email-templates/types';

const brands = {
  tenantBrand: { name: 'Acme', logoUrl: null, primaryColor: '#F55A1A' },
  platformBrand: { name: 'OpenInspection', logoUrl: null, primaryColor: '#4f46e5' },
};
function withOverrides(list: TemplateOverride[]) {
  return new EmailTemplateRenderer({ ...brands, overrides: new Map(list.map(o => [o.trigger, o])) });
}

describe('renderer override-merge', () => {
  it('uses an overridden subject + body block', () => {
    const r = withOverrides([{ trigger: 'report-ready', subject: 'Your report for {{address}}', blocks: { body: 'Custom body for {{address}}.' }, enabled: true }]);
    const out = r.render('report-ready', { address: '12 Elm', reportUrl: 'u' });
    expect(out.subject).toBe('Your report for 12 Elm');
    expect(out.html).toContain('Custom body for 12 Elm.');
  });
  it('falls back per-field: null subject keeps default, partial blocks keep other defaults', () => {
    const r = withOverrides([{ trigger: 'report-ready', subject: null, blocks: { heading: 'Hi!' }, enabled: true }]);
    const out = r.render('report-ready', { address: 'A', reportUrl: 'u' });
    expect(out.subject).toBe('Property Inspection Report: A');
    expect(out.html).toContain('Hi!');
    expect(out.html).toContain('View Interactive Report');
  });
  it('enabled:false short-circuits for a non-required trigger', () => {
    const r = withOverrides([{ trigger: 'report-ready', subject: null, blocks: null, enabled: false }]);
    const out = r.render('report-ready', { address: 'A', reportUrl: 'u' });
    expect(out.enabled).toBe(false);
  });
  it('ignores enabled:false for a required trigger (still enabled)', () => {
    const r = withOverrides([{ trigger: 'evidence-pack', subject: null, blocks: null, enabled: false }]);
    const out = r.render('evidence-pack', { clientName: 'Jo', envelopeId: 'E1', verifyUrl: 'u' });
    expect(out.enabled).toBe(true);
  });
  it('escapes overridden block content (no HTML injection)', () => {
    const r = withOverrides([{ trigger: 'report-ready', subject: null, blocks: { body: '<script>x</script>' }, enabled: true }]);
    const out = r.render('report-ready', { address: 'A', reportUrl: 'u' });
    expect(out.html).not.toContain('<script>x</script>');
    expect(out.html).toContain('&lt;script&gt;');
  });
  it('with no overrides map, renders defaults (Phase 2 behavior unchanged)', () => {
    const r = new EmailTemplateRenderer(brands);
    const out = r.render('report-ready', { address: 'A', reportUrl: 'u' });
    expect(out.enabled).toBe(true);
    expect(out.subject).toBe('Property Inspection Report: A');
  });
});
