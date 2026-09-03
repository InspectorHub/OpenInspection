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
    // OI #308 — `app` was outside this pathspec, which is the whole reason four
    // routes could reimplement loginRedirectBase while the gate stayed green.
    // workers/env.ts:52-62 declines to spell the literal even inside a comment
    // because the gate reads it there; app/routes/login.tsx wrote it five times
    // across four files because the gate did not. Same repo, opposite outcomes,
    // decided by a pathspec.
    const hits = gitGrepFiles('PORTAL_API_URL', 'server', 'workers', 'app')
      .filter(f => !/\.(test|spec)\.tsx?$/.test(f));
    const stray = hits.filter(f => !ALLOWED.some(a => f.startsWith(a)));
    // eslint-disable-next-line no-console
    console.log(`[gate] PORTAL_API_URL — ${hits.length} non-test files matched, ${stray.length} stray`);
    expect(hits.length, 'scan matched nothing — pattern or pathspec is broken').toBeGreaterThan(0);
    expect(stray, `stray PORTAL_API_URL references: ${stray.join(', ')}`).toEqual([]);
  });

  // OI #308 — mode-dependent BEHAVIOUR must be read through the capability
  // seam, never off env.APP_MODE. The pattern is a property READ (`.APP_MODE`),
  // not the bare word: `APP_MODE?: string` on an env interface is a
  // declaration, not a branch, and there are seven of those that are fine.
  //
  // ONE file may read it: the seam itself, which is the one derivation.
  //
  // Two others were allowlisted and no longer are. `di.ts` was let in as
  // "composition point #3", but that reason governs what it may IMPORT, not how
  // it may test the mode — it already reads `c.var.profile` four times in the
  // same file, and its actual question was "is the tenant record owned by a
  // platform", now `tenantRecordOwnedByPortal`. `workers/app.ts` was let in as
  // an entry-level guard running before middleware, which is true of
  // `c.var.profile` but not of `getDeploymentProfile`: that takes `ProfileEnv`,
  // not `AppEnv`, and the widening exists for exactly this caller. Its question
  // was "does the portal M2M surface exist", now `hasPortalIntegrationApi`.
  //
  // An allowlist entry outlives the reason it was granted for. Both of these
  // had reasons that were true of something adjacent to what they permitted.
  const APP_MODE_READERS = [
    'server/lib/deployment-profile.ts',
  ];

  // Empty, and it stays empty. An entry here means a new violation shipped.
  const APP_MODE_STRAYS: string[] = [];

  it('env.APP_MODE is read only through the capability seam', () => {
    const hits = gitGrepFiles('\\.APP_MODE', 'server', 'workers', 'app')
      // Tests legitimately construct envs in both modes to exercise the seam.
      .filter(f => !/\.(test|spec)\.tsx?$/.test(f));
    const stray = hits.filter(
      f => !APP_MODE_READERS.includes(f) && !APP_MODE_STRAYS.includes(f),
    );
    // Both numbers, always: a gate that scanned nothing must not read as a
    // pass. Zero hits means the pattern or the pathspec broke, not that the
    // codebase is clean — there are three legitimate readers at all times.
    // eslint-disable-next-line no-console
    console.log(`[gate] .APP_MODE — ${hits.length} non-test files matched, ${stray.length} stray, ${APP_MODE_STRAYS.length} awaiting migration`);
    expect(hits.length, 'scan matched nothing — pattern or pathspec is broken').toBeGreaterThan(0);
    expect(stray, `APP_MODE read outside the seam: ${stray.join(', ')}`).toEqual([]);
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
      // Was `server/scheduled.ts`. The cron refactor moved the job bodies out of
      // that file into `server/cron/jobs/*`, so the scheduled composition point
      // moved with them — same architecture, new address. `scheduled.ts` now
      // imports nothing from portal at all, which is why it is gone from here
      // rather than kept alongside.
      'server/cron/jobs/integrations.ts',
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
  it('GET /api/platform/anything → 404 when APP_MODE is not saas', async () => {
    // A LIVE endpoint under the prefix. The old URL here named a portal
    // endpoint retired in 2026-06; after the rename it would still 404, but by
    // falling through to the API app rather than by hitting the mode gate this
    // test exists to prove.
    const req = new Request('https://x/api/platform/sso-handoff', { method: 'POST' });
    const res = await workerEntry.fetch(req, { APP_MODE: 'standalone' } as any, {} as any);
    expect(res.status).toBe(404);
  });
});
