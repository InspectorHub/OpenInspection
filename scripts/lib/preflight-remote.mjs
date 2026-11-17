/**
 * Checks that need the running instance (/status) or the Cloudflare account
 * (secret names, an R2 write probe) for the self-host preflight.
 *
 * Secrets: only NAMES are ever read from `wrangler secret list`; values are never
 * requested, stored or printed. Nothing a child process or an exception says is
 * ever echoed: a failure reports a fixed sentence plus an exit status and, when
 * it matches a strict shape, an error code such as ETIMEDOUT.
 */
import { writeFileSync, unlinkSync, rmdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { TEST_SITE_KEY } from './preflight-config.mjs';

const out = (status, message, fix) => ({ status, message, ...(fix ? { fix } : {}) });
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
export const BUCKET_NAME = /^[a-z0-9][a-z0-9-]{2,62}$/;

/** An error whose message is built only from fixed text, numbers and safe codes, so it may be printed. */
export class PreflightError extends Error {}

/** An error code such as ETIMEDOUT or ENOENT, or '' when it does not have that shape. */
export function safeCode(code) {
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{2,24}$/.test(code) ? code : '';
}
const withCode = (code) => (safeCode(code) ? `, ${safeCode(code)}` : '');

export const UNSAFE_LAUNCH_MESSAGE = 'wrangler could not be started safely on this machine';
export const UNSAFE_LAUNCH_FIX = 'Run this from the repository checkout after `npm ci`, so that node_modules/wrangler exists and can be started directly.';
const MAX_STATUS_BODY = 64 * 1024;

/** Semver precedence: a pre-release sorts before the same release; identifiers compare per the spec. */
function cmpVersion(a, b) {
  const pa = SEMVER.exec(a);
  const pb = SEMVER.exec(b);
  if (!pa || !pb) return NaN;
  for (let i = 1; i <= 3; i++) if (pa[i] !== pb[i]) return Number(pa[i]) - Number(pb[i]);
  const ia = pa[4] === undefined ? null : pa[4].split('.');
  const ib = pb[4] === undefined ? null : pb[4].split('.');
  if (!ia && !ib) return 0;
  if (!ia) return 1;
  if (!ib) return -1;
  for (let i = 0; i < Math.min(ia.length, ib.length); i++) {
    const na = /^\d+$/.test(ia[i]);
    const nb = /^\d+$/.test(ib[i]);
    if (na && nb) { if (ia[i] !== ib[i]) return Number(ia[i]) - Number(ib[i]); continue; }
    if (na !== nb) return na ? -1 : 1;
    if (ia[i] !== ib[i]) return ia[i] < ib[i] ? -1 : 1;
  }
  return ia.length - ib.length;
}

/** Read at most `max` bytes of a response body as text; null when it is larger. */
async function readLimited(res, max) {
  if (!res.body) {
    const t = await res.text();
    return t.length > max ? null : t;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) { await reader.cancel().catch(() => undefined); return null; }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export const statusCheck = {
  id: 'status',
  run: async ({ url, fetchImpl, minVersion }) => {
    const fix = 'Check the URL, that the Worker is deployed, and `npx wrangler tail` for startup errors.';
    let res;
    try {
      res = await fetchImpl(new URL('/status', url), { signal: AbortSignal.timeout(10_000), redirect: 'manual' });
    } catch (e) {
      return out('fail', `GET /status did not answer${safeCode(e?.cause?.code) ? ` (${safeCode(e?.cause?.code)})` : ''}`, fix);
    }
    if (res.status !== 200) return out('fail', `GET /status answered HTTP ${res.status}`, fix);
    let body;
    try {
      const text = await readLimited(res, MAX_STATUS_BODY);
      if (text === null) return out('fail', 'GET /status returned a body over 64 KiB, which a health answer never is', fix);
      body = JSON.parse(text);
    } catch {
      return out('fail', 'GET /status did not return JSON', fix);
    }
    if (body?.status !== 'ok' || typeof body.version !== 'string' || !SEMVER.test(body.version)) {
      return out('fail', 'GET /status did not return an OpenInspection health answer (status ok and a version)', fix);
    }
    if (minVersion) {
      const d = cmpVersion(body.version, minVersion);
      if (Number.isNaN(d) || d < 0) return out('fail', `the instance runs ${body.version.slice(0, 40)}, below the required ${minVersion}`, 'Update the instance first (docs/operate/upgrade.md).');
    }
    return out('pass', `instance answers /status, version ${body.version.slice(0, 40)}`);
  },
};

export const baseUrlCheck = {
  id: 'base-url',
  run: ({ url }) => {
    const u = new URL(url);
    if (u.protocol !== 'https:') return out('attention', 'the URL is not https; sign-in cookies and QR links need a secure origin', 'Serve the instance over https on a custom domain.');
    if (u.hostname.endsWith('.workers.dev')) return out('attention', 'the instance is on a workers.dev host; links and QR codes printed from it will change when you move to a custom domain', 'Attach a custom domain before printing links.');
    return out('pass', 'https on a custom host');
  },
};

async function secretNames(ctx) {
  if (!ctx.secretsPromise) {
    ctx.secretsPromise = (async () => {
      const r = await ctx.run(['secret', 'list', '--format', 'json']);
      if (r.code === 'UNSAFE_ARG') throw new PreflightError(`${UNSAFE_LAUNCH_MESSAGE}. ${UNSAFE_LAUNCH_FIX}`);
      if (r.status !== 0) throw new PreflightError(`wrangler secret list failed (exit ${r.status}${withCode(r.code)})`);
      const s = r.stdout ?? '';
      const a = s.indexOf('[');
      const b = s.lastIndexOf(']');
      if (a === -1 || b === -1) throw new PreflightError('wrangler secret list returned no JSON list');
      let list;
      try {
        list = JSON.parse(s.slice(a, b + 1));
      } catch {
        throw new PreflightError('wrangler secret list returned JSON that could not be parsed');
      }
      if (!Array.isArray(list)) throw new PreflightError('wrangler secret list returned an unexpected shape');
      return new Set(list.map((x) => x && x.name).filter((n) => typeof n === 'string'));
    })();
  }
  return ctx.secretsPromise;
}

const skipped = (what) => out('attention', `skipped: ${what} needs wrangler and Cloudflare access (run without --skip-wrangler)`);

export const jwtCheck = {
  id: 'jwt-keyring',
  needs: 'config',
  run: async (ctx) => {
    if (ctx.skipWrangler) return skipped('the JWT keyring check');
    const kid = ctx.cfg.vars?.JWT_CURRENT_KID;
    const m = typeof kid === 'string' ? /^v(\d+)$/.exec(kid) : null;
    if (!m) return out('fail', 'JWT_CURRENT_KID is not set to a `v<N>` value in the config vars', 'Set JWT_CURRENT_KID (the committed config uses "v1").');
    const names = await secretNames(ctx);
    const need = ['JWT_SECRET', `JWT_PRIVATE_KEY_V${m[1]}`, `JWT_PUBLIC_KEY_V${m[1]}`];
    const missing = need.filter((n) => !names.has(n));
    if (missing.length) {
      return out('fail', `missing secret(s): ${missing.join(', ')}; nobody can stay signed in`, 'Run `npm run jwt:ensure` (or `npm run rotate:jwt`, docs/operate/rotate-jwt-keyring.md).');
    }
    return out('pass', `secrets present for current key ${kid}: private, public and JWT_SECRET (names only; the keys are not parsed)`);
  },
};

export const turnstileCheck = {
  id: 'turnstile',
  needs: 'config',
  run: async (ctx) => {
    if (ctx.skipWrangler) return skipped('the Turnstile pairing check');
    const names = await secretNames(ctx);
    const site = ctx.cfg.vars?.TURNSTILE_SITE_KEY;
    const hasSecret = names.has('TURNSTILE_SECRET_KEY');
    if (hasSecret && site === TEST_SITE_KEY) return out('attention', 'a TURNSTILE_SECRET_KEY is set but the site key is still the test site key; the public booking form will reject every submission', 'Set TURNSTILE_SITE_KEY to the real site key.');
    if (!hasSecret) return out('attention', 'no TURNSTILE_SECRET_KEY is set, so the public booking page runs on Cloudflare test keys', 'Set the real secret and site key (docs/integrations/turnstile.md).');
    if (!site) return out('attention', 'TURNSTILE_SITE_KEY is not set in the config', 'Set TURNSTILE_SITE_KEY.');
    return out('pass', 'a Turnstile secret is set and the site key is not the test key (that the two belong together is not checked)');
  },
};

export const emailCheck = {
  id: 'email',
  needs: 'config',
  run: async (ctx) => {
    if (ctx.skipWrangler) return skipped('the email provider check');
    const names = await secretNames(ctx);
    const has = (n) => names.has(n) || typeof ctx.cfg.vars?.[n] === 'string';
    if (has('RESEND_API_KEY') && has('SENDER_EMAIL')) return out('pass', 'RESEND_API_KEY and SENDER_EMAIL are set');
    return out('attention', 'no deployment-level email provider (RESEND_API_KEY with SENDER_EMAIL); invitations and notices cannot be sent unless the company configures its own in Settings', 'Set both secrets, or configure email in Settings after setup.');
  },
};

export const photosCheck = {
  id: 'photos-write',
  needs: 'config',
  run: async (ctx) => {
    if (ctx.skipWrangler) return skipped('the PHOTOS write probe');
    const bucket = ctx.cfg.r2_buckets?.find?.((b) => b.binding === 'PHOTOS')?.bucket_name;
    if (typeof bucket !== 'string' || !bucket) return out('fail', 'the PHOTOS bucket is not declared, so it cannot be probed', 'Declare the PHOTOS r2 bucket.');
    if (!BUCKET_NAME.test(bucket)) return out('fail', 'the PHOTOS bucket name in the config is not a valid R2 bucket name (3 to 63 lowercase letters, digits and hyphens), so it was not probed', 'Fix bucket_name in the config.');
    const key = `preflight/${randomUUID()}.txt`;
    const target = `${bucket}/${key}`;
    const dir = mkdtempSync(join(ctx.tmpDir, 'preflight-probe-'));
    const file = join(dir, 'probe.txt');
    try {
      writeFileSync(file, 'preflight probe, safe to delete\n');
      // The temp directory is the working directory and the file is named relatively, so no
      // temp path (which may contain spaces) is ever part of the command line.
      const put = await ctx.run(['r2', 'object', 'put', target, '--file', 'probe.txt', '--remote'], { cwd: dir });
      const manual = `If it exists, remove it with \`npx wrangler r2 object delete ${target} --remote\`.`;
      if (put.code === 'UNSAFE_ARG') return out('fail', `${UNSAFE_LAUNCH_MESSAGE}, so nothing was written to PHOTOS`, UNSAFE_LAUNCH_FIX);
      if (put.status !== 0) {
        // A timeout can leave the object behind, so try to clean up and always name the key.
        await ctx.run(['r2', 'object', 'delete', target, '--remote']).catch(() => undefined);
        return out('fail', `writing a probe object to PHOTOS failed (exit ${put.status}${withCode(put.code)}); the probe key was ${key}`, `Check the bucket name, the account login (\`npx wrangler whoami\`) and the token permission for R2. ${manual}`);
      }
      const del = await ctx.run(['r2', 'object', 'delete', target, '--remote']);
      if (del.code === 'UNSAFE_ARG') return out('fail', `the probe object ${key} was written but ${UNSAFE_LAUNCH_MESSAGE} to delete it`, `${UNSAFE_LAUNCH_FIX} ${manual}`);
      if (del.status !== 0) return out('fail', `the probe object ${key} was written but could not be deleted (exit ${del.status}${withCode(del.code)}); remove it by hand`, manual);
      return out('pass', 'a probe object was written to PHOTOS and deleted again');
    } finally {
      try { unlinkSync(file); } catch { /* already gone */ }
      try { rmdirSync(dir); } catch { /* already gone */ }
    }
  },
};

export const remoteChecks = () => [statusCheck, baseUrlCheck, jwtCheck, photosCheck, turnstileCheck, emailCheck];
