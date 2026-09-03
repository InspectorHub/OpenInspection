import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..');
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');
const sms = read('server', 'api', 'sms.ts');
const index = read('server', 'index.ts');

describe('inbound provider webhooks are top-level, including the SMS/email family', () => {
  it('registers the two inbound receivers on the webhook router', () => {
    expect(sms).toMatch(/smsWebhookRoutes\.post\('\/sms\/inbound'/);
    expect(sms).toMatch(/smsWebhookRoutes\.post\('\/sms\/inbound\/:tenant'/);
  });

  it('registers the three delegated receivers on the webhook router', () => {
    expect(sms).toContain('registerSmsStatusRoute(smsWebhookRoutes)');
    expect(sms).toContain('registerComplianceStatusRoute(smsWebhookRoutes)');
    expect(sms).toContain('registerEmailEventsRoute(smsWebhookRoutes)');
  });

  it('mounts that router at /webhooks, and keeps the opt-in pages public', () => {
    expect(index).toContain(`.route('/webhooks', smsWebhookRoutes)`);
    // Positive control: the browser-facing opt-in pair must STAY on /api/public.
    expect(sms).toMatch(/smsPublicRoutes[\s\S]*\/sms\/optin-resolve/);
    expect(index).toContain(`.route('/api/public', smsPublicRoutes)`);
  });

  it('leaves no inbound provider webhook under /api/public', () => {
    // Positive control. It reads `smsPublicRoutes` without a trailing dot on
    // purpose: after the split that router is only ever built by chaining off
    // `createApiRouter()`, so `smsPublicRoutes.` appears nowhere and a control
    // written that way would pass by describing a file that no longer exists.
    expect(sms.match(/smsPublicRoutes/g)?.length ?? 0).toBeGreaterThan(0);
    expect(sms).not.toMatch(/smsPublicRoutes\.post\('\/sms\/inbound/);
    expect(sms).not.toContain('registerEmailEventsRoute(smsPublicRoutes)');
  });
});
