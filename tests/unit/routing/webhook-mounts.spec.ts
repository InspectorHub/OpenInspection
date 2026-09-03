import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..');
const index = readFileSync(join(ROOT, 'server', 'index.ts'), 'utf8');
const entry = readFileSync(join(ROOT, 'workers', 'app.ts'), 'utf8');
const jwtAuth = readFileSync(join(ROOT, 'server', 'lib', 'middleware', 'jwt-auth.ts'), 'utf8');
const resolver = readFileSync(
  join(ROOT, 'server', 'features', 'tenant-routing', 'resolve-by-path-param.ts'),
  'utf8',
);

describe('webhook mounts live at the top level, not under /api', () => {
  it('mounts every inbound webhook under /webhooks/', () => {
    expect(index).toContain(`.route('/webhooks/quickbooks', qboWebhookRoutes)`);
    expect(index).toContain(`.route('/webhooks/stripe/:tenant', stripeWebhookRoutes)`);
    expect(index).toContain(`.route('/webhooks/stripe', stripeWebhookRoutes)`);
  });

  it('leaves no inbound webhook mounted under /api/', () => {
    // Positive control: this assertion only means anything if the file really
    // does contain `.route(` calls to look through.
    expect(index.match(/\.route\(/g)?.length ?? 0).toBeGreaterThan(50);
    expect(index).not.toContain(`/api/integrations/qbo/webhook`);
    expect(index).not.toContain(`/api/integrations/stripe/webhook`);
  });

  it('forwards /webhooks/* from the worker entry to the API app', () => {
    expect(entry).toContain(`app.all("/webhooks/*", toApi);`);
  });

  it('marks the new webhook paths public in jwt-auth', () => {
    expect(jwtAuth).toContain(`path.startsWith('/webhooks/')`);
    expect(jwtAuth).not.toContain(`'/api/integrations/stripe/webhook'`);
    expect(jwtAuth).not.toContain(`'/api/integrations/qbo/webhook'`);
  });

  it('resolves the tenant for /webhooks/stripe/:tenant', () => {
    expect(resolver).toContain(`'/webhooks/stripe/'`);
    expect(resolver).not.toContain(`'/api/integrations/stripe/webhook/'`);
  });
});
