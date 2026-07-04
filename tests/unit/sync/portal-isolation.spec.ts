// apps/openinspection/tests/unit/sync/portal-isolation.spec.ts
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';

/**
 * Shell-free `git grep -l` returning matching paths ([] when none).
 * execFileSync avoids the platform shell entirely — the previous
 * `execSync("git grep ... || true")` form broke on Windows (cmd.exe has no
 * `true`, and its quoting mangled patterns containing escaped quotes).
 * git grep exits 1 on "no matches", which is a result here, not an error.
 */
function gitGrepFiles(pattern: string, ...pathspecs: string[]): string[] {
  try {
    return execFileSync('git', ['grep', '-lE', pattern, '--', ...pathspecs], {
      cwd: __dirname + '/../../..', // sync -> unit -> tests -> repo root
      encoding: 'utf8',
    }).split('\n').filter(Boolean);
  } catch (e) {
    const err = e as { status?: number };
    if (err.status === 1) return []; // no matches
    throw e;
  }
}

describe('SaaS-Portal isolation', () => {
  // Confinement: PORTAL_API_URL may appear ONLY in these files. The
  // PORTAL_SERVICE binding was RETIRED 2026-06-04 (queue replaced the drain
  // POST); the second gate below pins that it never comes back as code.
  const ALLOWED = [
    'server/types/hono.ts',                 // env binding type declarations
    'server/lib/deployment-profile.ts',     // env -> capability seam
    'server/lib/middleware/di.ts',          // composition point #3: provider + OutboxService wiring
    'server/portal/',                       // the integration module itself
    'workers/app.ts',                       // entry-level APP_MODE 404 guard
  ];
  it('PORTAL_API_URL appears only in allowed files', () => {
    const hits = gitGrepFiles('PORTAL_API_URL', 'server', 'workers');
    const stray = hits.filter(f => !ALLOWED.some(a => f.startsWith(a)));
    expect(stray, `stray PORTAL_API_URL references: ${stray.join(', ')}`).toEqual([]);
  });

  it('the retired PORTAL_SERVICE binding is referenced in no CODE file (hono.ts carries the retirement note; markdown docs are exempt)', () => {
    const hits = gitGrepFiles('PORTAL_SERVICE', 'server', 'workers')
      .filter(f => f.endsWith('.ts'));
    const stray = hits.filter(f => f !== 'server/types/hono.ts');
    expect(stray, `PORTAL_SERVICE crept back into: ${stray.join(', ')}`).toEqual([]);
  });

  it('integration.routes + outbox.service are wired only via integration.module (not imported raw)', () => {
    // NOTE: portal.provider is intentionally EXCLUDED — di.ts is wiring point #3
    // and legitimately imports PortalProvider directly. Only the route/outbox
    // files must funnel through integration.module.
    const hits = gitGrepFiles('portal/integration.routes|portal/outbox.service', 'server');
    const stray = hits.filter(
      f => !f.startsWith('server/portal/') && f !== 'server/lib/middleware/di.ts',
    );
    expect(stray, `raw integration.routes/outbox imports outside server/portal/: ${stray.join(', ')}`).toEqual([]);
  });

  it('no concrete server/portal/ import outside the three composition points', () => {
    // Stricter than the route/outbox gate: catches ANY import from server/portal/*
    // (service-binding-guard, portal.provider, etc.). The three composition points
    // are the only allowed importers; everything else uses the seams/abstractions.
    const hits = gitGrepFiles(`(from|import\\()[[:space:]]*['"][^'"]*portal/`, 'server');
    const ALLOWED_IMPORTERS = [
      'server/index.ts',
      'server/scheduled.ts',
      'server/lib/middleware/di.ts',
    ];
    const stray = hits.filter(
      f => !f.startsWith('server/portal/') && !ALLOWED_IMPORTERS.includes(f),
    );
    expect(stray, `concrete portal imports outside composition points: ${stray.join(', ')}`).toEqual([]);
  });
});

import workerEntry from '../../../workers/app';
describe('standalone integration 404', () => {
  it('GET /api/integration/anything → 404 when APP_MODE is not saas', async () => {
    const req = new Request('https://x/api/integration/from-core', { method: 'POST' });
    const res = await workerEntry.fetch(req, { APP_MODE: 'standalone' } as any, {} as any);
    expect(res.status).toBe(404);
  });
});
